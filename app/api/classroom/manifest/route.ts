import { type NextRequest } from 'next/server';
import { apiSuccess, apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import { isValidClassroomId } from '@/lib/server/classroom-storage';
import { readClassroomManifest } from '@/lib/server/classroom-manifest';
import { createLogger } from '@/lib/logger';

const log = createLogger('Classroom Manifest API');

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

    const manifest = await readClassroomManifest(id);
    if (!manifest) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'Classroom manifest not found');
    }

    return apiSuccess({ manifest });
  } catch (error) {
    log.error(
      `Classroom manifest retrieval failed [id=${request.nextUrl.searchParams.get('id') ?? 'unknown'}]:`,
      error,
    );
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to retrieve classroom manifest',
      error instanceof Error ? error.message : String(error),
    );
  }
}
