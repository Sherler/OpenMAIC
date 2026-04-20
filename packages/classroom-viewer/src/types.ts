/**
 * Type definitions for the classroom viewer package.
 *
 * These types mirror the server-side types but are standalone —
 * the consumer package does not depend on the main app's type system.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface ViewerConfig {
  /** Base URL of the OpenMAIC server (e.g. 'http://localhost:3000') */
  baseUrl: string;
  /** Optional fetch implementation for custom environments */
  fetch?: typeof globalThis.fetch;
}

// ---------------------------------------------------------------------------
// Classroom list
// ---------------------------------------------------------------------------

export interface ClassroomListItem {
  id: string;
  name: string;
  description?: string;
  courseTags?: Array<{
    id: string;
    tag_name: string;
    manager_ids: string[];
  }>;
  createdAt: string;
  hasManifest: boolean;
}

// ---------------------------------------------------------------------------
// Classroom data (from GET /api/classroom?id=...)
// ---------------------------------------------------------------------------

export interface ClassroomData {
  id: string;
  stage: ClassroomStage;
  scenes: ClassroomScene[];
  createdAt: string;
}

export interface ClassroomStage {
  id: string;
  name: string;
  description?: string;
  courseTagIds?: string[];
  languageDirective?: string;
  style?: string;
  createdAt: number;
  updatedAt: number;
  agentIds?: string[];
  generatedAgentConfigs?: Array<{
    id: string;
    name: string;
    role: string;
    persona: string;
    avatar: string;
    color: string;
    priority: number;
  }>;
}

export type SceneType = 'slide' | 'quiz' | 'interactive' | 'pbl';

export interface ClassroomScene {
  id: string;
  stageId: string;
  type: SceneType;
  title: string;
  order: number;
  content: Record<string, unknown>;
  actions?: ClassroomAction[];
  whiteboards?: unknown[];
  multiAgent?: {
    enabled: boolean;
    agentIds?: string[];
    directorPrompt?: string;
  };
}

export interface ClassroomAction {
  id: string;
  type: string;
  agentId?: string;
  text?: string;
  audioId?: string;
  audioUrl?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Manifest (from GET /api/classroom/manifest?id=...)
// ---------------------------------------------------------------------------

export interface ClassroomManifest {
  formatVersion: number;
  exportedAt: string;
  appVersion: string;
  stage: ManifestStage;
  agents: ManifestAgent[];
  scenes: ManifestScene[];
  mediaIndex: Record<string, MediaIndexEntry>;
}

export interface ManifestStage {
  name: string;
  description?: string;
  language?: string;
  style?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ManifestAgent {
  name: string;
  role: string;
  persona: string;
  avatar: string;
  color: string;
  priority: number;
  voiceConfig?: { providerId: string; voiceId: string };
}

export interface ManifestScene {
  type: SceneType;
  title: string;
  order: number;
  content: Record<string, unknown>;
  actions?: ManifestAction[];
  whiteboards?: unknown[];
  multiAgent?: {
    enabled: boolean;
    agentIndices: number[];
    directorPrompt?: string;
  };
}

export interface ManifestAction {
  id: string;
  type: string;
  agentId?: string;
  text?: string;
  audioRef?: string;
  audioUrl?: string;
  [key: string]: unknown;
}

export interface MediaIndexEntry {
  type: 'audio' | 'image' | 'generated';
  mimeType?: string;
  format?: string;
  duration?: number;
  voice?: string;
  size?: number;
  prompt?: string;
  missing?: boolean;
}
