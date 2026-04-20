/**
 * Server-side classroom manifest generation.
 *
 * Writes a self-contained manifest.json into each classroom directory,
 * making it a complete, portable resource package that can be consumed
 * by the standalone viewer (consumer) without IndexedDB or client state.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { CLASSROOMS_DIR, writeJsonFileAtomic } from '@/lib/server/classroom-storage';
import { createLogger } from '@/lib/logger';
import type { Scene, Stage } from '@/lib/types/stage';
import type { SpeechAction } from '@/lib/types/action';
import type {
  ClassroomManifest,
  ManifestStage,
  ManifestAgent,
  ManifestScene,
  MediaIndexEntry,
} from '@/lib/export/classroom-zip-types';
import { CLASSROOM_ZIP_FORMAT_VERSION } from '@/lib/export/classroom-zip-types';

const log = createLogger('ClassroomManifest');

// ---------------------------------------------------------------------------
// Media index scanning
// ---------------------------------------------------------------------------

async function scanMediaDir(dirPath: string): Promise<Record<string, MediaIndexEntry>> {
  const index: Record<string, MediaIndexEntry> = {};
  try {
    const files = await fs.readdir(dirPath);
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) continue;

      const ext = path.extname(file).toLowerCase();
      const mimeMap: Record<string, string> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.ogg': 'audio/ogg',
        '.aac': 'audio/aac',
      };

      const isAudio = dirPath.endsWith('/audio') || dirPath.endsWith('\\audio');
      const prefix = isAudio ? 'audio' : 'media';
      const key = `${prefix}/${file}`;

      index[key] = {
        type: isAudio ? 'audio' : 'generated',
        mimeType: mimeMap[ext],
        size: stat.size,
      };
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.warn(`Failed to scan directory ${dirPath}:`, err);
    }
  }
  return index;
}

// ---------------------------------------------------------------------------
// Manifest writing
// ---------------------------------------------------------------------------

export async function writeClassroomManifest(
  classroomId: string,
  stage: Stage,
  scenes: Scene[],
  agents?: Array<{
    name: string;
    role: string;
    persona: string;
    avatar: string;
    color: string;
    priority: number;
    voiceConfig?: { providerId: string; modelId?: string; voiceId: string };
  }>,
): Promise<void> {
  const classroomDir = path.join(CLASSROOMS_DIR, classroomId);

  // Scan media and audio directories for the media index
  const mediaIndex: Record<string, MediaIndexEntry> = {
    ...(await scanMediaDir(path.join(classroomDir, 'media'))),
    ...(await scanMediaDir(path.join(classroomDir, 'audio'))),
  };

  // Build manifest stage
  const manifestStage: ManifestStage = {
    name: stage.name,
    description: stage.description,
    language: stage.languageDirective,
    style: stage.style,
    createdAt: stage.createdAt,
    updatedAt: stage.updatedAt,
  };

  // Build manifest agents
  const manifestAgents: ManifestAgent[] = [];
  if (agents && agents.length > 0) {
    for (const a of agents) {
      manifestAgents.push({
        name: a.name,
        role: a.role,
        persona: a.persona,
        avatar: a.avatar,
        color: a.color,
        priority: a.priority,
        ...(a.voiceConfig ? { voiceConfig: a.voiceConfig } : {}),
      });
    }
  } else if (stage.generatedAgentConfigs?.length) {
    for (const a of stage.generatedAgentConfigs) {
      manifestAgents.push({
        name: a.name,
        role: a.role,
        persona: a.persona,
        avatar: a.avatar,
        color: a.color,
        priority: a.priority,
        ...(a.voiceConfig ? { voiceConfig: a.voiceConfig } : {}),
      });
    }
  }

  // Build manifest scenes with audio references
  const manifestScenes: ManifestScene[] = scenes.map((scene) => {
    const actions = scene.actions?.map((action) => {
      if (action.type === 'speech') {
        const speech = action as SpeechAction;
        const { audioId, ...rest } = speech;
        const audioRef = audioId ? `audio/${audioId}.mp3` : undefined;
        return { ...rest, ...(audioRef ? { audioRef } : {}) };
      }
      return action;
    });

    return {
      type: scene.type,
      title: scene.title,
      order: scene.order,
      content: scene.content,
      actions,
      whiteboards: scene.whiteboards,
      ...(scene.multiAgent?.enabled
        ? {
            multiAgent: {
              enabled: true,
              agentIndices: scene.multiAgent.agentIds?.map((_, i) => i) ?? [],
              directorPrompt: scene.multiAgent.directorPrompt,
            },
          }
        : {}),
    } as ManifestScene;
  });

  const appVersion = process.env.npm_package_version || '0.0.0';

  const manifest: ClassroomManifest = {
    formatVersion: CLASSROOM_ZIP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion,
    stage: manifestStage,
    agents: manifestAgents,
    scenes: manifestScenes,
    mediaIndex,
  };

  const manifestPath = path.join(classroomDir, 'manifest.json');
  await writeJsonFileAtomic(manifestPath, manifest);
  log.info(`Wrote manifest for classroom ${classroomId}: ${Object.keys(mediaIndex).length} media entries`);
}

// ---------------------------------------------------------------------------
// Manifest reading
// ---------------------------------------------------------------------------

export async function readClassroomManifest(
  classroomId: string,
): Promise<ClassroomManifest | null> {
  const manifestPath = path.join(CLASSROOMS_DIR, classroomId, 'manifest.json');
  try {
    const content = await fs.readFile(manifestPath, 'utf-8');
    return JSON.parse(content) as ClassroomManifest;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}
