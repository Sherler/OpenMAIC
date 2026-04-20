'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { CourseTagDefinition, CourseTagId } from '@/lib/constants/course-tags';
import {
  ArrowLeft,
  Loader2,
  CheckCircle2,
  XCircle,
  Circle,
  ExternalLink,
  RefreshCw,
  StopCircle,
  Play,
} from 'lucide-react';

// ─── Types ─────────────────────────────────────────────────

interface JobStatus {
  jobId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  step: string;
  progress: number;
  message: string;
  courseTagIds?: CourseTagId[];
  courseTags?: CourseTagDefinition[];
  pollUrl: string;
  pollIntervalMs: number;
  scenesGenerated: number;
  totalScenes?: number;
  currentSceneIndex?: number;
  outlineTitles?: string[];
  stageId?: string;
  result?: {
    classroomId: string;
    url: string;
    scenesCount: number;
  };
  error?: string;
  done: boolean;
}

const STEP_LABELS: Record<string, string> = {
  queued: '排队中',
  initializing: '初始化模型',
  researching: '联网搜索',
  generating_outlines: '生成提纲',
  generating_scenes: '生成场景',
  generating_media: '生成媒体资源',
  generating_tts: '生成语音',
  persisting: '保存数据',
  completed: '完成',
  failed: '失败',
};

// ─── Outline List ──────────────────────────────────────────

