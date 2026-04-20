import { apiSuccess, apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import { listClassrooms } from '@/lib/server/classroom-storage';
import { createLogger } from '@/lib/logger';
import { filterValidCourseTagIds } from '@/lib/server/course-tags';

const log = createLogger('Classroom List API');

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const rawTagIds = [
      ...url.searchParams.getAll('tagId'),
      ...url.searchParams
        .getAll('tagIds')
        .flatMap((value) => value.split(','))
        .map((value) => value.trim())
        .filter(Boolean),
    ];
    const tagIds = await filterValidCourseTagIds(rawTagIds);
    const rawMatch = url.searchParams.get('match');
    const match = rawMatch === 'all' ? 'all' : 'any';

    if (rawTagIds.length > 0 && tagIds.length === 0) {
      return apiError(
        API_ERROR_CODES.INVALID_REQUEST,
        400,
        'Invalid tag filter. Use tagId or tagIds with valid course tag ids.',
      );
    }

    const classrooms = await listClassrooms({ tagIds, match });
    return apiSuccess({ classrooms });
  } catch (error) {
    log.error('Failed to list classrooms:', error);
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to list classrooms',
      error instanceof Error ? error.message : String(error),
    );
  }
}
