import { promises as fs } from 'fs';
import path from 'path';
import type { Stage } from '@/lib/types/stage';
import type { SceneOutline } from '@/lib/types/generation';
import type { AgentInfo } from '@/lib/generation/pipeline-types';
import type { Action } from '@/lib/types/action';
import type { WebSearchResult } from '@/lib/types/web-search';
import { CLASSROOM_JOBS_DIR, ensureClassroomJobsDir, writeJsonFileAtomic } from './classroom-storage';
import { createLogger } from '@/lib/logger';

const log = createLogger('Checkpoint');

// ─── Types ─────────────────────────────────────────────────

export type SceneCheckpointStatus =
  | 'pending'
  | 'content_done'
  | 'actions_done'
  | 'complete'
  | 'skipped';

export interface SceneCheckpoint {
  index: number;
  outline: SceneOutline;
  status: SceneCheckpointStatus;
  /** Generated content (slide/quiz/interactive/pbl). Kept as opaque JSON. */
  content?: unknown;
  /** Generated actions for this scene. */
  actions?: Action[];
  /** Scene ID assigned after full creation. */
  sceneId?: string;
}

/** A single logged LLM call with input/output. */
export interface LLMCallLog {
  /** Descriptive label, e.g. 'outline', 'scene_1_content', 'scene_1_actions' */
  label: string;
  /** System prompt sent to the LLM */
  systemPrompt: string;
  /** User prompt sent to the LLM */
  userPrompt: string;
  /** Raw LLM response text */
  response: string;
  /** ISO timestamp */
  timestamp: string;
}

export interface GenerationCheckpoint {
  jobId: string;
  stageId: string;
  stage: Stage;
  outlines: SceneOutline[];
  agents: AgentInfo[];
  languageDirective: string;
  researchContext?: string;
  /** Raw web search result from Tavily (sources, URLs, content) */
  rawSearchResult?: WebSearchResult;
  /** Per-scene checkpoint state */
  scenes: SceneCheckpoint[];
  /** Ordered log of every LLM call made during generation */
  llmCallLogs?: LLMCallLog[];
  /** Timestamp of last update */
  updatedAt: string;
}

// ─── File path ─────────────────────────────────────────────

function checkpointPath(jobId: string): string {
  return path.join(CLASSROOM_JOBS_DIR, `${jobId}.checkpoint.json`);
}

// ─── Read / Write ──────────────────────────────────────────

export async function readCheckpoint(jobId: string): Promise<GenerationCheckpoint | null> {
  try {
    const content = await fs.readFile(checkpointPath(jobId), 'utf-8');
    return JSON.parse(content) as GenerationCheckpoint;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function writeCheckpoint(checkpoint: GenerationCheckpoint): Promise<void> {
  await ensureClassroomJobsDir();
  checkpoint.updatedAt = new Date().toISOString();
  await writeJsonFileAtomic(checkpointPath(checkpoint.jobId), checkpoint);
}

// ─── Convenience updaters ──────────────────────────────────

/** Create an initial checkpoint after outlines & agents are resolved. */
export function createCheckpoint(
  jobId: string,
  stageId: string,
  stage: Stage,
  outlines: SceneOutline[],
  agents: AgentInfo[],
  languageDirective: string,
  researchContext?: string,
): GenerationCheckpoint {
  return {
    jobId,
    stageId,
    stage,
    outlines,
    agents,
    languageDirective,
    researchContext,
    scenes: outlines.map((outline, index) => ({
      index,
      outline,
      status: 'pending',
    })),
    updatedAt: new Date().toISOString(),
  };
}

/** Mark a scene's content as generated. */
export async function checkpointSceneContent(
  checkpoint: GenerationCheckpoint,
  sceneIndex: number,
  content: unknown,
): Promise<void> {
  const sc = checkpoint.scenes[sceneIndex];
  if (!sc) return;
  sc.content = content;
  sc.status = 'content_done';
  await writeCheckpoint(checkpoint);
  log.info(`Checkpoint: scene ${sceneIndex + 1}/${checkpoint.scenes.length} content saved`);
}

/** Mark a scene's actions as generated. */
export async function checkpointSceneActions(
  checkpoint: GenerationCheckpoint,
  sceneIndex: number,
  actions: Action[],
): Promise<void> {
  const sc = checkpoint.scenes[sceneIndex];
  if (!sc) return;
  sc.actions = actions;
  sc.status = 'actions_done';
  await writeCheckpoint(checkpoint);
  log.info(`Checkpoint: scene ${sceneIndex + 1}/${checkpoint.scenes.length} actions saved`);
}

/** Mark a scene as fully complete (created in store). */
export async function checkpointSceneComplete(
  checkpoint: GenerationCheckpoint,
  sceneIndex: number,
  sceneId: string,
): Promise<void> {
  const sc = checkpoint.scenes[sceneIndex];
  if (!sc) return;
  sc.sceneId = sceneId;
  sc.status = 'complete';
  await writeCheckpoint(checkpoint);
}

/** Mark a scene as skipped (content or actions generation failed). */
export async function checkpointSceneSkipped(
  checkpoint: GenerationCheckpoint,
  sceneIndex: number,
): Promise<void> {
  const sc = checkpoint.scenes[sceneIndex];
  if (!sc) return;
  sc.status = 'skipped';
  await writeCheckpoint(checkpoint);
}

/** Save raw web search result to checkpoint. */
export async function checkpointSearchResult(
  checkpoint: GenerationCheckpoint,
  searchResult: WebSearchResult,
): Promise<void> {
  checkpoint.rawSearchResult = searchResult;
  await writeCheckpoint(checkpoint);
  log.info(`Checkpoint: raw search result saved (${searchResult.sources.length} sources)`);
}

/** Append an LLM call log entry to the checkpoint. */
export async function checkpointLLMCall(
  checkpoint: GenerationCheckpoint,
  label: string,
  systemPrompt: string,
  userPrompt: string,
  response: string,
): Promise<void> {
  if (!checkpoint.llmCallLogs) {
    checkpoint.llmCallLogs = [];
  }
  checkpoint.llmCallLogs.push({
    label,
    systemPrompt,
    userPrompt,
    response,
    timestamp: new Date().toISOString(),
  });
  await writeCheckpoint(checkpoint);
  log.info(`Checkpoint: LLM call "${label}" logged (${checkpoint.llmCallLogs.length} total)`);
}
