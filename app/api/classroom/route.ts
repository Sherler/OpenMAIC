import { type NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { apiSuccess, apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import {
  buildRequestOrigin,
  isValidClassroomId,
  persistClassroom,
  readClassroom,
  writeJsonFileAtomic,
  CLASSROOMS_DIR,
} from '@/lib/server/classroom-storage';
import { writeClassroomManifest } from '@/lib/server/classroom-manifest';
import { createLogger } from '@/lib/logger';
import { filterValidCourseTagIds, resolveCourseTags } from '@/lib/server/course-tags';
import path from 'path';

const log = createLogger('Classroom API');

export async function POST(request: NextRequest) {
  let stageId: string | undefined;
  let sceneCount: number | undefined;
  try {
    const body = await request.json();
    const { stage, scenes } = body;
    stageId = stage?.id;
    sceneCount = scenes?.length;

    if (!stage || !scenes) {
      return apiError(
        API_ERROR_CODES.MISSING_REQUIRED_FIELD,
        400,
        'Missing required fields: stage, scenes',
      );
    }

    const id = stage.id || randomUUID();
    const baseUrl = buildRequestOrigin(request);

    const persisted = await persistClassroom({ id, stage: { ...stage, id }, scenes }, baseUrl);

    // Write manifest for viewer (consumer) package — non-blocking
    writeClassroomManifest(id, { ...stage, id }, scenes).catch((err) => {
      log.warn(`Manifest write failed for ${id}:`, err);
    });

    return apiSuccess({ id: persisted.id, url: persisted.url }, 201);
  } catch (error) {
    log.error(
      `Classroom storage failed [stageId=${stageId ?? 'unknown'}, scenes=${sceneCount ?? 0}]:`,
      error,
    );
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to store classroom',
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get('id');

    if (!id) {
      return apiError(
        API_ERROR_CODES.MISSING_REQUIRED_FIELD,
        400,
        'Missing required parameter: id',
      );
    }

    if (!isValidClassroomId(id)) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 400, 'Invalid classroom id');
    }

    const classroom = await readClassroom(id);
    if (!classroom) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'Classroom not found');
    }

    return apiSuccess({ classroom });
  } catch (error) {
    log.error(
      `Classroom retrieval failed [id=${request.nextUrl.searchParams.get('id') ?? 'unknown'}]:`,
      error,
    );
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to retrieve classroom',
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * PATCH /api/classroom?id=xxx  — Update classroom metadata (e.g. title, tags).
 *
 * Body: { title?: string, name?: string, courseTagIds?: string[] }
 */
export async function PATCH(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get('id');

    if (!id) {
      return apiError(API_ERROR_CODES.MISSING_REQUIRED_FIELD, 400, 'Missing required parameter: id');
    }

    if (!isValidClassroomId(id)) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 400, 'Invalid classroom id');
    }

    const classroom = await readClassroom(id);
    if (!classroom) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'Classroom not found');
    }

    const body = await request.json();
    let changed = false;
    const nextTitle =
      typeof body.title === 'string'
        ? body.title.trim()
        : typeof body.name === 'string'
          ? body.name.trim()
          : undefined;

    if (nextTitle) {
      classroom.stage.name = nextTitle;
      changed = true;
    }

    if (body.courseTagIds !== undefined) {
      if (!Array.isArray(body.courseTagIds)) {
        return apiError(
          API_ERROR_CODES.INVALID_REQUEST,
          400,
          'courseTagIds must be an array of valid course tag ids',
        );
      }

      const rawTagIds = body.courseTagIds;
      const uniqueStringTagIds = Array.from(
        new Set(rawTagIds.filter((item): item is string => typeof item === 'string')),
      );
      const courseTagIds = await filterValidCourseTagIds(rawTagIds);
      if (uniqueStringTagIds.length !== rawTagIds.length || courseTagIds.length !== uniqueStringTagIds.length) {
        return apiError(
          API_ERROR_CODES.INVALID_REQUEST,
          400,
          'courseTagIds contains invalid tag ids',
        );
      }

      classroom.stage.courseTagIds = courseTagIds;
      changed = true;
    }

    if (!changed) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 400, 'No valid fields to update');
    }

    classroom.stage.updatedAt = Date.now();

    const filePath = path.join(CLASSROOMS_DIR, `${id}.json`);
    await writeJsonFileAtomic(filePath, classroom);

    writeClassroomManifest(id, classroom.stage, classroom.scenes).catch((err) => {
      log.warn(`Manifest write failed for ${id}:`, err);
    });

    const courseTags = await resolveCourseTags(classroom.stage.courseTagIds);

    return apiSuccess({
      id,
      title: classroom.stage.name,
      name: classroom.stage.name,
      courseTagIds: classroom.stage.courseTagIds || [],
      courseTags,
    });
  } catch (error) {
    log.error(
      `Classroom patch failed [id=${request.nextUrl.searchParams.get('id') ?? 'unknown'}]:`,
      error,
    );
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to update classroom',
      error instanceof Error ? error.message : String(error),
    );
  }
}
