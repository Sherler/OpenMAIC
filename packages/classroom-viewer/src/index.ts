/**
 * @openmaic/classroom-viewer
 *
 * Standalone classroom viewer package (consumer side).
 * Given a resource ID and a base URL, fetches and provides classroom data
 * for rendering by the viewer components.
 *
 * ## Architecture
 *
 * OpenMAIC separates into two sides:
 * - **Producer** (main app): Generates classroom content (outlines, scenes, media, TTS)
 *   and persists them to local file paths under `data/classrooms/{id}/`.
 * - **Consumer** (this package): Given a classroom ID, fetches and displays the
 *   generated resources via a read-only viewer.
 *
 * ## Local File Structure
 *
 * Each classroom is packaged at:
 * ```
 * data/classrooms/{id}/
 * ├── manifest.json          # Complete manifest with stage, scenes, agents, mediaIndex
 * ├── media/                 # Generated images and videos
 * │   ├── {elementId}.png
 * │   ├── {elementId}.mp4
 * │   └── ...
 * └── audio/                 # TTS audio files
 *     ├── tts_{actionId}.mp3
 *     └── ...
 * ```
 *
 * The companion `{id}.json` at `data/classrooms/{id}.json` provides
 * the raw PersistedClassroomData (stage + scenes).
 *
 * ## Usage
 *
 * ```ts
 * import { ClassroomAPIClient } from '@openmaic/classroom-viewer/api-client';
 *
 * const client = new ClassroomAPIClient({ baseUrl: 'http://localhost:3000' });
 *
 * // List all available classrooms
 * const classrooms = await client.listClassrooms();
 *
 * // Load a specific classroom
 * const data = await client.getClassroom('classroom-id');
 *
 * // Load the full manifest (includes media index)
 * const manifest = await client.getManifest('classroom-id');
 *
 * // Get media URL
 * const imageUrl = client.getMediaUrl('classroom-id', 'media/gen_img_1.png');
 * ```
 */

export { ClassroomAPIClient } from './api-client';
export type {
  ViewerConfig,
  ClassroomListItem,
  ClassroomData,
  ClassroomManifest,
  ManifestStage,
  ManifestAgent,
  ManifestScene,
  MediaIndexEntry,
} from './types';