function OutlineList({
  titles,
  generated,
  currentIndex,
  total,
}: {
  titles: string[];
  generated: number;
  currentIndex?: number;
  total: number;
}) {
  // Use currentSceneIndex (0-based) if available; fall back to generated count
  const activeIndex = currentIndex ?? generated;

  return (
    <div className="space-y-1.5">
      {titles.map((title, i) => {
        const isDone = i < activeIndex;
        const isCurrent = i === activeIndex && generated < total;
        return (
          <div
            key={i}
            className={cn(
              'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
              isDone && 'bg-green-50 dark:bg-green-950/30',
              isCurrent && 'bg-primary/5 ring-1 ring-primary/20',
              !isDone && !isCurrent && 'text-muted-foreground',
            )}
          >
            <div className="flex-shrink-0">
              {isDone ? (
                <CheckCircle2 className="w-4 h-4 text-green-500" />
              ) : isCurrent ? (
                <Loader2 className="w-4 h-4 text-primary animate-spin" />
              ) : (
                <Circle className="w-4 h-4 text-muted-foreground/40" />
              )}
            </div>
            <span className="flex-1 min-w-0 truncate">
              <span className="text-muted-foreground mr-1.5">{i + 1}.</span>
              {title}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Step Timeline ─────────────────────────────────────────

function StepTimeline({ currentStep }: { currentStep: string }) {
  const steps = [
    'initializing',
    'researching',
    'generating_outlines',
    'generating_scenes',
    'generating_media',
    'generating_tts',
    'persisting',
  ];

  const currentIdx =
    currentStep === 'completed'
      ? steps.length
      : currentStep === 'failed'
        ? -1
        : steps.indexOf(currentStep);

  return (
    <div className="flex items-center gap-1 text-xs">
      {steps.map((step, i) => {
        const isDone = currentIdx > i;
        const isCurrent = currentIdx === i;
        return (
          <div key={step} className="flex items-center gap-1">
            {i > 0 && (
              <div
                className={cn(
                  'w-4 h-px',
                  isDone ? 'bg-green-400' : 'bg-muted-foreground/20',
                )}
              />
            )}
            <div
              className={cn(
                'px-2 py-0.5 rounded-full whitespace-nowrap transition-colors',
                isDone && 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
                isCurrent && 'bg-primary/10 text-primary font-medium',
                !isDone && !isCurrent && 'text-muted-foreground/50',
              )}
            >
              {STEP_LABELS[step] || step}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────

export default function JobDetailPage() {
  const params = useParams<{ jobId: string }>();
  const router = useRouter();
  const jobId = params.jobId;

  const [job, setJob] = useState<JobStatus | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [supplement, setSupplement] = useState('');
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Poll job status ──────────────────────────────────

  const fetchJob = useCallback(async () => {
    try {
      const res = await fetch(`/api/generate-classroom/${jobId}`);
      const data = await res.json();
      if (!res.ok || !data.success) {
        setPollError(data.error || `HTTP ${res.status}`);
        return;
      }

      setJob({
        jobId: data.jobId,
        status: data.status,
        step: data.step,
        progress: data.progress ?? 0,
        message: data.message ?? '',
        courseTagIds: data.courseTagIds,
        courseTags: data.courseTags,
        pollUrl: data.pollUrl,
        pollIntervalMs: data.pollIntervalMs || 5000,
        scenesGenerated: data.scenesGenerated ?? 0,
        totalScenes: data.totalScenes,
        currentSceneIndex: data.currentSceneIndex,
        outlineTitles: data.outlineTitles,
        stageId: data.stageId,
        result: data.result,
        error: data.error,
        done: data.done ?? false,
      });
    } catch (err) {
      setPollError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    fetchJob();
  }, [fetchJob]);

  useEffect(() => {
    if (!job || job.done) return;

    pollTimerRef.current = setInterval(fetchJob, job.pollIntervalMs || 5000);
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [job?.jobId, job?.done, job?.pollIntervalMs, fetchJob]);

  // ─── Cancel ────────────────────────────────────────────

  const handleCancel = useCallback(async () => {
    if (cancelling) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/generate-classroom/${jobId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setPollError(data.error || '取消失败');
      }
      // Poll will pick up the new status
      await fetchJob();
    } catch (err) {
      setPollError(err instanceof Error ? err.message : String(err));
    } finally {
      setCancelling(false);
    }
  }, [jobId, cancelling, fetchJob]);

  // ─── Retry / Continue ─────────────────────────────────

  const handleRetryOrContinue = useCallback(
    async (mode: 'retry' | 'continue') => {
      if (retrying) return;
      setRetrying(true);
      setPollError(null);

      try {
        const res = await fetch(`/api/generate-classroom/${jobId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode,
            supplement: supplement.trim() || undefined,
          }),
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || `HTTP ${res.status}`);
        }

        // Navigate to the new job's detail page
        router.push(`/batch-generate/${data.jobId}`);
      } catch (err) {
        setPollError(err instanceof Error ? err.message : String(err));
      } finally {
        setRetrying(false);
      }
    },
    [jobId, supplement, retrying, router],
  );

  // ─── Derived ───────────────────────────────────────────

  const isRunning = job && !job.done;
  const succeeded = job?.status === 'succeeded';
  const failed = job?.status === 'failed';

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto flex items-center gap-3 px-4 h-14">
          <Link
            href="/batch-generate"
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <h1 className="text-base font-semibold">生成任务详情</h1>
          <span className="text-xs text-muted-foreground font-mono">{jobId}</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {/* Loading */}
        {loading && (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Job not found */}
        {!loading && !job && (
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground text-center">任务不存在或已被删除</p>
            </CardContent>
          </Card>
        )}

        {job && (
          <>
            {/* ─── Progress card ────────────────────────── */}
            <Card>
              <CardContent className="pt-6 space-y-4">
                {/* Status header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {succeeded ? (
                      <CheckCircle2 className="w-5 h-5 text-green-500" />
                    ) : failed ? (
                      <XCircle className="w-5 h-5 text-destructive" />
                    ) : (
                      <Loader2 className="w-5 h-5 text-primary animate-spin" />
                    )}
                    <span className="font-semibold">
                      {succeeded
                        ? '生成完成'
                        : failed
                          ? '生成失败'
                          : STEP_LABELS[job.step] || job.step}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {job.totalScenes != null && (
                      <span className="text-sm text-muted-foreground">
                        {job.scenesGenerated} / {job.totalScenes} 场景
                      </span>
                    )}
                    {/* Cancel button — shown while running */}
                    {isRunning && (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={handleCancel}
                        disabled={cancelling}
                      >
                        {cancelling ? (
                          <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                        ) : (
                          <StopCircle className="w-3.5 h-3.5 mr-1" />
                        )}
                        中断生成
                      </Button>
                    )}
                  </div>
                </div>

                {/* Progress bar */}
                <Progress value={job.progress} className="h-2" />
                <p className="text-sm text-muted-foreground">{job.message}</p>

                {job.courseTags && job.courseTags.length > 0 && (
                  <div>
                    {job.courseTags.map((tag) => (
                      <span
                        key={tag.id}
                        className="mr-2 inline-flex items-center rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
                      >
                        {tag.tag_name}
                      </span>
                    ))}
                  </div>
                )}

                {/* Step timeline */}
                <div className="overflow-x-auto pt-2">
                  <StepTimeline currentStep={job.step} />
                </div>
              </CardContent>
            </Card>

            {/* ─── Outline structure card ───────────────── */}
            {job.outlineTitles && job.outlineTitles.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center justify-between">
                    <span>场景提纲</span>
                    <span className="text-sm font-normal text-muted-foreground">
                      共 {job.outlineTitles.length} 个场景
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <OutlineList
                    titles={job.outlineTitles}
                    generated={job.scenesGenerated}
                    currentIndex={job.currentSceneIndex}
                    total={job.totalScenes ?? job.outlineTitles.length}
                  />
                </CardContent>
              </Card>
            )}

            {/* ─── Error detail ─────────────────────────── */}
            {failed && job.error && (
              <Card className="border-destructive/50">
                <CardContent className="pt-6 space-y-3">
                  <p className="text-sm text-destructive">{job.error}</p>
                  {job.stageId && job.scenesGenerated > 0 && (
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/classroom/${job.stageId}`}>
                        <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                        查看已生成的 {job.scenesGenerated} 个场景
                      </Link>
                    </Button>
                  )}
                </CardContent>
              </Card>
            )}

            {pollError && (
              <p className="text-sm text-destructive text-center">{pollError}</p>
            )}

            {/* ─── Success actions ──────────────────────── */}
            {succeeded && job.result && (
              <Card className="border-green-200 dark:border-green-900">
                <CardContent className="pt-6 space-y-3">
                  <p className="text-sm">
                    课堂已生成并保存至本地（
                    <code className="text-xs bg-muted px-1 py-0.5 rounded">
                      data/classrooms/{job.result.classroomId}.json
                    </code>
                    ）
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button asChild variant="default" size="sm">
                      <Link href={`/classroom/${job.result.classroomId}`}>
                        <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                        查看已生成场景
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* ─── Retry / Continue area ────────────────── */}
            {failed && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">重试 / 继续生成</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Textarea
                    value={supplement}
                    onChange={(e) => setSupplement(e.target.value)}
                    placeholder="补充说明（可选）：调整要求、修正内容、追加指令……"
                    className="min-h-[80px] resize-y"
                  />
                  <div className="flex gap-2">
                    <Button
                      onClick={() => handleRetryOrContinue('continue')}
                      disabled={retrying}
                      className="flex-1"
                    >
                      {retrying ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Play className="w-4 h-4 mr-2" />
                      )}
                      继续生成
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => handleRetryOrContinue('retry')}
                      disabled={retrying}
                      className="flex-1"
                    >
                      <RefreshCw className="w-4 h-4 mr-2" />
                      从头重试
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    「继续生成」会从上次中断的场景继续，已完成的场景不会重新生成。
                    「从头重试」会创建全新任务重新生成所有场景。
                  </p>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </main>
    </div>
  );
}
