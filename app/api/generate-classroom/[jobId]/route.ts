import { after, type NextRequest } from 'next/server';
import { nanoid } from 'nanoid';
import { promises as fs } from 'fs';
import path from 'path';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import {
  isValidClassroomJobId,
  readClassroomGenerationJob,
  createClassroomGenerationJob,
} from '@/lib/server/classroom-job-store';
import {
  runClassroomGenerationJob,
  cancelClassroomGenerationJob,
  writeCancelSentinel,
} from '@/lib/server/classroom-job-runner';
import { buildRequestOrigin, CLASSROOM_JOBS_DIR } from '@/lib/server/classroom-storage';
import { createLogger } from '@/lib/logger';
import { resolveCourseTags } from '@/lib/server/course-tags';

const log = createLogger('ClassroomJob API');

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, context: { params: Promise<{ jobId: string }> }) {
  let resolvedJobId: string | undefined;
  try {
    const { jobId } = await context.params;
    resolvedJobId = jobId;

    if (!isValidClassroomJobId(jobId)) {
      return apiError('INVALID_REQUEST', 400, 'Invalid classroom generation job id');
    }

    const job = await readClassroomGenerationJob(jobId);
    if (!job) {
      return apiError('INVALID_REQUEST', 404, 'Classroom generation job not found');
    }

    const pollUrl = `${buildRequestOrigin(req)}/api/generate-classroom/${jobId}`;
    const courseTags = await resolveCourseTags(job.inputSummary.courseTagIds);

    return apiSuccess({
      jobId: job.id,
      status: job.status,
      step: job.step,
      progress: job.progress,
      message: job.message,
      courseTagIds: job.inputSummary.courseTagIds || [],
      courseTags,
      pollUrl,
      pollIntervalMs: 5000,
      scenesGenerated: job.scenesGenerated,
      totalScenes: job.totalScenes,
      currentSceneIndex: job.currentSceneIndex,
      outlineTitles: job.outlineTitles,
      stageId: job.stageId,
      result: job.result,
      error: job.error,
      done: job.status === 'succeeded' || job.status === 'failed',
    });
  } catch (error) {
    log.error(`Classroom job retrieval failed [jobId=${resolvedJobId ?? 'unknown'}]:`, error);
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Failed to retrieve classroom generation job',
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * POST /api/generate-classroom/[jobId]  — Retry or continue a failed/cancelled job.
 *
 * Body (optional):
 *   { supplement?: string, mode?: 'retry' | 'continue' }
 *
 * - mode='retry' (default): Creates a new job from scratch, optionally appending supplement text.
 * - mode='continue': Creates a new job that resumes from the checkpoint. Copies the checkpoint
 *   from the old job so the new job can skip already-completed scenes.
 *
 * Both modes accept an optional `supplement` string that is appended to the original requirement.
 */
export async function POST(req: NextRequest, context: { params: Promise<{ jobId: string }> }) {
  let resolvedJobId: string | undefined;
  try {
    const { jobId } = await context.params;
    resolvedJobId = jobId;

    if (!isValidClassroomJobId(jobId)) {
      return apiError('INVALID_REQUEST', 400, 'Invalid classroom generation job id');
    }

    const existingJob = await readClassroomGenerationJob(jobId);
    if (!existingJob) {
      return apiError('INVALID_REQUEST', 404, 'Classroom generation job not found');
    }

    if (existingJob.status !== 'failed') {
      return apiError(
        'INVALID_REQUEST',
        409,
        `Cannot retry a job with status "${existingJob.status}". Only failed jobs can be retried.`,
      );
    }

    if (!existingJob.input) {
      return apiError(
        'INVALID_REQUEST',
        422,
        'Cannot retry: original input was not preserved in this job (created before retry support).',
      );
    }

    // Parse optional body
    let supplement: string | undefined;
    let mode: 'retry' | 'continue' = 'retry';
    try {
      const body = await req.json();
      if (body && typeof body === 'object') {
        if (typeof body.supplement === 'string' && body.supplement.trim()) {
          supplement = body.supplement.trim();
        }
        if (body.mode === 'continue') {
          mode = 'continue';
        }
      }
    } catch {
      // No body or invalid JSON — that's fine, defaults to retry without supplement
    }

    // Build new input — optionally append supplement to requirement
    const newInput = { ...existingJob.input };
    if (supplement) {
      newInput.requirement = `${existingJob.input.requirement}\n\n---\n补充要求：${supplement}`;
    }

    const baseUrl = buildRequestOrigin(req);
    const newJobId = nanoid(10);
    const newJob = await createClassroomGenerationJob(newJobId, newInput);
    const pollUrl = `${baseUrl}/api/generate-classroom/${newJobId}`;

    // If mode='continue', copy checkpoint from old job to new job
    if (mode === 'continue') {
      try {
        const oldCheckpointPath = path.join(CLASSROOM_JOBS_DIR, `${jobId}.checkpoint.json`);
        const newCheckpointPath = path.join(CLASSROOM_JOBS_DIR, `${newJobId}.checkpoint.json`);
        const cpContent = await fs.readFile(oldCheckpointPath, 'utf-8');
        const cp = JSON.parse(cpContent);
        // Update jobId in the checkpoint to match the new job
        cp.jobId = newJobId;
        await fs.writeFile(newCheckpointPath, JSON.stringify(cp, null, 2), 'utf-8');
        log.info(`Copied checkpoint from ${jobId} → ${newJobId} for continue`);
      } catch (cpErr) {
        log.warn(`No checkpoint to copy from ${jobId}, will generate from scratch:`, cpErr);
      }
    }

    log.info(`${mode === 'continue' ? 'Continuing' : 'Retrying'} failed job ${jobId} → new job ${newJobId}${supplement ? ' (with supplement)' : ''}`);

    after(() => runClassroomGenerationJob(newJobId, newInput, baseUrl));

    return apiSuccess(
      {
        jobId: newJobId,
        status: newJob.status,
        step: newJob.step,
        message: newJob.message,
        pollUrl,
        pollIntervalMs: 5000,
        retriedFrom: jobId,
        mode,
      },
      202,
    );
  } catch (error) {
    log.error(`Classroom job retry failed [jobId=${resolvedJobId ?? 'unknown'}]:`, error);
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Failed to retry classroom generation job',
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * DELETE /api/generate-classroom/[jobId]  — Cancel a running job.
 */
export async function DELETE(_req: NextRequest, context: { params: Promise<{ jobId: string }> }) {
  let resolvedJobId: string | undefined;
  try {
    const { jobId } = await context.params;
    resolvedJobId = jobId;

    if (!isValidClassroomJobId(jobId)) {
      return apiError('INVALID_REQUEST', 400, 'Invalid classroom generation job id');
    }

    const job = await readClassroomGenerationJob(jobId);
    if (!job) {
      return apiError('INVALID_REQUEST', 404, 'Classroom generation job not found');
    }

    if (job.status !== 'running' && job.status !== 'queued') {
      return apiError(
        'INVALID_REQUEST',
        409,
        `Cannot cancel a job with status "${job.status}". Only running/queued jobs can be cancelled.`,
      );
    }

    const cancelled = cancelClassroomGenerationJob(jobId);
    if (!cancelled) {
      // Runner not in memory (server restart / HMR) — write a cancel sentinel file
      // so the pipeline can detect it at the next checkAborted() call.
      await writeCancelSentinel(jobId);
      log.info(`Wrote cancel sentinel for job ${jobId} (runner not in memory)`);
    }

    return apiSuccess({ jobId, cancelled: true });
  } catch (error) {
    log.error(`Classroom job cancel failed [jobId=${resolvedJobId ?? 'unknown'}]:`, error);
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Failed to cancel classroom generation job',
      error instanceof Error ? error.message : String(error),
    );
  }
}
