import { promises as fs } from 'fs';
import path from 'path';
import type {
  ClassroomGenerationProgress,
  ClassroomGenerationStep,
  GenerateClassroomInput,
  GenerateClassroomResult,
} from '@/lib/server/classroom-generation';
import {
  CLASSROOM_JOBS_DIR,
  ensureClassroomJobsDir,
  writeJsonFileAtomic,
} from '@/lib/server/classroom-storage';
import type { CourseTagId } from '@/lib/constants/course-tags';

export type ClassroomGenerationJobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface ClassroomGenerationJob {
  id: string;
  status: ClassroomGenerationJobStatus;
  step: ClassroomGenerationStep | 'queued' | 'failed';
  progress: number;
  message: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  inputSummary: {
    requirementPreview: string;
    courseTagIds?: CourseTagId[];
    hasPdf: boolean;
    pdfTextLength: number;
    pdfImageCount: number;
  };
  /** Full input preserved for retry */
  input?: GenerateClassroomInput;
  /** The classroom/stage ID being generated (set once generation starts) */
  stageId?: string;
  scenesGenerated: number;
  totalScenes?: number;
  /** Scene outline titles, populated after outline generation */
  outlineTitles?: string[];
  /** 0-based index of the scene currently being generated */
  currentSceneIndex?: number;
  result?: {
    classroomId: string;
    url: string;
    scenesCount: number;
  };
  error?: string;
}

function jobFilePath(jobId: string) {
  return path.join(CLASSROOM_JOBS_DIR, `${jobId}.json`);
}

function buildInputSummary(input: GenerateClassroomInput): ClassroomGenerationJob['inputSummary'] {
  return {
    requirementPreview:
      input.requirement.length > 200 ? `${input.requirement.slice(0, 197)}...` : input.requirement,
    courseTagIds: input.courseTagIds,
    hasPdf: !!input.pdfContent,
    pdfTextLength: input.pdfContent?.text.length || 0,
    pdfImageCount: input.pdfContent?.images.length || 0,
  };
}

function normalizeCourseTagIds(value: unknown): CourseTagId[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const ids = value.filter((item): item is CourseTagId => typeof item === 'string');
  return ids.length > 0 ? Array.from(new Set(ids)) : undefined;
}

function normalizeInputSummary(
  inputSummary: ClassroomGenerationJob['inputSummary'] | undefined,
  input?: GenerateClassroomInput,
): ClassroomGenerationJob['inputSummary'] {
  const legacySummary = inputSummary as ClassroomGenerationJob['inputSummary'] & {
    courseTagIds?: CourseTagId[];
    courseTag?: string;
  };
  const legacyInput = (input || {}) as GenerateClassroomInput & {
    courseTagIds?: CourseTagId[];
    courseTag?: string;
  };
  const normalizedCourseTagIds =
    normalizeCourseTagIds(legacySummary?.courseTagIds) ||
    normalizeCourseTagIds(legacyInput?.courseTagIds) ||
    (typeof legacySummary?.courseTag === 'string'
      ? [legacySummary.courseTag]
      : typeof legacyInput?.courseTag === 'string'
        ? [legacyInput.courseTag]
        : undefined);

  if (inputSummary) {
    return {
      ...inputSummary,
      ...(normalizedCourseTagIds ? { courseTagIds: normalizedCourseTagIds } : {}),
    };
  }

  if (input) {
    return buildInputSummary(input);
  }

  return {
    requirementPreview: '',
    hasPdf: false,
    pdfTextLength: 0,
    pdfImageCount: 0,
  };
}

function normalizeJob(job: ClassroomGenerationJob): ClassroomGenerationJob {
  return {
    ...job,
    inputSummary: normalizeInputSummary(job.inputSummary, job.input),
  };
}

/** Simple per-job mutex to serialize read-modify-write on the same job file. */
const jobLocks = new Map<string, Promise<void>>();

async function withJobLock<T>(jobId: string, fn: () => Promise<T>): Promise<T> {
  const prev = jobLocks.get(jobId) ?? Promise.resolve();
  let resolve: () => void;
  const next = new Promise<void>((r) => {
    resolve = r;
  });
  jobLocks.set(jobId, next);
  try {
    await prev;
    return await fn();
  } finally {
    resolve!();
    if (jobLocks.get(jobId) === next) jobLocks.delete(jobId);
  }
}

/** Max age (ms) before a "running" job without an active runner is considered stale. */
const STALE_JOB_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

