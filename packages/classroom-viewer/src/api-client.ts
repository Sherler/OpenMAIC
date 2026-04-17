/**
 * API client for the classroom viewer (consumer side).
 *
 * Communicates with the OpenMAIC server to fetch classroom data,
 * manifests, and media resources. Designed to be usable from any
 * JavaScript/TypeScript environment (browser, Node.js, etc.).
 */

import type {
  ViewerConfig,
  ClassroomListItem,
  ClassroomData,
  ClassroomManifest,
} from './types';

export class ClassroomAPIClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof globalThis.fetch;

  constructor(config: ViewerConfig) {
    // Strip trailing slash
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.fetchFn = config.fetch ?? globalThis.fetch.bind(globalThis);
  }

  // ─── List ────────────────────────────────────────────────────

  /**
   * List all available classrooms sorted by creation date (newest first).
   */
  async listClassrooms(): Promise<ClassroomListItem[]> {
    const res = await this.fetchFn(`${this.baseUrl}/api/classroom/list`);
    if (!res.ok) {
      throw new Error(`Failed to list classrooms: ${res.status} ${res.statusText}`);
    }
    const json = await res.json();
    if (!json.success) {
      throw new Error(json.error || 'Failed to list classrooms');
    }
    return json.classrooms;
  }

  // ─── Classroom data ──────────────────────────────────────────

  /**
   * Get classroom data (stage + scenes) by ID.
   */
  async getClassroom(id: string): Promise<ClassroomData> {
    const res = await this.fetchFn(
      `${this.baseUrl}/api/classroom?id=${encodeURIComponent(id)}`,
    );
    if (!res.ok) {
      throw new Error(`Failed to get classroom: ${res.status} ${res.statusText}`);
    }
    const json = await res.json();
    if (!json.success) {
      throw new Error(json.error || 'Classroom not found');
    }
    return json.classroom;
  }

  // ─── Manifest ────────────────────────────────────────────────

  /**
   * Get the full classroom manifest (includes media index and agents).
   */
  async getManifest(id: string): Promise<ClassroomManifest> {
    const res = await this.fetchFn(
      `${this.baseUrl}/api/classroom/manifest?id=${encodeURIComponent(id)}`,
    );
    if (!res.ok) {
      throw new Error(`Failed to get manifest: ${res.status} ${res.statusText}`);
    }
    const json = await res.json();
    if (!json.success) {
      throw new Error(json.error || 'Manifest not found');
    }
    return json.manifest;
  }

  // ─── Media URLs ──────────────────────────────────────────────

  /**
   * Build the URL for a classroom media file.
   *
   * @param classroomId - The classroom ID
   * @param mediaPath - Relative media path (e.g. 'media/gen_img_1.png' or 'audio/tts_abc.mp3')
   */
  getMediaUrl(classroomId: string, mediaPath: string): string {
    return `${this.baseUrl}/api/classroom-media/${encodeURIComponent(classroomId)}/${mediaPath}`;
  }
}
