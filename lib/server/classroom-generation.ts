import { nanoid } from 'nanoid';
import { callLLM } from '@/lib/ai/llm';
import { createStageAPI } from '@/lib/api/stage-api';
import type { StageStore } from '@/lib/api/stage-api-types';
import {
  applyOutlineFallbacks,
  generateSceneOutlinesFromRequirements,
} from '@/lib/generation/outline-generator';
import {
  createSceneWithActions,
  generateSceneActions,
  generateSceneContent,
} from '@/lib/generation/scene-generator';
import type { AICallFn } from '@/lib/generation/pipeline-types';
import type { AgentInfo } from '@/lib/generation/pipeline-types';
import { getDefaultAgents } from '@/lib/orchestration/registry/store';
import { createLogger } from '@/lib/logger';
import { isProviderKeyRequired } from '@/lib/ai/providers';
import { resolveWebSearchApiKey } from '@/lib/server/provider-config';
import { resolveModel } from '@/lib/server/resolve-model';
import { buildSearchQuery } from '@/lib/server/search-query-builder';
import { searchWithTavily, formatSearchResultsAsContext } from '@/lib/web-search/tavily';
import { persistClassroom, hasCancelSentinel } from '@/lib/server/classroom-storage';
import { writeClassroomManifest } from '@/lib/server/classroom-manifest';
import {
  generateMediaForClassroom,
  replaceMediaPlaceholders,
  generateTTSForClassroom,
} from '@/lib/server/classroom-media-generation';
import {
  createCheckpoint,
  checkpointSceneContent,
  checkpointSceneActions,
  checkpointSceneComplete,
  checkpointSceneSkipped,
  checkpointSearchResult,
  checkpointLLMCall,
  readCheckpoint,
  writeCheckpoint,
  type GenerationCheckpoint,
} from '@/lib/server/classroom-checkpoint';
import type { UserRequirements, SceneOutline } from '@/lib/types/generation';
import type { Scene, Stage } from '@/lib/types/stage';
import { AGENT_COLOR_PALETTE, AGENT_DEFAULT_AVATARS } from '@/lib/constants/agent-defaults';
import type { CourseTagId } from '@/lib/constants/course-tags';

const log = createLogger('Classroom');

export interface ClassroomVoiceConfig {
  providerId: string;
  modelId?: string;
  voiceId: string;
}

export interface PresetClassroomAgentInput {
  id: string;
  name: string;
  role: string;
  persona: string;
  avatar?: string;
  color?: string;
  priority?: number;
  voiceConfig?: ClassroomVoiceConfig;
}

type ResolvedClassroomAgent = AgentInfo & {
  avatar?: string;
  color?: string;
  priority?: number;
  voiceConfig?: ClassroomVoiceConfig;
};

export interface GenerateClassroomInput {
  requirement: string;
  courseTagIds?: CourseTagId[];
  pdfContent?: { text: string; images: string[] };
  enableWebSearch?: boolean;
  enableImageGeneration?: boolean;
  enableVideoGeneration?: boolean;
  enableTTS?: boolean;
  agentMode?: 'default' | 'generate';
  presetAgents?: PresetClassroomAgentInput[];
  teacherVoiceConfig?: ClassroomVoiceConfig;
}

export type ClassroomGenerationStep =
  | 'initializing'
  | 'researching'
  | 'generating_outlines'
  | 'generating_scenes'
  | 'generating_media'
  | 'generating_tts'
  | 'persisting'
  | 'completed';

export interface ClassroomGenerationProgress {
  step: ClassroomGenerationStep;
  progress: number;
  message: string;
  scenesGenerated: number;
  totalScenes?: number;
  /** Index of the scene currently being generated (0-based) */
  currentSceneIndex?: number;
  /** Outline titles — sent once after outlines are generated */
  outlineTitles?: string[];
  /** The classroom/stage ID — sent once stage is created */
  stageId?: string;
}

export interface GenerateClassroomResult {
  id: string;
  url: string;
  stage: Stage;
  scenes: Scene[];
  scenesCount: number;
  createdAt: string;
}

