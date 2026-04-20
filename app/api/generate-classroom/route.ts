import { after, type NextRequest } from 'next/server';
import { nanoid } from 'nanoid';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { type GenerateClassroomInput } from '@/lib/server/classroom-generation';
import { runClassroomGenerationJob } from '@/lib/server/classroom-job-runner';
import {
  createClassroomGenerationJob,
  listClassroomGenerationJobs,
} from '@/lib/server/classroom-job-store';
import { buildRequestOrigin } from '@/lib/server/classroom-storage';
import { createLogger } from '@/lib/logger';
import { filterValidCourseTagIds, resolveCourseTags } from '@/lib/server/course-tags';

const log = createLogger('GenerateClassroom API');

export const maxDuration = 30;

/** GET /api/generate-classroom — List all generation jobs (newest first). */
export async function GET() {
  try {
    const jobs = await listClassroomGenerationJobs();

    const items = await Promise.all(
      jobs.map(async (job) => ({
        jobId: job.id,
        status: job.status,
        step: job.step,
        progress: job.progress,
        message: job.message,
        createdAt: job.createdAt,
        completedAt: job.completedAt,
        requirementPreview: job.inputSummary.requirementPreview,
        courseTagIds: job.inputSummary.courseTagIds || [],
        courseTags: await resolveCourseTags(job.inputSummary.courseTagIds),
        scenesGenerated: job.scenesGenerated,
        totalScenes: job.totalScenes,
        stageId: job.stageId,
        result: job.result,
        error: job.error,
      })),
    );

    return apiSuccess({ jobs: items });
  } catch (error) {
    log.error('Failed to list classroom generation jobs:', error);
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Failed to list jobs',
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function POST(req: NextRequest) {
  let requirementSnippet: string | undefined;
  try {
    const rawBody = (await req.json()) as Partial<GenerateClassroomInput>;
    requirementSnippet = rawBody.requirement?.substring(0, 60);
    const courseTagIds = await filterValidCourseTagIds(rawBody.courseTagIds);
    const body: GenerateClassroomInput = {
      requirement: rawBody.requirement || '',
      ...(courseTagIds.length > 0 ? { courseTagIds } : {}),
      ...(rawBody.pdfContent ? { pdfContent: rawBody.pdfContent } : {}),

      ...(rawBody.enableWebSearch != null ? { enableWebSearch: rawBody.enableWebSearch } : {}),
      ...(rawBody.enableImageGeneration != null
        ? { enableImageGeneration: rawBody.enableImageGeneration }
        : {}),
      ...(rawBody.enableVideoGeneration != null
        ? { enableVideoGeneration: rawBody.enableVideoGeneration }
        : {}),
      ...(rawBody.enableTTS != null ? { enableTTS: rawBody.enableTTS } : {}),
      ...(rawBody.agentMode ? { agentMode: rawBody.agentMode } : {}),
      ...(Array.isArray(rawBody.presetAgents) && rawBody.presetAgents.length > 0
        ? {
            presetAgents: rawBody.presetAgents
              .filter(
                (agent) =>
                  typeof agent?.id === 'string' &&
                  typeof agent?.name === 'string' &&
                  typeof agent?.role === 'string' &&
                  typeof agent?.persona === 'string',
              )
              .map((agent) => ({
                id: agent.id,
                name: agent.name,
                role: agent.role,
                persona: agent.persona,
                avatar: agent.avatar,
                color: agent.color,
                priority: agent.priority,
                ...(agent.voiceConfig?.providerId && agent.voiceConfig?.voiceId
                  ? {
                      voiceConfig: {
                        providerId: agent.voiceConfig.providerId,
                        modelId: agent.voiceConfig.modelId,
                        voiceId: agent.voiceConfig.voiceId,
                      },
                    }
                  : {}),
              })),
          }
        : {}),
      ...(rawBody.teacherVoiceConfig?.providerId && rawBody.teacherVoiceConfig?.voiceId
        ? {
            teacherVoiceConfig: {
              providerId: rawBody.teacherVoiceConfig.providerId,
              modelId: rawBody.teacherVoiceConfig.modelId,
              voiceId: rawBody.teacherVoiceConfig.voiceId,
            },
          }
        : {}),
    };
    const { requirement } = body;

    if (!requirement) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing required field: requirement');
    }

    if (courseTagIds.length === 0) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing required field: courseTagIds');
    }

    const baseUrl = buildRequestOrigin(req);
    const jobId = nanoid(10);
    const job = await createClassroomGenerationJob(jobId, body);
    const pollUrl = `${baseUrl}/api/generate-classroom/${jobId}`;

    after(() => runClassroomGenerationJob(jobId, body, baseUrl));

    return apiSuccess(
      {
        jobId,
        status: job.status,
        step: job.step,
        message: job.message,
        pollUrl,
        pollIntervalMs: 5000,
      },
      202,
    );
  } catch (error) {
    log.error(
      `Classroom generation job creation failed [requirement="${requirementSnippet ?? 'unknown'}..."]:`,
      error,
    );
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Failed to create classroom generation job',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}
