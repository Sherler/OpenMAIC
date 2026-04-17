'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useI18n } from '@/lib/hooks/use-i18n';

interface ClassroomItem {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  hasManifest: boolean;
}

export default function ViewerIndexPage() {
  const { t } = useI18n();
  const [classrooms, setClassrooms] = useState<ClassroomItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchClassrooms() {
      try {
        const res = await fetch('/api/classroom/list');
        if (!res.ok) throw new Error(`Server error: ${res.status}`);
        const json = await res.json();
        if (json.success && json.classrooms) {
          setClassrooms(json.classrooms);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load classrooms');
      } finally {
        setLoading(false);
      }
    }
    fetchClassrooms();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-4xl mx-auto px-6 py-12">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground">OpenMAIC Viewer</h1>
          <p className="text-muted-foreground mt-2">
            Browse and view generated classroom resources
          </p>
        </div>

        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Loading classrooms...</div>
        ) : error ? (
          <div className="text-center py-12">
            <p className="text-destructive mb-4">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
            >
              Retry
            </button>
          </div>
        ) : classrooms.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <p>No classrooms found.</p>
            <p className="text-sm mt-2">Generate a classroom from the main app to see it here.</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {classrooms.map((classroom) => (
              <Link
                key={classroom.id}
                href={`/viewer/${classroom.id}`}
                className="block p-6 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-primary/50 hover:shadow-md transition-all"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <h2 className="text-lg font-semibold text-foreground truncate">
                      {classroom.name}
                    </h2>
                    {classroom.description && (
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                        {classroom.description}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-2">
                      {new Date(classroom.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="ml-4 flex items-center gap-2">
                    {classroom.hasManifest && (
                      <span className="text-xs px-2 py-1 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                        Complete
                      </span>
                    )}
                    <span className="text-xs px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 font-mono">
                      {classroom.id}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
