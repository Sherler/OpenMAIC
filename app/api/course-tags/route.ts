import { apiError, apiSuccess } from '@/lib/server/api-response';
import { readCourseTags } from '@/lib/server/course-tags';
import { createLogger } from '@/lib/logger';

const log = createLogger('CourseTags API');

export async function GET() {
  try {
    const courseTags = await readCourseTags();
    return apiSuccess({ courseTags });
  } catch (error) {
    log.error('Failed to read course tags:', error);
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Failed to load course tags',
      error instanceof Error ? error.message : String(error),
    );
  }
}