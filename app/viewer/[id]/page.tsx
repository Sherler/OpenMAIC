'use client';

import { Stage } from '@/components/stage';
import { ThemeProvider } from '@/lib/hooks/use-theme';
import { useStageStore } from '@/lib/store';
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { MediaStageProvider } from '@/lib/contexts/media-stage-context';
import { createLogger } from '@/lib/logger';

const log = createLogger('Viewer');

/**
 * Standalone read-only viewer page for server-generated classrooms.
 *
 * Unlike the full classroom page, this viewer:
 * - Loads data exclusively from the server API (no IndexedDB dependency)
 * - Does not trigger any generation or media generation
 * - Operates in pure playback mode
 * - Designed as the "consumer" counterpart to the "producer" main app
 */
export default function ViewerPage() {
  const params = useParams();
  const classroomId = params?.id as string;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadClassroom = useCallback(async () => {
    try {
      const res = await fetch(`/api/classroom?id=${encodeURIComponent(classroomId)}`);
      if (!res.ok) {
        throw new Error(res.status === 404 ? 'Classroom not found' : `Server error: ${res.status}`);
      }

      const json = await res.json();
      if (!json.success || !json.classroom) {
        throw new Error('Invalid classroom data');
      }

      const { stage, scenes } = json.classroom;

      // Set store state directly from server data
      useStageStore.getState().setStage(stage);
      useStageStore.setState({
        scenes,
        currentSceneId: scenes[0]?.id ?? null,
        mode: 'playback',
      });

      log.info('Loaded classroom from server:', classroomId);

      // Hydrate server-generated agents into registry if present
      if (stage.generatedAgentConfigs?.length) {
        const { saveGeneratedAgents } = await import('@/lib/orchestration/registry/store');
        await saveGeneratedAgents(stage.id, stage.generatedAgentConfigs);

        const { useSettingsStore } = await import('@/lib/store/settings');
        useSettingsStore.getState().setAgentMode('auto');
        useSettingsStore
          .getState()
          .setSelectedAgentIds(stage.generatedAgentConfigs.map((a: { id: string }) => a.id));
        log.info('Hydrated server-generated agents');
      } else if (stage.agentIds?.length) {
        const { useSettingsStore } = await import('@/lib/store/settings');
        useSettingsStore.getState().setAgentMode('preset');
        useSettingsStore.getState().setSelectedAgentIds(stage.agentIds);
      } else {
        const { useSettingsStore } = await import('@/lib/store/settings');
        useSettingsStore.getState().setAgentMode('preset');
        useSettingsStore
          .getState()
          .setSelectedAgentIds(['default-1', 'default-2', 'default-3']);
      }
    } catch (err) {
      log.error('Failed to load classroom:', err);
      setError(err instanceof Error ? err.message : 'Failed to load classroom');
    } finally {
      setLoading(false);
    }
  }, [classroomId]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    loadClassroom();
  }, [classroomId, loadClassroom]);

  return (
    <ThemeProvider>
      <MediaStageProvider value={classroomId}>
        <div className="h-screen flex flex-col overflow-hidden">
          {loading ? (
            <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-900">
              <div className="text-center text-muted-foreground">
                <p>Loading classroom...</p>
              </div>
            </div>
          ) : error ? (
            <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-900">
              <div className="text-center">
                <p className="text-destructive mb-4">Error: {error}</p>
                <button
                  onClick={() => {
                    setError(null);
                    setLoading(true);
                    loadClassroom();
                  }}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
                >
                  Retry
                </button>
              </div>
            </div>
          ) : (
            <Stage />
          )}
        </div>
      </MediaStageProvider>
    </ThemeProvider>
  );
}
