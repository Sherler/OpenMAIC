'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AgentBar } from '@/components/agent/agent-bar';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { CourseTagDefinition, CourseTagId } from '@/lib/constants/course-tags';
import { useAgentRegistry } from '@/lib/orchestration/registry/store';
import { useSettingsStore } from '@/lib/store/settings';
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
  Eye,
  Sparkles,
  ArrowRight,
  LibraryBig,
  Blocks,
  Mic2,
} from 'lucide-react';

// ─── Types ─────────────────────────────────────────────────

interface JobListItem {
  jobId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  step: string;
  progress: number;
  message: string;
  createdAt: string;
  completedAt?: string;
  requirementPreview: string;
  courseTagIds?: CourseTagId[];
  courseTags?: CourseTagDefinition[];
  scenesGenerated: number;
  totalScenes?: number;
  stageId?: string;
  result?: {
    classroomId: string;
    url: string;
    scenesCount: number;
  };
  error?: string;
}

interface BatchVoiceConfig {
  providerId: string;
  modelId?: string;
  voiceId: string;
}

interface BatchPresetAgent {
  id: string;
  name: string;
  role: string;
  persona: string;
  avatar: string;
  color: string;
  priority: number;
  voiceConfig?: BatchVoiceConfig;
}

// ─── Main Page ─────────────────────────────────────────────

