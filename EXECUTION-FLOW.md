# OpenMAIC 执行流程文档

> 从用户输入 Prompt 到最终交互课堂的完整执行链路

---

## 目录

- [全景总览](#全景总览)
- [阶段 1：用户输入 → 收集数据](#阶段-1用户输入--收集数据)
- [阶段 2：PDF 解析 + Web 搜索](#阶段-2pdf-解析--web-搜索)
- [阶段 3：场景大纲生成（SSE 流式）](#阶段-3场景大纲生成sse-流式)
- [阶段 4：Agent 角色生成](#阶段-4agent-角色生成)
- [阶段 5：第 1 个场景完整生成](#阶段-5第-1-个场景完整生成)
- [阶段 6：课堂内 — 剩余场景 + 媒体并行生成](#阶段-6课堂内--剩余场景--媒体并行生成)
- [阶段 7：播放引擎 — 交互式授课](#阶段-7播放引擎--交互式授课)
- [数据存储一览](#数据存储一览)
- [容错机制](#容错机制)
- [关键代码位置索引](#关键代码位置索引)

---

## 全景总览

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  首页 (/)                  生成预览页                        课堂页
  用户输入                  (/generation-preview)             (/classroom/[id])
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ┌──────────┐  sessionStorage  ┌──────────────────────┐  router.push  ┌──────────────────────────┐
  │ 用户输入  │ ──────────────▶ │  Step 0: PDF 解析     │ ───────────▶ │ 加载第1个场景 (立即可用)   │
  │ PDF+需求  │                 │  Step 1: Web 搜索     │              │                          │
  │ 点击生成  │                 │  Step 2: 大纲生成 SSE  │              │ 串行生成剩余场景           │
  └──────────┘                 │  Step 3: Agent 生成    │              │  ├─ 内容生成               │
                               │  Step 4: 第1场景生成    │              │  ├─ 动作生成               │
                               │    ├─ 内容             │              │  └─ TTS 语音               │
                               │    ├─ 动作             │              │                          │
                               │    └─ TTS              │              │ 并行: 媒体生成 (图片/视频) │
                               └──────────────────────┘              │                          │
                                                                     │ 播放引擎: 自动授课         │
                                                                     │  ├─ 语音朗读               │
                                                                     │  ├─ 聚光灯/激光笔          │
                                                                     │  ├─ 白板绘图               │
                                                                     │  └─ 讨论互动               │
                                                                     └──────────────────────────┘
```

**核心设计原则：**

- **渐进式呈现** — 第 1 个场景生成完毕即可进入课堂，其余场景后台生成
- **两阶段场景生成** — 内容生成 (幻灯片/测验) → 动作生成 (语音/动画)
- **媒体并行** — 图片/视频生成与场景生成并行，不阻塞主流程
- **优雅降级** — 每个阶段失败都有 fallback，不会导致整体中断

---

## 阶段 1：用户输入 → 收集数据

**页面：** `/` (首页)
**入口函数：** `app/page.tsx` → `handleGenerate()`

### 用户操作

```
┌────────────────────────────────┐
│         OpenMAIC 首页           │
│                                │
│  📄 上传 PDF (可选)             │
│  ✏️  输入文字需求 (必填)         │
│  🔍 开启 Web 搜索 (可选)        │
│  ⚙️  选择 LLM 模型              │
│                                │
│        [ 生成课堂 ]             │
└────────────────────────────────┘
```

### 执行流程

```
handleGenerate()
│
├─ 1. 前置校验
│     ├─ currentModelId 非空? → 否则提示"请选择一个模型"
│     └─ form.requirement 非空? → 否则提示"请输入需求"
│
├─ 2. 收集用户上下文
│     ├─ UserRequirements {
│     │     requirement: string,       // 用户需求文本
│     │     userNickname?: string,     // 昵称
│     │     userBio?: string,          // 个人简介
│     │     webSearch: boolean         // 是否联网搜索
│     │   }
│     ├─ PDF → storePdfBlob() → 存入 IndexedDB → pdfStorageKey
│     └─ Settings: model, PDF/Image/Video/TTS provider 配置
│
├─ 3. 组装 GenerationSessionState
│     {
│       sessionId: nanoid(),
│       requirements: UserRequirements,
│       pdfText: '',               // 稍后由 PDF 解析填充
│       pdfImages: [],
│       imageStorageIds: [],
│       pdfStorageKey?: string,    // IndexedDB 中的 PDF Blob 引用
│       pdfFileName?: string,
│       sceneOutlines: null,
│       currentStep: 'generating',
│       researchContext?: string,
│       languageDirective?: string
│     }
│
├─ 4. 序列化到 sessionStorage
│     sessionStorage.setItem('generationSession', JSON.stringify(state))
│
└─ 5. 路由跳转
      router.push('/generation-preview')
```

---

## 阶段 2：PDF 解析 + Web 搜索

**页面：** `/generation-preview`
**入口函数：** `app/generation-preview/page.tsx` → `startGeneration()`

### Step 0：PDF 解析（可选）

```
条件: pdfStorageKey 存在 (用户上传了 PDF)

执行:
│
├─ 从 IndexedDB 加载 PDF Blob
│
├─ POST /api/parse-pdf  (multipart/form-data)
│   ├─ Provider 选择:
│   │   ├─ unpdf      — 轻量级, 无需 API Key
│   │   ├─ mineru     — 高精度, 本地部署
│   │   └─ mineru-cloud — 高精度, 云端 API
│   │
│   ├─ 服务端处理:
│   │   ├─ 校验 Content-Type
│   │   ├─ 解析 FormData → PDF Buffer
│   │   ├─ SSRF 校验 (如提供自定义 baseUrl)
│   │   └─ parsePDF(config, buffer)
│   │
│   └─ 返回: {
│         text: string (≤16,000 字符),
│         images: PdfImage[] {id, src: base64, pageNumber, description},
│         metadata: { pageCount, fileName, fileSize }
│       }
│
├─ images → 批量存入 IndexedDB
│
└─ 更新 sessionState:
    ├─ pdfText = 解析后的文本
    ├─ pdfImages = 图片数组
    └─ imageStorageIds = 图片 IndexedDB 键列表
```

### Step 1：Web 搜索（可选）

```
条件: requirements.webSearch === true

执行:
│
├─ POST /api/web-search
│   ├─ 输入: { query: requirement, pdfText?: 截断的PDF文本 }
│   │
│   ├─ 服务端处理:
│   │   ├─ 解析 LLM 模型 (用于 query 改写)
│   │   ├─ buildSearchQuery(query, pdfText, aiCall?)
│   │   │   └─ LLM 改写: 将用户需求+PDF摘要 → 优化的搜索 query
│   │   ├─ searchWithTavily({ query, apiKey })
│   │   └─ formatSearchResultsAsContext(result)
│   │
│   └─ 返回: { context: string (格式化搜索摘要), sources[] }
│
└─ 更新 sessionState.researchContext = context
```

---

## 阶段 3：场景大纲生成（SSE 流式）

### Step 2：大纲生成

```
POST /api/generate/scene-outlines-stream  (Server-Sent Events)

请求:
  {
    requirements: UserRequirements,
    pdfText?: string,
    pdfImages?: PdfImage[],
    imageMapping?: Record<string, string>,  // 图片ID → base64 URL
    researchContext?: string,               // Web 搜索结果
    agents?: AgentInfo[]                    // 教师上下文 (如已有)
  }

服务端处理:
│
├─ 解析模型配置 (从请求头)
├─ 检测视觉能力: modelInfo.capabilities.vision
│
├─ 构建 Prompt: REQUIREMENTS_TO_OUTLINES
│   输入变量:
│   ├─ requirement       — 用户需求
│   ├─ pdfContent        — PDF 原文
│   ├─ availableImages   — 可引用的 PDF 图片列表
│   ├─ mediaGenPolicy    — 图片/视频生成策略
│   ├─ researchContext   — 搜索补充材料
│   └─ teacherContext    — 教师角色信息
│
├─ LLM 流式调用 → 增量 JSON 解析
│
├─ 发射 SSE 事件:
│   ├─ { type: 'languageDirective', data: '用中文授课' }
│   ├─ { type: 'outline', data: SceneOutline, index: 0 }
│   ├─ { type: 'outline', data: SceneOutline, index: 1 }
│   ├─ ...
│   └─ { type: 'done', outlines: [...], languageDirective }
│
├─ 超时保护: 每 15s 发送心跳
├─ 自动重试: 结果为空时最多重试 2 次
└─ uniquifyMediaElementIds(): gen_img_1 → 全局唯一 nanoid


客户端:
├─ EventSource 读取流 → 实时渲染大纲卡片
└─ 全部完成后更新 sessionState.sceneOutlines
```

### SceneOutline 数据结构

```typescript
interface SceneOutline {
  id: string;
  title: string;
  order: number;
  type: 'slide' | 'quiz' | 'interactive' | 'pbl';
  description: string;
  keyPoints: string[];
  mediaGenerations?: MediaGeneration[];     // 需要生成的图片/视频
  // 按 type 可选:
  quizConfig?: { questionCount, difficulty, questionTypes };
  interactiveConfig?: { conceptName, conceptOverview, designIdea };
  pblConfig?: { projectTopic, projectDescription, targetSkills };
}

interface MediaGeneration {
  type: 'image' | 'video';
  elementId: string;     // 幻灯片中的占位 ID
  prompt: string;        // 生成提示词
  aspectRatio?: string;
  style?: string;
}
```

---

## 阶段 4：Agent 角色生成

### Step 3：Agent 生成（auto 模式）

```
POST /api/generate/agent-profiles

请求:
  {
    stageInfo: { name, description? },
    sceneOutlines?: { title, description? }[],  // 精简的大纲摘要
    languageDirective: string,
    availableAvatars: string[],                  // 可选头像路径
    avatarDescriptions?: { path, desc }[],
    availableVoices?: { providerId, voiceId, voiceName }[]
  }

服务端处理:
│
├─ 校验: stageInfo.name, languageDirective, avatars 非空
├─ 解析模型
│
├─ 构建 Prompt:
│   ├─ 场景摘要
│   ├─ 语言指令
│   ├─ 头像描述 / 路径列表
│   ├─ 语音选项
│   └─ 颜色色板
│
├─ LLM 生成 JSON:
│   {
│     "agents": [
│       {
│         "name": "李老师",
│         "role": "teacher",         // teacher | assistant | student
│         "persona": "耐心细致...",   // 2-3 句角色描述
│         "avatar": "/avatars/teacher.png",
│         "color": "#6366f1",
│         "priority": 10,            // 10=teacher, 7=assistant, 4-6=student
│         "voice": "minimax-tts::male-qn-qingse"
│       },
│       ...
│     ]
│   }
│
├─ 校验: 恰好 1 个 teacher, 至少 2 个 agent
├─ 为每个 agent 分配 ID: gen-{nanoid(8)}
└─ 解析 voice 字符串 → { providerId, voiceId }

返回:
  { agents: AgentInfo[] }


客户端:
├─ 保存到 IndexedDB (AgentRegistry)
├─ 弹出 AgentRevealModal
│   └─ 用户逐张翻牌 → 揭示角色 (教师/助教/学生)
└─ 全部揭示后继续
```

---

## 阶段 5：第 1 个场景完整生成

**此阶段完成后用户即可进入课堂，无需等待全部场景。**

### Step 4a：内容生成

```
POST /api/generate/scene-content

请求:
  {
    outline: SceneOutline,           // 当前大纲
    allOutlines: SceneOutline[],     // 全部大纲 (提供上下文)
    pdfImages?: PdfImage[],
    imageMapping?: ImageMapping,
    stageInfo: { name, description?, style? },
    stageId: string,
    agents?: AgentInfo[],
    languageDirective?: string
  }

服务端处理:
│
├─ 解析模型 + 视觉能力检测
├─ applyOutlineFallbacks(outline, hasModel)
│   └─ interactive/pbl 缺少必要配置 → 降级为 slide
│
├─ 按 outline.type 路由:
│
│   ┌─ SLIDE ───────────────────────────────────────────┐
│   │  Prompt: SLIDE_CONTENT                             │
│   │  输入: title, description, keyPoints,              │
│   │        assignedImages, canvas(1000×562.5),          │
│   │        teacherContext, languageDirective             │
│   │                                                    │
│   │  LLM 输出: GeneratedSlideData {                    │
│   │    elements: [{                                    │
│   │      type: 'text'|'image'|'shape'|'chart'|...,     │
│   │      left, top, width, height,                     │
│   │      content?, src?, fill?, ...                    │
│   │    }],                                             │
│   │    background: { type, color|gradient }             │
│   │  }                                                 │
│   │                                                    │
│   │  后处理链:                                          │
│   │  ├─ fixElementDefaults()    — 填充默认值            │
│   │  ├─ processLatexElements()  — KaTeX 渲染           │
│   │  ├─ resolveImageIds()       — img_1 → base64 URL   │
│   │  └─ 分配唯一 ID: element_{nanoid}                  │
│   └────────────────────────────────────────────────────┘
│
│   ┌─ QUIZ ────────────────────────────────────────────┐
│   │  Prompt: QUIZ_CONTENT                              │
│   │  LLM 输出: QuizQuestion[] {                        │
│   │    question, options[], answer, explanation          │
│   │  }                                                 │
│   │  后处理: normalizeOptions(), normalizeAnswer()      │
│   └────────────────────────────────────────────────────┘
│
│   ┌─ INTERACTIVE ─────────────────────────────────────┐
│   │  Step 1: 科学建模 (优雅降级)                        │
│   │  Step 2: HTML 生成 via Prompt                      │
│   │  Step 3: postProcessInteractiveHtml() + KaTeX 注入 │
│   └────────────────────────────────────────────────────┘
│
│   ┌─ PBL ─────────────────────────────────────────────┐
│   │  generatePBLContent(languageModel)                  │
│   │  返回: projectConfig { agents, issueboard }         │
│   └────────────────────────────────────────────────────┘

返回:
  { content: GeneratedContent, effectiveOutline: SceneOutline }
```

### Step 4b：动作生成

```
POST /api/generate/scene-actions

请求:
  {
    outline: SceneOutline,
    content: GeneratedContent,       // 上一步产出
    allOutlines: SceneOutline[],
    stageId: string,
    agents?: AgentInfo[],
    previousSpeeches?: string[],     // 之前场景的讲话内容 (保证连贯)
    userProfile?: string,
    languageDirective?: string
  }

服务端处理:
│
├─ 构建场景上下文: pageIndex, totalPages, allTitles, previousSpeeches
│
├─ Prompt: SLIDE_ACTIONS / QUIZ_ACTIONS / INTERACTIVE_ACTIONS / PBL_ACTIONS
│
├─ LLM 生成 Action 序列:
│
│   Action 类型:
│   ┌─────────────────┬──────────────────────────────────────┐
│   │ speech          │ { text, agentId }     讲话            │
│   │ spotlight       │ { elementId }         聚光灯指向元素   │
│   │ laser           │ { elementId }         激光笔           │
│   │ discussion      │ { agentId, topic }    触发讨论         │
│   │ wb_open         │ { paths[] }           白板绘图         │
│   │ play_video      │ { elementId }         播放视频         │
│   │ pause           │ { duration }          暂停             │
│   └─────────────────┴──────────────────────────────────────┘
│
├─ 校验:
│   ├─ elementId 引用的元素必须存在
│   ├─ agentId 引用的 agent 必须存在
│   └─ 缺失 → 用 fallback 补充
│
└─ buildCompleteScene(outline, content, actions, stageId) → 组装完整 Scene

返回:
  { scene: Scene, previousSpeeches: string[] }
```

### Step 4c：TTS 语音合成（如开启）

```
条件: settings.ttsEnabled && ttsProviderId !== 'browser-native-tts'

遍历 scene.actions 中每个 speech 类型:
│
├─ POST /api/generate/tts
│   ├─ 请求: { text, audioId, ttsProviderId, ttsModelId }
│   ├─ Provider:
│   │   ├─ OpenAI TTS     — 标准 & HD 语音
│   │   ├─ Azure Speech   — 丰富语种
│   │   ├─ MiniMax        — speech-2.8 系列
│   │   ├─ GLM (智谱)     — 中文优化
│   │   ├─ Qwen (通义)    — 阿里云
│   │   ├─ Doubao (豆包)  — 字节跳动
│   │   └─ ElevenLabs     — 高质量多语种
│   └─ 返回: { success, base64, format }
│
├─ base64 解码 → Blob
└─ 存入 IndexedDB: db.audioFiles.put({ id: audioId, blob, format })
```

### 数据持久化 → 跳转课堂

```
生成完毕:
│
├─ stageStore.setStage({
│     id: stageId,
│     name: extractTopicFromRequirement(),
│     languageDirective,
│     agentIds: agents.map(a => a.id)
│   })
│
├─ stageStore.addScene(firstScene)
│
├─ stageStore.setGeneratingOutlines(
│     outlines.filter(o => o.order !== 1)  // 剩余待生成大纲
│   )
│
├─ sessionStorage.setItem('generationParams', JSON.stringify({
│     pdfImages, agents, userProfile, languageDirective
│   }))
│
├─ localStorage.removeItem('requirementDraft')  // 清除草稿
│
└─ router.push('/classroom/{stageId}')
```

---

## 阶段 6：课堂内 — 剩余场景 + 媒体并行生成

**页面：** `/classroom/[id]`
**关键文件：** `app/classroom/[id]/page.tsx`, `lib/hooks/use-scene-generator.ts`, `lib/media/media-orchestrator.ts`

### 课堂加载

```
ClassroomDetailPage 挂载:
│
├─ 路径 1: 从 IndexedDB 加载 (本地生成的课堂)
│   └─ loadFromStorage(classroomId)
│
├─ 路径 2: 从 API 加载 (服务端生成/分享的课堂)
│   └─ GET /api/classroom?id={id} → { stage, scenes }
│
├─ 恢复媒体生成任务
│   └─ MediaGenerationStore.restoreFromDB(classroomId)
│
├─ 恢复 Agent 配置
│   └─ loadGeneratedAgentsForStage(classroomId)
│
└─ 自动启动两条并行管线 ↓
```

### 管线 A：串行生成剩余场景（后台）

```
useSceneGenerator().generateRemaining()

for each 剩余 outline (按 order 排序):
│
├─ 1. 内容生成
│     POST /api/generate/scene-content
│     → content
│
├─ 2. 动作生成
│     POST /api/generate/scene-actions
│     → scene (包含 actions[])
│
├─ 3. TTS 语音合成 (逐条 speech)
│     POST /api/generate/tts × N
│     → 音频 Blob 存入 IndexedDB
│
├─ 4. 更新 Store
│     stageStore.addScene(scene)
│     └─ 侧边栏实时出现新场景缩略图
│
└─ 5. 回调
      onSceneGenerated(scene, order)

失败处理:
├─ 单个场景失败 → 加入 failedOutlines 列表
├─ 不阻塞后续场景生成
└─ 用户可手动 retrySingleOutline(outlineId)
```

### 管线 B：并行生成媒体（图片/视频）

```
generateMediaForOutlines(outlines, stageId)

与管线 A 完全并行，互不阻塞:
│
├─ 收集所有 outline 中的 mediaGenerations[]
│   ├─ 过滤: 未开启图片生成 → 跳过 type:'image'
│   ├─ 过滤: 未开启视频生成 → 跳过 type:'video'
│   └─ 过滤: 已完成/已失败的任务 → 跳过
│
├─ 注册到 MediaGenerationStore (状态: pending)
│
├─ 逐个执行 (串行, 避免 API 并发限制):
│
│   图片生成:
│   ├─ POST /api/generate/image
│   │   Headers: x-image-provider, x-image-model, x-api-key, x-base-url
│   │   Body: { prompt, aspectRatio, style }
│   │   Provider: Seedream / MiniMax / Qwen / Grok / Nano Banana
│   └─ 返回: { url } 或 { base64 }
│
│   视频生成:
│   ├─ POST /api/generate/video  (异步任务, 最长 300s)
│   │   Headers: x-video-provider, x-video-model, x-api-key, x-base-url
│   │   Body: { prompt, aspectRatio }
│   │   Provider: Seedance / Kling / Veo / Sora / MiniMax / Grok
│   └─ 返回: { url, poster }
│
│   下载 & 存储:
│   ├─ 远程 URL → POST /api/proxy-media (绕 CORS)
│   ├─ data: URL → 直接 fetch
│   ├─ Blob 存入 IndexedDB: db.mediaFiles.put({
│   │     id: mediaFileKey(stageId, elementId),
│   │     blob, mimeType, prompt, params, createdAt
│   │   })
│   └─ 创建 objectURL → MediaGenerationStore.markDone(elementId, url)
│       └─ 幻灯片中的占位符自动替换为真实图片/视频
│
└─ 失败处理: 标记 failed, 不阻塞其他任务
```

### 两条管线的时序关系

```
时间 ──────────────────────────────────────────────────▶

管线A  ║ Scene 2 内容 │ Scene 2 动作 │ Scene 2 TTS │ Scene 3 内容 │ ...
(串行) ║──────────────┼─────────────┼────────────┼─────────────┼──

管线B  ║ Image 1 │ Image 2 │ Video 1 │ Image 3 │ Video 2 │ ...
(串行) ║─────────┼─────────┼─────────┼─────────┼─────────┼──

播放   ║ ▶ Scene 1 播放中...  │ ▶ Scene 2 (可用后自动切换)
(用户) ║─────────────────────┼──────────────────────────────
```

---

## 阶段 7：播放引擎 — 交互式授课

**关键文件：** `lib/playback/engine.ts`, `lib/action/engine.ts`, `components/stage.tsx`

### 播放引擎状态机

```
                start()              pause()
           idle ────────────→ playing ────────→ paused
             ▲                    ▲                 │
             │  讨论结束           │  resume()       │
             │                    └─────────────────┘
             │
             │  confirmDiscussion()
             │
             └────────────────── live (讨论模式)
                          ▲                │
                          │ resume / msg   │ pause()
                          └────────────────┘
```

### 核心播放循环

```
用户点击"开始播放" → engine.start()

processNext() 循环:
│
├─ 获取当前 Action
│   └─ 全部完成? → onComplete() → 自动切下一场景 (如开启)
│
├─ 按 action.type 分发:
│
│   ┌─ SPEECH ──────────────────────────────────────────┐
│   │                                                    │
│   │  1. onSpeechStart(text)                            │
│   │     └─ 字幕显示 + 聊天区添加讲话消息                  │
│   │                                                    │
│   │  2. 尝试播放预生成音频 (IndexedDB)                    │
│   │     ├─ 成功 → 等待 onEnded → processNext()          │
│   │     └─ 失败 → 降级:                                │
│   │         ├─ browser-native-tts → Web Speech API     │
│   │         └─ 无 TTS → 阅读计时器                      │
│   │             CJK: 150ms/字, 非CJK: 240ms/词         │
│   │                                                    │
│   └────────────────────────────────────────────────────┘
│
│   ┌─ SPOTLIGHT / LASER ───────────────────────────────┐
│   │                                                    │
│   │  actionEngine.execute(action)                      │
│   │  └─ 元素高亮 / 激光笔动画                           │
│   │                                                    │
│   │  Fire-and-forget → 立即 processNext()               │
│   │                                                    │
│   └────────────────────────────────────────────────────┘
│
│   ┌─ DISCUSSION ──────────────────────────────────────┐
│   │                                                    │
│   │  1. 已消费过? → 跳过                                │
│   │  2. Agent 未选中? → 跳过                            │
│   │  3. 3 秒延迟后显示 ProactiveCard (提问卡片)          │
│   │                                                    │
│   │  播放暂停, 等待用户选择:                              │
│   │                                                    │
│   │  用户点击"加入讨论":                                 │
│   │  ├─ 保存当前播放位置                                 │
│   │  ├─ 切换到 live 模式                                │
│   │  ├─ 发起 SSE → POST /api/chat                     │
│   │  │   ├─ LangGraph 多智能体编排                      │
│   │  │   ├─ Director 协调多轮对话:                       │
│   │  │   │   START → Director → Agent → Director → END  │
│   │  │   ├─ Agent 用 Tool 执行 Action (聚光灯/白板/...)  │
│   │  │   └─ 用户可打字/语音参与                          │
│   │  ├─ 讨论结束 → 恢复 lecture 模式                     │
│   │  └─ 从保存的位置继续 processNext()                   │
│   │                                                    │
│   │  用户点击"跳过":                                    │
│   │  └─ processNext()                                  │
│   │                                                    │
│   └────────────────────────────────────────────────────┘
│
│   ┌─ WB_OPEN (白板) ─────────────────────────────────┐
│   │                                                    │
│   │  打开白板覆盖层                                     │
│   │  Agent 实时绘图 (paths → canvas)                    │
│   │  绘制完毕 → processNext()                           │
│   │                                                    │
│   └────────────────────────────────────────────────────┘
│
│   ┌─ PLAY_VIDEO ──────────────────────────────────────┐
│   │                                                    │
│   │  播放幻灯片中的视频元素                               │
│   │  视频结束 → processNext()                           │
│   │                                                    │
│   └────────────────────────────────────────────────────┘
│
└─ 场景全部播放完毕 → onComplete():
    ├─ autoPlayLecture 开启?
    │   └─ 1.5 秒后自动切到下一场景 → engine.start()
    └─ 否则等待用户手动切换
```

### Stage 组件树

```
<Stage>
├─ <Header>                     — 标题, 控制按钮
├─ <SceneSidebar>               — 场景列表 (缩略图), 场景切换
├─ <CanvasArea>                 — 主画布区域
│   └─ <SceneRenderer>
│       ├─ SlideEditor          — 幻灯片渲染 (elements → canvas)
│       ├─ QuizRenderer         — 测验交互
│       ├─ InteractiveRenderer  — 互动 HTML 沙箱
│       └─ PBLRenderer          — PBL 项目工作台
│           ├─ ChatPanel        — 讨论面板
│           ├─ IssueboardPanel  — 问题看板
│           └─ RoleSelection    — 角色选择
├─ <Roundtable>                 — 授课/讨论覆盖层
│   ├─ Agent 头像 + 名牌
│   ├─ 语音指示器
│   └─ PresentationSpeechOverlay — 字幕显示
├─ <ChatArea>                   — 聊天面板
│   ├─ LectureSession           — 播放时的讲课记录
│   ├─ DiscussionSession        — 实时讨论对话
│   └─ QASession                — 用户问答
└─ <Whiteboard>                 — 白板覆盖层
    ├─ WhiteboardCanvas         — 绘图 Canvas
    └─ WhiteboardHistory        — 撤销/重做
```

---

## 数据存储一览

```
┌───────────────────┬────────────────────────────────┬───────────────────────┐
│     存储层         │          存储内容               │       生命周期         │
├───────────────────┼────────────────────────────────┼───────────────────────┤
│ sessionStorage    │ 页面间传递:                      │ 生成预览 → 课堂       │
│                   │ - generationSession (进度状态)   │ 跳转后即清除          │
│                   │ - generationParams (构建参数)    │                       │
├───────────────────┼────────────────────────────────┼───────────────────────┤
│ localStorage      │ Zustand persist:                │ 长期持久化             │
│ (Zustand)         │ - Settings (Provider/Model/TTS) │ 跨会话保留             │
│                   │ - UserProfile                   │                       │
├───────────────────┼────────────────────────────────┼───────────────────────┤
│ Zustand (内存)    │ 运行时状态:                      │ 当前页面会话           │
│                   │ - StageStore (场景/元素)         │ 刷新后从 IndexedDB 恢复│
│                   │ - CanvasStore (画布/选择)        │                       │
│                   │ - PlaybackEngine (播放状态)      │                       │
│                   │ - MediaGenerationStore (进度)    │                       │
├───────────────────┼────────────────────────────────┼───────────────────────┤
│ IndexedDB (Dexie) │ 大容量数据:                      │ 长期持久化             │
│                   │ - PDF Blob                      │ 按 stageId 隔离       │
│                   │ - 音频文件 (TTS 产物)            │                       │
│                   │ - 媒体文件 (图片/视频 Blob)       │                       │
│                   │ - 课堂完整数据 (stage + scenes)  │                       │
│                   │ - Agent 配置 (AgentRegistry)     │                       │
├───────────────────┼────────────────────────────────┼───────────────────────┤
│ 服务端文件系统     │ 分享的课堂:                      │ 持久化                 │
│                   │ - Stage JSON                    │ 通过 /api/classroom   │
│                   │ - Scene JSON                    │ 可公开访问             │
│                   │ - 媒体文件                       │                       │
└───────────────────┴────────────────────────────────┴───────────────────────┘
```

---

## 容错机制

| 阶段 | 失败场景 | 处理策略 |
|------|----------|----------|
| **PDF 解析** | Provider 不可用 | MinerU Cloud → MinerU 本地 → unpdf 回退 |
| **Web 搜索** | Tavily API 失败 | 优雅降级: 跳过 researchContext，不阻塞 |
| **大纲生成** | 空结果 | 自动重试 2 次 |
| **大纲生成** | interactive/pbl 缺配置 | `applyOutlineFallbacks()` 降级为 slide |
| **Agent 生成** | LLM 输出格式错误 | 回退到预设 Agent 列表 |
| **Agent 生成** | 全部失败 | 空 Agent 继续流程 |
| **场景内容** | LLM JSON 格式错误 | `json-repair.ts` 自动修复 |
| **场景内容** | 完全失败 | 标记 failedOutline，用户可手动重试 |
| **动作生成** | LLM 输出不合法 | 生成 default actions (聚光灯 + keyPoints 朗读) |
| **动作生成** | elementId 引用不存在 | 忽略该 action，继续 |
| **TTS** | Provider 不可用 | 运行时: 浏览器 Web Speech API 朗读 |
| **TTS** | 单条语音失败 | 记录日志继续；播放时用阅读计时器替代 |
| **媒体生成** | 图片/视频 API 失败 | 标记 failed，幻灯片保留占位符 |
| **媒体生成** | 远程 URL 跨域 | `/api/proxy-media` 服务端代理下载 |

---

## 关键代码位置索引

### 用户输入 & 页面路由

| 文件 | 职责 |
|------|------|
| `app/page.tsx` | 首页: 表单收集, `handleGenerate()` |
| `app/generation-preview/page.tsx` | 生成预览: 步骤编排, SSE 流式显示 |
| `app/generation-preview/types.ts` | `GenerationSessionState`, `GenerationStep` |
| `app/classroom/[id]/page.tsx` | 课堂页: 加载/恢复, 启动后台生成 |

### 生成流水线

| 文件 | 职责 |
|------|------|
| `lib/generation/pipeline-runner.ts` | 流水线执行器 (服务端模式) |
| `lib/generation/pipeline-types.ts` | 流水线数据类型 |
| `lib/generation/outline-generator.ts` | 大纲生成 + fallback + 去重 |
| `lib/generation/scene-generator.ts` | 场景内容生成 (4 种 type) |
| `lib/generation/scene-builder.ts` | 场景组装 (content + actions → Scene) |
| `lib/generation/action-parser.ts` | 动作解析 & 校验 |
| `lib/generation/json-repair.ts` | LLM JSON 输出修复 |
| `lib/generation/prompt-formatters.ts` | Prompt 变量格式化 |
| `lib/generation/prompts/` | 各阶段 Prompt 模板 |
| `lib/generation/interactive-post-processor.ts` | 互动 HTML 后处理 |

### API 路由

| 文件 | 职责 |
|------|------|
| `app/api/generate/scene-outlines-stream/route.ts` | SSE 流式大纲生成 |
| `app/api/generate/scene-content/route.ts` | 场景内容生成 |
| `app/api/generate/scene-actions/route.ts` | 场景动作生成 |
| `app/api/generate/agent-profiles/route.ts` | Agent 角色生成 |
| `app/api/generate/tts/route.ts` | TTS 语音合成 |
| `app/api/generate/image/route.ts` | 文生图 |
| `app/api/generate/video/route.ts` | 文生视频 |
| `app/api/parse-pdf/route.ts` | PDF 解析 |
| `app/api/web-search/route.ts` | Web 搜索 |
| `app/api/chat/route.ts` | 实时聊天 (讨论/问答) |
| `app/api/generate-classroom/route.ts` | 服务端一键生成入口 |

### 客户端 Hooks & 引擎

| 文件 | 职责 |
|------|------|
| `lib/hooks/use-scene-generator.ts` | 客户端场景生成 Hook |
| `lib/media/media-orchestrator.ts` | 媒体生成编排器 (并行管线) |
| `lib/playback/engine.ts` | 播放引擎状态机 |
| `lib/action/engine.ts` | Action 执行引擎 (聚光灯/激光笔/白板) |

### 多智能体编排

| 文件 | 职责 |
|------|------|
| `lib/orchestration/director-graph.ts` | LangGraph 有向图: Director → Agent |
| `lib/orchestration/prompt-builder.ts` | 结构化 Prompt 构建 |
| `lib/orchestration/tool-schemas.ts` | Agent 可用 Tool 定义 |
| `lib/orchestration/registry/store.ts` | Agent 注册表 |

### 服务端

| 文件 | 职责 |
|------|------|
| `lib/server/classroom-generation.ts` | 服务端课堂生成编排器 |
| `lib/server/classroom-job-runner.ts` | 后台 Job 执行器 |
| `lib/server/classroom-job-store.ts` | Job 状态持久化 |
| `lib/server/resolve-model.ts` | 模型解析 (Header → Provider) |
| `lib/server/proxy-fetch.ts` | 代理 Fetch (绕 CORS) |
| `lib/server/ssrf-guard.ts` | SSRF 防护 |

---

*文档生成时间: 2026-04-17 | 基于项目版本 v0.1.1*
