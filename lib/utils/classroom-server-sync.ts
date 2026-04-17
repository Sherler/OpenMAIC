/**
 * Sync classroom data to server-side file storage.
 *
 * The client-side generation flow saves only to IndexedDB (browser).
 * This utility POSTs the stage + scenes to `/api/classroom` so the
 * server also writes `data/classrooms/{id}.json`, making the data
 * available to external consumers (e.g. OpenMAIC-Viewer).
 */

import { createLogger } from '@/lib/logger';

const log = createLogger('ClassroomSync');

export async function syncClassroomToServer(
  stage: { id: string },
  scenes: unknown[],
): Promise<boolean> {
  try {
    const res = await fetch('/api/classroom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage, scenes }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      log.warn(`Server sync failed (HTTP ${res.status}):`, text);
      return false;
    }

    log.info(`Classroom synced to server: ${stage.id}`);
    return true;
  } catch (err) {
    log.warn('Server sync request failed:', err);
    return false;
  }
}
