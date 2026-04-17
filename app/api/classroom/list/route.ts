import { apiSuccess, apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import { listClassrooms } from '@/lib/server/classroom-storage';
import { createLogger } from '@/lib/logger';

const log = createLogger('Classroom List API');

export async function GET() {
  try {
    const classrooms = await listClassrooms();
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