export default function BatchGeneratePage() {
  const router = useRouter();
  const formRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const selectedAgentIds = useSettingsStore((s) => s.selectedAgentIds);
  const settingsAgentMode = useSettingsStore((s) => s.agentMode);
  const setSettingsAgentMode = useSettingsStore((s) => s.setAgentMode);
  const ttsProviderId = useSettingsStore((s) => s.ttsProviderId);
  const ttsVoice = useSettingsStore((s) => s.ttsVoice);
  const ttsProvidersConfig = useSettingsStore((s) => s.ttsProvidersConfig);

  // Form state
  const [requirement, setRequirement] = useState('');
  const [availableTags, setAvailableTags] = useState<CourseTagDefinition[]>([]);
  const [courseTagIds, setCourseTagIds] = useState<CourseTagId[]>([]);
  const [enableWebSearch, setEnableWebSearch] = useState(true);
  const [enableImage, setEnableImage] = useState(true);
  const [enableTTS, setEnableTTS] = useState(true);

  // Submit state
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Job history
  const [history, setHistory] = useState<JobListItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  // ─── Load history on mount ─────────────────────────────

  useEffect(() => {
    (async () => {
      try {
        const [tagsRes, historyRes] = await Promise.all([
          fetch('/api/course-tags'),
          fetch('/api/generate-classroom'),
        ]);
        const [tagsData, historyData] = await Promise.all([tagsRes.json(), historyRes.json()]);
        if (tagsRes.ok && tagsData.success) {
          setAvailableTags(tagsData.courseTags);
        }
        if (historyRes.ok && historyData.success) {
          setHistory(historyData.jobs);
        }
      } catch {
        // silently ignore
      } finally {
        setHistoryLoading(false);
      }
    })();
  }, []);

  // ─── Submit ────────────────────────────────────────────

  const buildPresetAgents = useCallback((): BatchPresetAgent[] => {
    const registry = useAgentRegistry.getState();
    const teacherAgent = registry
      .listAgents()
      .find((agent) => !agent.isGenerated && agent.role === 'teacher');

    const selectedAgents = selectedAgentIds
      .map((id) => registry.getAgent(id))
      .filter((agent): agent is NonNullable<typeof agent> => Boolean(agent))
      .filter((agent) => !agent.isGenerated);

    const agents =
      teacherAgent && !selectedAgents.some((agent) => agent.id === teacherAgent.id)
        ? [teacherAgent, ...selectedAgents]
        : selectedAgents;

    return agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      role: agent.role,
      persona: agent.persona,
      avatar: agent.avatar,
      color: agent.color,
      priority: agent.priority,
      ...(agent.voiceConfig ? { voiceConfig: agent.voiceConfig } : {}),
    }));
  }, [selectedAgentIds]);

  const handleSubmit = useCallback(async () => {
    if (!requirement.trim() || submitting) return;
    if (courseTagIds.length === 0) {
      setSubmitError('请选择课程标签');
      return;
    }

    const presetAgents = settingsAgentMode === 'preset' ? buildPresetAgents() : [];
    if (settingsAgentMode === 'preset' && presetAgents.length === 0) {
      setSubmitError('请至少保留一个课堂角色');
      return;
    }

    const teacherVoiceConfig: BatchVoiceConfig | undefined =
      enableTTS && ttsProviderId && ttsVoice && ttsProviderId !== 'browser-native-tts'
        ? {
            providerId: ttsProviderId,
            modelId: ttsProvidersConfig[ttsProviderId]?.modelId,
            voiceId: ttsVoice,
          }
        : undefined;

    setSubmitting(true);
    setSubmitError(null);

    try {
      const res = await fetch('/api/generate-classroom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requirement: requirement.trim(),
          courseTagIds,
          enableWebSearch,
          enableImageGeneration: enableImage,
          enableTTS,
          agentMode: settingsAgentMode === 'auto' ? 'generate' : 'default',
          ...(presetAgents.length > 0 ? { presetAgents } : {}),
          ...(teacherVoiceConfig ? { teacherVoiceConfig } : {}),
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      // Redirect to the job detail page
      router.push(`/batch-generate/${data.jobId}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }, [
    requirement,
    courseTagIds,
    settingsAgentMode,
    buildPresetAgents,
    enableWebSearch,
    enableImage,
    enableTTS,
    ttsProviderId,
    ttsVoice,
    ttsProvidersConfig,
    submitting,
    router,
  ]);

  const toggleCourseTag = useCallback((tagId: CourseTagId) => {
    setCourseTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId],
    );
  }, []);

  const scrollToSection = useCallback((target: 'form' | 'history') => {
    const element = target === 'form' ? formRef.current : historyRef.current;
    element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f7f3ea_0%,#fcfbf7_24%,#ffffff_58%)]">
      {/* Header */}
      <header className="border-b border-stone-200/70 bg-white/88 backdrop-blur supports-[backdrop-filter]:bg-white/72 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto flex items-center gap-3 px-4 h-14">
          <Link
            href="/"
            className="p-1.5 rounded-lg hover:bg-stone-100 text-muted-foreground"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="flex items-center gap-3 min-w-0">
            <h1 className="text-base font-semibold tracking-[0.18em] font-serif">鸿儒</h1>
            <span className="hidden sm:inline-flex items-center rounded-full border border-stone-200 bg-stone-50 px-2.5 py-0.5 text-[11px] text-stone-600">
              课堂批量生成入口
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        <section className="relative overflow-hidden rounded-[32px] border border-stone-200/80 bg-[radial-gradient(circle_at_top_left,rgba(181,160,112,0.2),transparent_34%),linear-gradient(135deg,rgba(255,251,240,0.96),rgba(255,255,255,0.98))] px-6 py-8 shadow-[0_30px_80px_-48px_rgba(87,67,34,0.45)] sm:px-8 sm:py-10">
          <div className="absolute -right-14 top-8 h-40 w-40 rounded-full bg-amber-200/35 blur-3xl" />
          <div className="absolute left-10 bottom-0 h-24 w-24 rounded-full bg-stone-300/25 blur-2xl" />
          <div className="relative grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)] lg:items-end">
            <div className="space-y-5">
              <div className="inline-flex items-center gap-2 rounded-full border border-stone-300/70 bg-white/70 px-3 py-1 text-xs text-stone-700 shadow-sm">
                <Sparkles className="h-3.5 w-3.5 text-amber-600" />
                鸿儒 AI 课堂工作台
              </div>
              <div className="space-y-3">
                <h2 className="text-4xl font-serif tracking-[0.18em] text-stone-900 sm:text-5xl">
                  鸿儒
                </h2>
                <p className="max-w-2xl text-sm leading-7 text-stone-700 sm:text-base">
                  从一句课堂需求出发，快速生成带角色、图片、语音与场景结构的完整教学内容。
                  当前页面已经是欢迎入口，你可以直接开始批量生成，也可以先查看历史课堂继续迭代。
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button
                  onClick={() => scrollToSection('form')}
                  className="h-11 rounded-full bg-stone-900 px-5 text-white hover:bg-stone-800"
                >
                  进入鸿儒
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => scrollToSection('history')}
                  className="h-11 rounded-full border-stone-300 bg-white/75 px-5 text-stone-700 hover:bg-stone-50"
                >
                  查看生成历史
                </Button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
              <HeroFeatureCard
                icon={<LibraryBig className="h-4 w-4" />}
                title="结构化课堂"
                description="一条需求自动拆分成教学场景与课堂节奏。"
              />
              <HeroFeatureCard
                icon={<Blocks className="h-4 w-4" />}
                title="角色协同"
                description="预设角色与 AI 自动生成两种模式自由切换。"
              />
              <HeroFeatureCard
                icon={<Mic2 className="h-4 w-4" />}
                title="教师音色"
                description="直接选择教师声音，并带入服务端批量生成流程。"
              />
            </div>
          </div>
        </section>

        {/* ─── Form ─────────────────────────────────────── */}
        <div ref={formRef}>
        <Card className="border-stone-200/80 bg-white/88 shadow-[0_22px_65px_-50px_rgba(56,42,16,0.45)] backdrop-blur">
          <CardHeader>
            <CardTitle className="text-lg text-stone-900">课堂需求</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <p className="text-sm font-medium">课程标签</p>
              <div className="flex flex-wrap gap-2">
                {availableTags.map((tag) => (
                  <ToggleChip
                    key={tag.id}
                    active={courseTagIds.includes(tag.id)}
                    onClick={() => toggleCourseTag(tag.id)}
                    label={tag.tag_name}
                  />
                ))}
              </div>
            </div>

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
                active={settingsAgentMode === 'auto'}
                onClick={() => setSettingsAgentMode(settingsAgentMode === 'auto' ? 'preset' : 'auto')}
                icon={<Bot className="w-3.5 h-3.5" />}
                label="AI 生成角色"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">课堂角色配置</p>
                <p className="text-xs text-muted-foreground">支持切换角色并为教师选择声音</p>
              </div>
              <div className="max-w-md">
                <AgentBar />
              </div>
            </div>

            <Button
              onClick={handleSubmit}
              disabled={!requirement.trim() || courseTagIds.length === 0 || submitting}
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

            {submitError && (
              <p className="text-sm text-destructive">{submitError}</p>
            )}
          </CardContent>
        </Card>
        </div>

        {/* ─── Job History ──────────────────────────────── */}
        <div ref={historyRef}>
        <Card className="border-stone-200/80 bg-white/88 shadow-[0_22px_65px_-50px_rgba(56,42,16,0.45)] backdrop-blur">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-stone-900">生成历史</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {historyLoading && (
              <div className="flex justify-center py-4">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            )}

            {!historyLoading && history.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">暂无生成记录</p>
            )}

            {history.map((h) => {
              const classroomId = h.result?.classroomId || h.stageId;
              const hasContent = !!classroomId && h.scenesGenerated > 0;
              return (
                <div
                  key={h.jobId}
                  className="flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm"
                >
                  <div className="flex-shrink-0">
                    {h.status === 'succeeded' ? (
                      <CheckCircle2 className="w-4 h-4 text-green-500" />
                    ) : h.status === 'failed' ? (
                      <XCircle className="w-4 h-4 text-destructive" />
                    ) : h.status === 'running' ? (
                      <Loader2 className="w-4 h-4 text-primary animate-spin" />
                    ) : (
                      <Circle className="w-4 h-4 text-muted-foreground/40" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="truncate font-medium">{h.requirementPreview}</p>
                    {h.courseTags && h.courseTags.length > 0 && (
                      <p className="mt-1">
                        {h.courseTags.map((tag) => (
                          <span
                            key={tag.id}
                            className="mr-1 inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
                          >
                            {tag.tag_name}
                          </span>
                        ))}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {new Date(h.createdAt).toLocaleString()}
                      {h.totalScenes != null && (
                        <> · {h.scenesGenerated}/{h.totalScenes} 场景</>
                      )}
                      {h.status === 'failed' && (
                        <span className="text-destructive"> · 失败</span>
                      )}
                    </p>
                  </div>
                  <div className="flex-shrink-0 flex gap-1.5">
                    {hasContent && (
                      <Button asChild variant="outline" size="sm" className="h-7 text-xs">
                        <Link href={`/classroom/${classroomId}`}>
                          <ExternalLink className="w-3 h-3 mr-1" />
                          查看已生成场景
                        </Link>
                      </Button>
                    )}
                    <Button asChild variant="ghost" size="sm" className="h-7 text-xs">
                      <Link href={`/batch-generate/${h.jobId}`}>
                        <Eye className="w-3 h-3 mr-1" />
                        详情
                      </Link>
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
        </div>
      </main>
    </div>
  );
}

function HeroFeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-stone-200/80 bg-white/75 p-4 shadow-sm backdrop-blur-sm">
      <div className="mb-3 inline-flex h-8 w-8 items-center justify-center rounded-full bg-amber-100 text-amber-700">
        {icon}
      </div>
      <h3 className="text-sm font-semibold text-stone-900">{title}</h3>
      <p className="mt-1 text-xs leading-6 text-stone-600">{description}</p>
    </div>
  );
}

// ─── Toggle chip ───────────────────────────────────────────

function ToggleChip({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon?: React.ReactNode;
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