function createInMemoryStore(stage: Stage): StageStore {
  let state = {
    stage: stage as Stage | null,
    scenes: [] as Scene[],
    currentSceneId: null as string | null,
    mode: 'playback' as const,
  };

  const listeners: Array<(s: typeof state, prev: typeof state) => void> = [];

  return {
    getState: () => state,
    setState: (partial: Partial<typeof state>) => {
      const prev = state;
      state = { ...state, ...partial };
      listeners.forEach((fn) => fn(state, prev));
    },
    subscribe: (listener: (s: typeof state, prev: typeof state) => void) => {
      listeners.push(listener);
      return () => {
        const idx = listeners.indexOf(listener);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    },
  };
}

function stripCodeFences(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  return cleaned.trim();
}

async function generateAgentProfiles(
  requirement: string,
  languageDirective: string,
  aiCall: AICallFn,
): Promise<ResolvedClassroomAgent[]> {
  const systemPrompt =
    'You are an expert instructional designer. Generate agent profiles for a multi-agent classroom simulation. Return ONLY valid JSON, no markdown or explanation.';

  const userPrompt = `Generate agent profiles for a course with this requirement:
${requirement}

Requirements:
- Decide the appropriate number of agents based on the course content (typically 3-5)
- Exactly 1 agent must have role "teacher", the rest can be "assistant" or "student"
- Each agent needs: name, role, persona (2-3 sentences describing personality and teaching/learning style)
- Language directive for this course: ${languageDirective}
  Agent names and personas must follow this language directive.

Return a JSON object with this exact structure:
{
  "agents": [
    {
      "name": "string",
      "role": "teacher" | "assistant" | "student",
      "persona": "string (2-3 sentences)"
    }
  ]
}`;

  const response = await aiCall(systemPrompt, userPrompt);
  const rawText = stripCodeFences(response);
  const parsed = JSON.parse(rawText) as {
    agents: Array<{ name: string; role: string; persona: string }>;
  };

  if (!parsed.agents || !Array.isArray(parsed.agents) || parsed.agents.length < 2) {
    throw new Error(`Expected at least 2 agents, got ${parsed.agents?.length ?? 0}`);
  }

  const teacherCount = parsed.agents.filter((a) => a.role === 'teacher').length;
  if (teacherCount !== 1) {
    throw new Error(`Expected exactly 1 teacher, got ${teacherCount}`);
  }

  return parsed.agents.map((a, i) => ({
    id: `gen-server-${i}`,
    name: a.name,
    role: a.role,
    persona: a.persona,
  }));
}

function applyTeacherVoiceConfig(
  agents: ResolvedClassroomAgent[],
  teacherVoiceConfig?: ClassroomVoiceConfig,
): ResolvedClassroomAgent[] {
  if (!teacherVoiceConfig) return agents;
  return agents.map((agent) =>
    agent.role === 'teacher' ? { ...agent, voiceConfig: teacherVoiceConfig } : agent,
  );
}

function normalizePresetAgents(
  presetAgents: PresetClassroomAgentInput[] | undefined,
): ResolvedClassroomAgent[] {
  if (!presetAgents?.length) return [];
  return presetAgents.map((agent, index) => ({
    id: agent.id || `preset-server-${index}`,
    name: agent.name,
    role: agent.role,
    persona: agent.persona,
    avatar: agent.avatar,
    color: agent.color,
    priority: agent.priority,
    ...(agent.voiceConfig ? { voiceConfig: agent.voiceConfig } : {}),
  }));
}

function toStageAgentConfig(agent: ResolvedClassroomAgent, index: number) {
  return {
    id: agent.id,
    name: agent.name,
    role: agent.role,
    persona: agent.persona || '',
    avatar: agent.avatar || AGENT_DEFAULT_AVATARS[index % AGENT_DEFAULT_AVATARS.length],
    color: agent.color || AGENT_COLOR_PALETTE[index % AGENT_COLOR_PALETTE.length],
    priority: agent.priority ?? (agent.role === 'teacher' ? 10 : agent.role === 'assistant' ? 7 : 5),
    ...(agent.voiceConfig ? { voiceConfig: agent.voiceConfig } : {}),
  };
}

export async function generateClassroom(
  input: GenerateClassroomInput,
  options: {
    baseUrl: string;
    jobId?: string;
    onProgress?: (progress: ClassroomGenerationProgress) => Promise<void> | void;
    signal?: AbortSignal;
  },
): Promise<GenerateClassroomResult> {
  const { requirement, pdfContent, courseTagIds } = input;

  const checkAborted = async () => {
    if (options.signal?.aborted) {
      throw new Error('Generation cancelled by user');
    }
    // File-based cancel sentinel — survives HMR / server restarts
    if (options.jobId && await hasCancelSentinel(options.jobId)) {
      throw new Error('Generation cancelled by user');
    }
  };

  await options.onProgress?.({
    step: 'initializing',
    progress: 5,
    message: 'Initializing classroom generation',
    scenesGenerated: 0,
  });

  const {
    model: languageModel,
    modelInfo,
    modelString,
    providerId,
    apiKey,
  } = await resolveModel({});
  log.info(`Using server-configured model: ${modelString}`);

  // Fail fast if the resolved provider has no API key configured
  if (isProviderKeyRequired(providerId) && !apiKey) {
    throw new Error(
      `No API key configured for provider "${providerId}". ` +
        `Set the appropriate key in .env.local or server-providers.yml (e.g. ${providerId.toUpperCase()}_API_KEY).`,
    );
  }

  // ─── LLM call logging infrastructure ─────────────────────
  // Buffer LLM logs until checkpoint is created, then flush + save directly.
  let llmLogCheckpoint: GenerationCheckpoint | null = null;
  const llmLogBuffer: Array<{ label: string; systemPrompt: string; userPrompt: string; response: string }> = [];
  let currentLLMLabel = 'unknown';

  function setLLMLabel(label: string) {
    currentLLMLabel = label;
  }

  async function logLLMCall(systemPrompt: string, userPrompt: string, response: string) {
    if (llmLogCheckpoint) {
      await checkpointLLMCall(llmLogCheckpoint, currentLLMLabel, systemPrompt, userPrompt, response);
    } else {
      llmLogBuffer.push({ label: currentLLMLabel, systemPrompt, userPrompt, response });
    }
  }

  const aiCall: AICallFn = async (systemPrompt, userPrompt, _images) => {
    const result = await callLLM(
      {
        model: languageModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        maxOutputTokens: modelInfo?.outputWindow,
      },
      'generate-classroom',
    );
    await logLLMCall(systemPrompt, userPrompt, result.text);
    return result.text;
  };

  const searchQueryAiCall: AICallFn = async (systemPrompt, userPrompt, _images) => {
    setLLMLabel('search_query_rewrite');
    const result = await callLLM(
      {
        model: languageModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        maxOutputTokens: 256,
      },
      'web-search-query-rewrite',
    );
    await logLLMCall(systemPrompt, userPrompt, result.text);
    return result.text;
  };

  const requirements: UserRequirements = {
    requirement,
  };
  const pdfText = pdfContent?.text || undefined;

  // ─── Try to resume from existing checkpoint ────────────
  let existingCheckpoint: GenerationCheckpoint | null = null;
  if (options.jobId) {
    existingCheckpoint = await readCheckpoint(options.jobId);
  }

  let outlines: SceneOutline[];
  let languageDirective: string;
  let agents: ResolvedClassroomAgent[];
  let stageId: string;
  let stage: Stage;
  let researchContext: string | undefined;
  let rawSearchResult: import('@/lib/types/web-search').WebSearchResult | undefined;

  if (existingCheckpoint) {
    // ── Resume from checkpoint — skip outline/agent generation ──
    log.info(`Resuming from checkpoint for job ${options.jobId}`);
    outlines = existingCheckpoint.outlines;
    languageDirective = existingCheckpoint.languageDirective;
    agents = existingCheckpoint.agents;
    stageId = existingCheckpoint.stageId;
    stage = existingCheckpoint.stage;
    researchContext = existingCheckpoint.researchContext;

    const completedCount = existingCheckpoint.scenes.filter(
      (s) => s.status === 'complete',
    ).length;

    await options.onProgress?.({
      step: 'generating_scenes',
      progress: 30,
      message: `Resuming: ${completedCount}/${outlines.length} scenes already done`,
      scenesGenerated: completedCount,
      totalScenes: outlines.length,
      outlineTitles: outlines.map((o) => o.title),
      stageId,
    });
  } else {
    // ── Fresh generation — run full pipeline ──

    await options.onProgress?.({
      step: 'researching',
      progress: 10,
      message: 'Researching topic',
      scenesGenerated: 0,
    });

    // Web search (optional, graceful degradation)
    if (input.enableWebSearch) {
      const tavilyKey = resolveWebSearchApiKey();
      if (tavilyKey) {
        try {
          const searchQuery = await buildSearchQuery(requirement, pdfText, searchQueryAiCall);

          log.info('Running web search for classroom generation', {
            hasPdfContext: searchQuery.hasPdfContext,
            rawRequirementLength: searchQuery.rawRequirementLength,
            rewriteAttempted: searchQuery.rewriteAttempted,
            finalQueryLength: searchQuery.finalQueryLength,
          });

          const searchResult = await searchWithTavily({
            query: searchQuery.query,
            apiKey: tavilyKey,
          });
          rawSearchResult = searchResult;
          researchContext = formatSearchResultsAsContext(searchResult);
          if (researchContext) {
            log.info(`Web search returned ${searchResult.sources.length} sources`);
          }
        } catch (e) {
          log.warn('Web search failed, continuing without search context:', e);
        }
      } else {
        log.warn('enableWebSearch is true but no Tavily API key configured, skipping web search');
      }
    }

    await options.onProgress?.({
      step: 'generating_outlines',
      progress: 15,
      message: 'Generating scene outlines',
      scenesGenerated: 0,
    });

    setLLMLabel('outline');
    const outlinesResult = await generateSceneOutlinesFromRequirements(
      requirements,
      pdfText,
      undefined,
      aiCall,
      undefined,
      {
        imageGenerationEnabled: input.enableImageGeneration,
        videoGenerationEnabled: input.enableVideoGeneration,
        researchContext,
        // NO teacherContext — agents haven't been generated yet
      },
    );

    if (!outlinesResult.success || !outlinesResult.data) {
      log.error('Failed to generate outlines:', outlinesResult.error);
      throw new Error(outlinesResult.error || 'Failed to generate scene outlines');
    }

    languageDirective = outlinesResult.data.languageDirective;
    outlines = outlinesResult.data.outlines;
    log.info(`Generated ${outlines.length} scene outlines (languageDirective: ${languageDirective})`);

    await options.onProgress?.({
      step: 'generating_outlines',
      progress: 30,
      message: `Generated ${outlines.length} scene outlines`,
      scenesGenerated: 0,
      totalScenes: outlines.length,
      outlineTitles: outlines.map((o) => o.title),
    });

    // Resolve agents based on agentMode — now AFTER outlines so we can use languageDirective
    const agentMode = input.agentMode || 'default';
    if (agentMode === 'generate') {
      log.info('Generating custom agent profiles via LLM...');
      setLLMLabel('agent_profiles');
      try {
        agents = applyTeacherVoiceConfig(
          await generateAgentProfiles(requirement, languageDirective, aiCall),
          input.teacherVoiceConfig,
        );
        log.info(`Generated ${agents.length} agent profiles`);
      } catch (e) {
        log.warn('Agent profile generation failed, falling back to defaults:', e);
        agents = applyTeacherVoiceConfig(
          getDefaultAgents().map((agent) => ({ ...agent })),
          input.teacherVoiceConfig,
        );
      }
    } else if ((input.presetAgents?.length ?? 0) > 0) {
      agents = applyTeacherVoiceConfig(
        normalizePresetAgents(input.presetAgents),
        input.teacherVoiceConfig,
      );
    } else {
      agents = applyTeacherVoiceConfig(
        getDefaultAgents().map((agent) => ({ ...agent })),
        input.teacherVoiceConfig,
      );
    }

    stageId = nanoid(10);
    stage = {
      id: stageId,
      name: outlines[0]?.title || requirement.slice(0, 50),
      description: undefined,
      courseTagIds,
      languageDirective,
      style: 'interactive',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      agentIds: agents.map((a) => a.id),
      ...((agentMode === 'generate' || (input.presetAgents?.length ?? 0) > 0)
        ? {
            generatedAgentConfigs: agents.map((agent, index) => toStageAgentConfig(agent, index)),
          }
        : {}),
    };
  }

  const store = createInMemoryStore(stage);
  const api = createStageAPI(store);

  // ─── Create or load checkpoint ─────────────────────────
  let checkpoint: GenerationCheckpoint | null = null;
  if (options.jobId) {
    checkpoint = await readCheckpoint(options.jobId);
  }
  if (!checkpoint && options.jobId) {
    checkpoint = createCheckpoint(
      options.jobId,
      stageId,
      stage,
      outlines,
      agents,
      languageDirective,
      researchContext,
    );
    // Save raw search results if available
    if (rawSearchResult) {
      checkpoint.rawSearchResult = rawSearchResult;
    }
    // Flush buffered LLM call logs
    if (llmLogBuffer.length > 0) {
      checkpoint.llmCallLogs = llmLogBuffer.map((entry) => ({
        ...entry,
        timestamp: new Date().toISOString(),
      }));
      llmLogBuffer.length = 0;
    }
    await writeCheckpoint(checkpoint);
  }

  // Wire LLM logging to checkpoint from this point on
  if (checkpoint) {
    llmLogCheckpoint = checkpoint;
  }

  log.info('Stage 2: Generating scene content and actions...');
  let generatedScenes = 0;

  for (const [index, outline] of outlines.entries()) {
    await checkAborted();
    const safeOutline = applyOutlineFallbacks(outline, true);
    const progressStart = 30 + Math.floor((index / Math.max(outlines.length, 1)) * 60);

    // Check checkpoint — skip already-complete or skipped scenes
    const sceneCP = checkpoint?.scenes[index];
    if (sceneCP && (sceneCP.status === 'complete' || sceneCP.status === 'skipped')) {
      if (sceneCP.status === 'complete') generatedScenes += 1;
      log.info(`Skipping scene ${index + 1} (checkpoint: ${sceneCP.status})`);
      continue;
    }

    await options.onProgress?.({
      step: 'generating_scenes',
      progress: Math.max(progressStart, 31),
      message: `Generating scene ${index + 1}/${outlines.length}: ${safeOutline.title}`,
      scenesGenerated: generatedScenes,
      totalScenes: outlines.length,
      currentSceneIndex: index,
      ...(index === 0 ? { stageId } : {}),
    });

    // ── Step A: Generate content (or reuse from checkpoint) ──
    let content = sceneCP?.status === 'content_done' || sceneCP?.status === 'actions_done'
      ? (sceneCP.content as Awaited<ReturnType<typeof generateSceneContent>>)
      : null;

    if (!content) {
      setLLMLabel(`scene_${index + 1}_content`);
      content = await generateSceneContent(safeOutline, aiCall, { agents, languageDirective });
      if (!content) {
        log.warn(`Skipping scene "${safeOutline.title}" — content generation failed`);
        if (checkpoint) await checkpointSceneSkipped(checkpoint, index);
        continue;
      }
      if (checkpoint) await checkpointSceneContent(checkpoint, index, content);
    } else {
      log.info(`Scene ${index + 1}: reusing content from checkpoint`);
    }

    await checkAborted();

    // ── Step B: Generate actions (or reuse from checkpoint) ──
    let actions = sceneCP?.status === 'actions_done' ? sceneCP.actions! : null;

    if (!actions) {
      setLLMLabel(`scene_${index + 1}_actions`);
      actions = await generateSceneActions(safeOutline, content, aiCall, {
        agents,
        languageDirective,
      });
      log.info(`Scene "${safeOutline.title}": ${actions.length} actions`);
      if (checkpoint) await checkpointSceneActions(checkpoint, index, actions);
    } else {
      log.info(`Scene ${index + 1}: reusing actions from checkpoint`);
    }

    await checkAborted();

    // ── Step C: Create scene ──
    const sceneId = createSceneWithActions(safeOutline, content, actions, api);
    if (!sceneId) {
      log.warn(`Skipping scene "${safeOutline.title}" — scene creation failed`);
      if (checkpoint) await checkpointSceneSkipped(checkpoint, index);
      continue;
    }

    if (checkpoint) await checkpointSceneComplete(checkpoint, index, sceneId);
    generatedScenes += 1;
    const progressEnd = 30 + Math.floor(((index + 1) / Math.max(outlines.length, 1)) * 60);
    await options.onProgress?.({
      step: 'generating_scenes',
      progress: Math.min(progressEnd, 90),
      message: `Generated ${generatedScenes}/${outlines.length} scenes`,
      scenesGenerated: generatedScenes,
      totalScenes: outlines.length,
      currentSceneIndex: index,
    });

    // Incremental persistence — save after every scene so data is not lost on failure
    try {
      await persistClassroom(
        { id: stageId, stage, scenes: store.getState().scenes },
        options.baseUrl,
      );
    } catch (persistErr) {
      log.warn(`Incremental persist after scene ${index + 1} failed:`, persistErr);
    }
  }

  const scenes = store.getState().scenes;
  log.info(`Pipeline complete: ${scenes.length} scenes generated`);

  if (scenes.length === 0) {
    throw new Error('No scenes were generated');
  }

  await checkAborted();

  // Phase: Media generation (after all scenes generated)
  if (input.enableImageGeneration || input.enableVideoGeneration) {
    await options.onProgress?.({
      step: 'generating_media',
      progress: 90,
      message: 'Generating media files',
      scenesGenerated: scenes.length,
      totalScenes: outlines.length,
    });

    try {
      const mediaMap = await generateMediaForClassroom(outlines, stageId, options.baseUrl);
      replaceMediaPlaceholders(scenes, mediaMap);
      log.info(`Media generation complete: ${Object.keys(mediaMap).length} files`);
    } catch (err) {
      log.warn('Media generation phase failed, continuing:', err);
    }
  }

  await checkAborted();

  // Phase: TTS generation
  if (input.enableTTS) {
    await options.onProgress?.({
      step: 'generating_tts',
      progress: 94,
      message: 'Generating TTS audio',
      scenesGenerated: scenes.length,
      totalScenes: outlines.length,
    });

    try {
      await generateTTSForClassroom(
        scenes,
        stageId,
        options.baseUrl,
        agents.find((agent) => agent.role === 'teacher')?.voiceConfig,
      );
      log.info('TTS generation complete');
    } catch (err) {
      log.warn('TTS generation phase failed, continuing:', err);
    }
  }

  await options.onProgress?.({
    step: 'persisting',
    progress: 98,
    message: 'Persisting classroom data',
    scenesGenerated: scenes.length,
    totalScenes: outlines.length,
  });

  const persisted = await persistClassroom(
    {
      id: stageId,
      stage,
      scenes,
    },
    options.baseUrl,
  );

  // Write self-contained manifest for the viewer (consumer) package
  try {
    const agentConfigs = stage.generatedAgentConfigs?.map((a) => ({
      name: a.name,
      role: a.role,
      persona: a.persona,
      avatar: a.avatar,
      color: a.color,
      priority: a.priority,
      ...(a.voiceConfig ? { voiceConfig: a.voiceConfig } : {}),
    }));
    await writeClassroomManifest(stageId, stage, scenes, agentConfigs);
    log.info(`Manifest written for classroom ${stageId}`);
  } catch (err) {
    log.warn('Manifest write failed, continuing:', err);
  }

  log.info(`Classroom persisted: ${persisted.id}, URL: ${persisted.url}`);

  await options.onProgress?.({
    step: 'completed',
    progress: 100,
    message: 'Classroom generation completed',
    scenesGenerated: scenes.length,
    totalScenes: outlines.length,
  });

  return {
    id: persisted.id,
    url: persisted.url,
    stage,
    scenes,
    scenesCount: scenes.length,
    createdAt: persisted.createdAt,
  };
}
