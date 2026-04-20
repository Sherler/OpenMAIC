import { promises as fs } from 'fs';
import path from 'path';
import type { NextRequest } from 'next/server';
import type { Scene, Stage } from '@/lib/types/stage';
import type { CourseTagDefinition } from '@/lib/constants/course-tags';
import { resolveCourseTags } from '@/lib/server/course-tags';

export const CLASSROOMS_DIR = path.join(process.cwd(), 'data', 'classrooms');
export const CLASSROOM_JOBS_DIR = path.join(process.cwd(), 'data', 'classroom-jobs');

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

export async function ensureClassroomsDir() {
  await ensureDir(CLASSROOMS_DIR);
}

export async function ensureClassroomJobsDir() {
  await ensureDir(CLASSROOM_JOBS_DIR);
}

// ─── Cancel sentinel (file-based, survives HMR / server restarts) ───

function cancelSentinelPath(jobId: string) {
  return path.join(CLASSROOM_JOBS_DIR, `${jobId}.cancel`);
}

/** Write a cancel sentinel so the pipeline can detect cancellation even without in-memory state. */
export async function writeCancelSentinel(jobId: string): Promise<void> {
  try {
    await fs.writeFile(cancelSentinelPath(jobId), new Date().toISOString(), 'utf-8');
  } catch {
    // best-effort
  }
}

/** Remove cancel sentinel (called from finally). */
export async function removeCancelSentinel(jobId: string): Promise<void> {
  try {
    await fs.unlink(cancelSentinelPath(jobId));
  } catch {
    // file may not exist
  }
}

/** Check if a cancel sentinel file exists for a job. */
export async function hasCancelSentinel(jobId: string): Promise<boolean> {
  try {
    await fs.access(cancelSentinelPath(jobId));
    return true;
  } catch {
    return false;
  }
}

export async function writeJsonFileAtomic(filePath: string, data: unknown) {
  const dir = path.dirname(filePath);
  await ensureDir(dir);

  const tempFilePath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const content = JSON.stringify(data, null, 2);
  await fs.writeFile(tempFilePath, content, 'utf-8');
  await fs.rename(tempFilePath, filePath);
}

export function buildRequestOrigin(req: NextRequest): string {
  return req.headers.get('x-forwarded-host')
    ? `${req.headers.get('x-forwarded-proto') || 'http'}://${req.headers.get('x-forwarded-host')}`
    : req.nextUrl.origin;
}

export interface PersistedClassroomData {
  id: string;
  stage: Stage;
  scenes: Scene[];
  createdAt: string;
}

export function isValidClassroomId(id: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

export async function readClassroom(id: string): Promise<PersistedClassroomData | null> {
  const filePath = path.join(CLASSROOMS_DIR, `${id}.json`);
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as PersistedClassroomData;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function persistClassroom(
  data: {
    id: string;
    stage: Stage;
    scenes: Scene[];
  },
  baseUrl: string,
): Promise<PersistedClassroomData & { url: string }> {
  const classroomData: PersistedClassroomData = {
    id: data.id,
    stage: data.stage,
    scenes: data.scenes,
    createdAt: new Date().toISOString(),
  };

  await ensureClassroomsDir();
  const filePath = path.join(CLASSROOMS_DIR, `${data.id}.json`);
  await writeJsonFileAtomic(filePath, classroomData);

  return {
    ...classroomData,
    url: `${baseUrl}/classroom/${data.id}`,
  };
}

export interface ClassroomListItem {
  id: string;
  name: string;
  description?: string;
  courseTags: CourseTagDefinition[];
  createdAt: string;
  hasManifest: boolean;
}

export async function listClassrooms(options?: {
  tagIds?: string[];
  match?: 'any' | 'all';
}): Promise<ClassroomListItem[]> {
  await ensureClassroomsDir();
  const entries = await fs.readdir(CLASSROOMS_DIR, { withFileTypes: true });
  const items: ClassroomListItem[] = [];
  const filterTagIds = options?.tagIds || [];
  const matchMode = options?.match || 'any';

  for (const entry of entries) {
    // Match {id}.json files at top level
    if (entry.isFile() && entry.name.endsWith('.json')) {
      const id = entry.name.replace(/\.json$/, '');
      if (!isValidClassroomId(id)) continue;

      try {
        const data = await readClassroom(id);
        if (!data) continue;

        // Check if manifest exists
        const manifestPath = path.join(CLASSROOMS_DIR, id, 'manifest.json');
        let hasManifest = false;
        try {
          await fs.access(manifestPath);
          hasManifest = true;
        } catch {
          // no manifest
        }

        const courseTags = await resolveCourseTags(data.stage.courseTagIds);
        if (filterTagIds.length > 0) {
          const classroomTagIds = new Set(courseTags.map((tag) => tag.id));
          const matched =
            matchMode === 'all'
              ? filterTagIds.every((tagId) => classroomTagIds.has(tagId))
              : filterTagIds.some((tagId) => classroomTagIds.has(tagId));
          if (!matched) {
            continue;
          }
        }

        items.push({
          id: data.id,
          name: data.stage.name,
          description: data.stage.description,
          courseTags,
          createdAt: data.createdAt,
          hasManifest,
        });
      } catch {
        // skip corrupted files
      }
    }
  }

  // Sort by creation date, newest first
  items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return items;
}
