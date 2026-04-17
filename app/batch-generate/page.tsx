'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  ArrowLeft,
  Loader2,
  CheckCircle2,
  XCircle,
  Circle,
  PlayCircle,
  ExternalLink,
  Search,
  ImagePlus,
  Volume2,
  Bot,
} from 'lucide-react';

// ─── Types ─────────────────────────────────────────────────

interface JobStatus {
  jobId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  step: string;
  progress: number;
  message: string;
  pollUrl: string;
  pollIntervalMs: number;
  scenesGenerated: number;
  totalScenes?: number;
  outlineTitles?: string[];
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
  total,
}: {
  titles: string[];
  generated: number;
  total: number;
}) {
  return (
    <div className="space-y-1.5">
      {titles.map((title, i) => {
        const isDone = i < generated;
        const isCurrent = i === generated && generated < total;
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

  // Find current step index. Completed/failed are special.
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

export default function BatchGeneratePage() {
  // Form state
  const [requirement, setRequirement] = useState('');
  const [enableWebSearch, setEnableWebSearch] = useState(false);
  const [enableImage, setEnableImage] = useState(false);
  const [enableTTS, setEnableTTS] = useState(true);
  const [agentMode, setAgentMode] = useState<'default' | 'generate'>('default');

  // Job state
  const [submitting, setSubmitting] = useState(false);
  const [job, setJob] = useState<JobStatus | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Submit ────────────────────────────────────────────

  const handleSubmit = useCallback(async () => {
    if (!requirement.trim() || submitting) return;

    setSubmitting(true);
    setPollError(null);
    setJob(null);

    try {
      const res = await fetch('/api/generate-classroom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requirement: requirement.trim(),
          enableWebSearch,
          enableImageGeneration: enableImage,
          enableTTS,
          agentMode,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      setJob({
        jobId: data.jobId,
        status: data.status,
        step: data.step || 'queued',
        progress: 0,
        message: data.message || '',
        pollUrl: data.pollUrl,
        pollIntervalMs: data.pollIntervalMs || 3000,
        scenesGenerated: 0,
        done: false,
      });
    } catch (err) {
      setPollError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }, [requirement, enableWebSearch, enableImage, enableTTS, agentMode, submitting]);

  // ─── Polling ───────────────────────────────────────────

  useEffect(() => {
    if (!job || job.done) return;

    const poll = async () => {
      try {
        const res = await fetch(`/api/generate-classroom/${job.jobId}`);
        const data = await res.json();
        if (!res.ok || !data.success) {
          setPollError(data.error || `HTTP ${res.status}`);
          return;
        }

        setJob((prev) => ({
          ...prev!,
          status: data.status,
          step: data.step,
          progress: data.progress ?? prev!.progress,
          message: data.message ?? prev!.message,
          scenesGenerated: data.scenesGenerated ?? prev!.scenesGenerated,
          totalScenes: data.totalScenes ?? prev!.totalScenes,
          outlineTitles: data.outlineTitles ?? prev!.outlineTitles,
          result: data.result ?? prev!.result,
          error: data.error,
          done: data.done ?? false,
        }));
      } catch (err) {
        setPollError(err instanceof Error ? err.message : String(err));
      }
    };

    pollTimerRef.current = setInterval(poll, job.pollIntervalMs || 3000);
    // Poll immediately on first mount
    poll();

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [job?.jobId, job?.done]);

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
            href="/"
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <h1 className="text-base font-semibold">服务端批量生成</h1>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {/* ─── Form ─────────────────────────────────────── */}
        {!job && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">课堂需求</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <Textarea
                value={requirement}
                onChange={(e) => setRequirement(e.target.value)}
                placeholder="输入课堂需求描述，如：讲解 Python 基础语法，面向初学者，包含变量、循环、函数等知识点..."
                className="min-h-[120px] resize-y"
              />

              {/* Options */}
              <div className="flex flex-wrap gap-3">
                <ToggleChip
                  active={enableWebSearch}
                  onClick={() => setEnableWebSearch(!enableWebSearch)}
                  icon={<Search className="w-3.5 h-3.5" />}
                  label="联网搜索"
                />
                <ToggleChip
                  active={enableImage}
                  onClick={() => setEnableImage(!enableImage)}
                  icon={<ImagePlus className="w-3.5 h-3.5" />}
                  label="AI 配图"
                />
                <ToggleChip
                  active={enableTTS}
                  onClick={() => setEnableTTS(!enableTTS)}
                  icon={<Volume2 className="w-3.5 h-3.5" />}
                  label="语音合成"
                />
                <ToggleChip
                  active={agentMode === 'generate'}
                  onClick={() =>
                    setAgentMode(agentMode === 'generate' ? 'default' : 'generate')
                  }
                  icon={<Bot className="w-3.5 h-3.5" />}
                  label="AI 生成角色"
                />
              </div>

              <Button
                onClick={handleSubmit}
                disabled={!requirement.trim() || submitting}
                className="w-full"
                size="lg"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    提交中...
                  </>
                ) : (
                  <>
                    <PlayCircle className="w-4 h-4 mr-2" />
                    开始生成
                  </>
                )}
              </Button>

              {pollError && !job && (
                <p className="text-sm text-destructive">{pollError}</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* ─── Progress ─────────────────────────────────── */}
        {job && (
          <>
            {/* Overall progress card */}
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
                  {job.totalScenes != null && (
                    <span className="text-sm text-muted-foreground">
                      {job.scenesGenerated} / {job.totalScenes} 场景
                    </span>
                  )}
                </div>

                {/* Progress bar */}
                <Progress value={job.progress} className="h-2" />

                <p className="text-sm text-muted-foreground">{job.message}</p>

                {/* Step timeline */}
                <div className="overflow-x-auto pt-2">
                  <StepTimeline currentStep={job.step} />
                </div>
              </CardContent>
            </Card>

            {/* Outline structure card */}
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
                    total={job.totalScenes ?? job.outlineTitles.length}
                  />
                </CardContent>
              </Card>
            )}

            {/* Error */}
            {failed && job.error && (
              <Card className="border-destructive/50">
                <CardContent className="pt-6">
                  <p className="text-sm text-destructive">{job.error}</p>
                </CardContent>
              </Card>
            )}

            {pollError && (
              <p className="text-sm text-destructive text-center">{pollError}</p>
            )}

            {/* Success actions */}
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
                        在本项目中打开
                      </Link>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setJob(null);
                        setPollError(null);
                      }}
                    >
                      继续生成
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Back to form for failed */}
            {failed && (
              <Button
                variant="outline"
                onClick={() => {
                  setJob(null);
                  setPollError(null);
                }}
                className="w-full"
              >
                返回重试
              </Button>
            )}
          </>
        )}
      </main>
    </div>
  );
}

// ─── Toggle chip ───────────────────────────────────────────

function ToggleChip({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
        active
          ? 'bg-primary/10 text-primary border-primary/30'
          : 'bg-muted/50 text-muted-foreground border-transparent hover:border-muted-foreground/20',
      )}
    >
      {icon}
      {label}
    </button>
  );
}
