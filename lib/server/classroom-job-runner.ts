import { createLogger } from '@/lib/logger';
import { generateClassroom, type GenerateClassroomInput } from '@/lib/server/classroom-generation';
import {
  markClassroomGenerationJobFailed,
  markClassroomGenerationJobRunning,
  markClassroomGenerationJobSucceeded,
  updateClassroomGenerationJobProgress,
} from '@/lib/server/classroom-job-store';
import {
  writeCancelSentinel,
  removeCancelSentinel,
} from '@/lib/server/classroom-storage';

const log = createLogger('ClassroomJob');
const runningJobs = new Map<string, Promise<void>>();
const jobAbortControllers = new Map<string, AbortController>();

export { writeCancelSentinel };

export function runClassroomGenerationJob(
  jobId: string,
  input: GenerateClassroomInput,
  baseUrl: string,
): Promise<void> {
  const existing = runningJobs.get(jobId);
  if (existing) {
    return existing;
  }

  const abortController = new AbortController();
  jobAbortControllers.set(jobId, abortController);

  const jobPromise = (async () => {
    try {
      await markClassroomGenerationJobRunning(jobId);

      const result = await generateClassroom(input, {
        baseUrl,
        jobId,
        signal: abortController.signal,
        onProgress: async (progress) => {
          await updateClassroomGenerationJobProgress(jobId, progress);
        },
      });

      await markClassroomGenerationJobSucceeded(jobId, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isCancelled = abortController.signal.aborted;
      if (isCancelled) {
        log.info(`Classroom generation job ${jobId} was cancelled`);
      } else {
        log.error(`Classroom generation job ${jobId} failed:`, error);
      }
      try {
        await markClassroomGenerationJobFailed(
          jobId,
          isCancelled ? 'Generation cancelled by user' : message,
        );
      } catch (markFailedError) {
        log.error(`Failed to persist failed status for job ${jobId}:`, markFailedError);
      }
    } finally {
      runningJobs.delete(jobId);
      jobAbortControllers.delete(jobId);
      await removeCancelSentinel(jobId);
    }
  })();

  runningJobs.set(jobId, jobPromise);
  return jobPromise;
}

/**
 * Cancel a running generation job. Returns true if the job was found and cancelled.
 */
export function cancelClassroomGenerationJob(jobId: string): boolean {
  const controller = jobAbortControllers.get(jobId);
  if (!controller) return false;
  controller.abort();
  return true;
}