function markStaleIfNeeded(job: ClassroomGenerationJob): ClassroomGenerationJob {
  if (job.status !== 'running') return job;
  const updatedAt = new Date(job.updatedAt).getTime();
  if (Date.now() - updatedAt > STALE_JOB_TIMEOUT_MS) {
    return {
      ...job,
      status: 'failed',
      step: 'failed',
      message: 'Job appears stale (no progress update for 30 minutes)',
      error: 'Stale job: process may have restarted during generation',
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
  return job;
}

export function isValidClassroomJobId(jobId: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(jobId);
}

export async function createClassroomGenerationJob(
  jobId: string,
  input: GenerateClassroomInput,
): Promise<ClassroomGenerationJob> {
  const now = new Date().toISOString();
  const job: ClassroomGenerationJob = {
    id: jobId,
    status: 'queued',
    step: 'queued',
    progress: 0,
    message: 'Classroom generation job queued',
    createdAt: now,
    updatedAt: now,
    inputSummary: buildInputSummary(input),
    input,
    scenesGenerated: 0,
  };

  await ensureClassroomJobsDir();
  await writeJsonFileAtomic(jobFilePath(jobId), job);
  return job;
}

export async function readClassroomGenerationJob(
  jobId: string,
): Promise<ClassroomGenerationJob | null> {
  try {
    const content = await fs.readFile(jobFilePath(jobId), 'utf-8');
    const job = normalizeJob(JSON.parse(content) as ClassroomGenerationJob);
    return markStaleIfNeeded(job);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function updateClassroomGenerationJob(
  jobId: string,
  patch: Partial<ClassroomGenerationJob>,
): Promise<ClassroomGenerationJob> {
  return withJobLock(jobId, async () => {
    const existing = await readClassroomGenerationJob(jobId);
    if (!existing) {
      throw new Error(`Classroom generation job not found: ${jobId}`);
    }

    const updated: ClassroomGenerationJob = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
    };

    await writeJsonFileAtomic(jobFilePath(jobId), updated);
    return updated;
  });
}

export async function markClassroomGenerationJobRunning(
  jobId: string,
): Promise<ClassroomGenerationJob> {
  return withJobLock(jobId, async () => {
    const existing = await readClassroomGenerationJob(jobId);
    if (!existing) {
      throw new Error(`Classroom generation job not found: ${jobId}`);
    }

    const updated: ClassroomGenerationJob = {
      ...existing,
      status: 'running',
      startedAt: existing.startedAt || new Date().toISOString(),
      message: 'Classroom generation started',
      updatedAt: new Date().toISOString(),
    };

    await writeJsonFileAtomic(jobFilePath(jobId), updated);
    return updated;
  });
}

export async function updateClassroomGenerationJobProgress(
  jobId: string,
  progress: ClassroomGenerationProgress,
): Promise<ClassroomGenerationJob> {
  const patch: Partial<ClassroomGenerationJob> = {
    status: 'running',
    step: progress.step,
    progress: progress.progress,
    message: progress.message,
    scenesGenerated: progress.scenesGenerated,
    totalScenes: progress.totalScenes,
    currentSceneIndex: progress.currentSceneIndex,
  };
  if (progress.outlineTitles) {
    patch.outlineTitles = progress.outlineTitles;
  }
  if (progress.stageId) {
    patch.stageId = progress.stageId;
  }
  return updateClassroomGenerationJob(jobId, patch);
}

export async function markClassroomGenerationJobSucceeded(
  jobId: string,
  result: GenerateClassroomResult,
): Promise<ClassroomGenerationJob> {
  return updateClassroomGenerationJob(jobId, {
    status: 'succeeded',
    step: 'completed',
    progress: 100,
    message: 'Classroom generation completed',
    completedAt: new Date().toISOString(),
    scenesGenerated: result.scenesCount,
    result: {
      classroomId: result.id,
      url: result.url,
      scenesCount: result.scenesCount,
    },
  });
}

export async function markClassroomGenerationJobFailed(
  jobId: string,
  error: string,
): Promise<ClassroomGenerationJob> {
  return updateClassroomGenerationJob(jobId, {
    status: 'failed',
    step: 'failed',
    message: 'Classroom generation failed',
    completedAt: new Date().toISOString(),
    error,
  });
}

/** List all generation jobs, newest first. */
export async function listClassroomGenerationJobs(): Promise<ClassroomGenerationJob[]> {
  await ensureClassroomJobsDir();
  const entries = await fs.readdir(CLASSROOM_JOBS_DIR, { withFileTypes: true });
  const jobs: ClassroomGenerationJob[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json') || entry.name.includes('.checkpoint.')) continue;
    try {
      const content = await fs.readFile(path.join(CLASSROOM_JOBS_DIR, entry.name), 'utf-8');
      const job = markStaleIfNeeded(normalizeJob(JSON.parse(content) as ClassroomGenerationJob));
      jobs.push(job);
    } catch {
      // skip malformed files
    }
  }

  jobs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return jobs;
}
