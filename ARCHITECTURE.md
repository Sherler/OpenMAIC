# OpenMAIC 项目架构文档

> **OpenMAIC** (Open Multi-Agent Interactive Classroom) — 一键生成沉浸式多智能体交互课堂。
>
> 技术栈：Next.js 16 · React 19 · TypeScript 5 · LangGraph 1.1 · Tailwind CSS 4 · Zustand · ProseMirror

---

## 目录

- [1. 项目概览](#1-项目概览)
- [2. 顶层目录结构](#2-顶层目录结构)
- [3. 技术栈与依赖](#3-技术栈与依赖)
- [4. 应用路由 (app/)](#4-应用路由-app)
  - [4.1 页面路由](#41-页面路由)
  - [4.2 API 路由](#42-api-路由)
- [5. 核心逻辑层 (lib/)](#5-核心逻辑层-lib)
- [6. 组件层 (components/)](#6-组件层-components)
- [7. 配置层 (configs/)](#7-配置层-configs)
- [8. 本地包 (packages/)](#8-本地包-packages)
- [9. 状态管理](#9-状态管理)
- [10. AI 与多智能体编排](#10-ai-与多智能体编排)
- [11. 课堂生成流水线](#11-课堂生成流水线)
- [12. 多模态能力](#12-多模态能力)
- [13. 国际化 (i18n)](#13-国际化-i18n)
- [14. 安全机制](#14-安全机制)
- [15. 测试体系](#15-测试体系)
- [16. 部署与基础设施](#16-部署与基础设施)
- [17. 数据流总览](#17-数据流总览)

---

## 1. 项目概览

OpenMAIC 是一个全栈 Next.js 应用，核心功能是将 PDF/文本材料通过多 AI Agent 协作，一键生成包含幻灯片、测验、PBL（项目式学习）、互动 HTML 等丰富场景的"交互课堂"。AI 教师和同伴能实时讲课、讨论、在白板上画图和朗读。

**核心能力：**

| 能力 | 描述 |
|------|------|
| 一键课堂生成 | 从 PDF 或文字需求自动生成完整课堂 |
| 多智能体协作 | LangGraph 编排的 Director + Agent 架构 |
| 丰富场景类型 | Slides / Quiz / Interactive HTML / PBL |
| 语音与白板 | TTS 朗读 + 白板绘图, 沉浸式授课 |
| 多模态生成 | 图片 / 视频 / 音频自动生成 |
| 导入导出 | 支持 .pptx / .html / .zip 导出和导入 |
| 即时问答 | Chat 通道与课堂实时交互 |
| Web Search | 联网搜索增强课堂内容 |

---

## 2. 顶层目录结构

```
OpenMAIC/
├── app/                    # Next.js App Router (页面 + API)
├── components/             # React 组件
├── lib/                    # 核心业务逻辑
├── configs/                # 应用级配置常量
├── packages/               # 本地 monorepo 包
│   ├── mathml2omml/        # MathML → OMML 转换
│   └── pptxgenjs/          # PowerPoint 生成
├── public/                 # 静态资源 (avatars, logos)
├── assets/                 # README 示意图/GIF
├── tests/                  # Vitest 单元测试
├── e2e/                    # Playwright E2E 测试
├── skills/                 # OpenClaw 集成 SOP
├── community/              # 社区文档
├── middleware.ts            # Next.js 边缘中间件 (Access Code)
├── next.config.ts           # Next.js 配置
├── docker-compose.yml       # Docker 编排
├── Dockerfile               # 多阶段构建
├── vercel.json              # Vercel 部署配置
└── pnpm-workspace.yaml      # PNPM monorepo 配置
```

---

## 3. 技术栈与依赖

### 框架与运行时

| 类别 | 技术 |
|------|------|
| 前端框架 | Next.js 16.1 (App Router) |
| UI 库 | React 19.2 |
| 样式 | Tailwind CSS 4 + shadcn/ui + Radix UI |
| 语言 | TypeScript 5 |
| 包管理 | pnpm 10 (monorepo workspace) |
| 运行时 | Node.js ≥ 20.9.0 |

### AI / LLM

| 类别 | 技术 |
|------|------|
| AI SDK | Vercel AI SDK (@ai-sdk/openai, @ai-sdk/anthropic, @ai-sdk/google) |
| 多智能体编排 | LangGraph 1.1 (@langchain/langgraph) |
| LLM 适配 | OpenAI / Anthropic / Google / DeepSeek / Kimi / MiniMax / GLM / SiliconFlow / Doubao / Grok / Ollama |

### 多媒体与文档

| 类别 | 技术 |
|------|------|
| PDF 解析 | unpdf, MinerU (local/cloud) |
| PPT 生成 | PptxGenJS (本地 fork) |
| 富文本编辑 | ProseMirror |
| 图片渲染 | @napi-rs/canvas, sharp |
| 代码高亮 | shiki |
| 公式渲染 | KaTeX, temml |
| 图表 | ECharts |

### 状态与存储

| 类别 | 技术 |
|------|------|
| 客户端状态 | Zustand (persist middleware → localStorage) |
| 客户端数据库 | Dexie (IndexedDB) |
| 服务端存储 | 文件系统 (可扩展) |
| 数据验证 | Zod |

---

## 4. 应用路由 (app/)

### 4.1 页面路由

| 路径 | 类型 | 描述 |
|------|------|------|
| `/` | Client Page | 主页：上传 PDF / 输入需求 → 生成课堂 |
| `/generation-preview` | Client Page | 课堂生成实时预览 (SSE 流式进度) |
| `/classroom/[id]` | Client Page | 课堂查看/编辑 (从 IndexedDB 或服务端加载) |

### 4.2 API 路由

#### LLM 与聊天

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/api/chat` | 无状态聊天端点, SSE 流式响应 |
| POST | `/api/verify-model` | 验证 LLM 连通性 |
| GET  | `/api/server-providers` | 获取服务端配置的所有 Provider |

#### 课堂生成

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/api/generate-classroom` | 发起异步课堂生成 (返回 jobId) |
| POST | `/api/generate-classroom/[jobId]` | 轮询生成任务状态 |
| POST | `/api/generate/scene-outlines-stream` | SSE 流式生成场景大纲 |
| POST | `/api/generate/scene-content` | 生成场景内容 (第 1 步: 幻灯片/测验) |
| POST | `/api/generate/scene-actions` | 生成场景动作 (第 2 步: 语音/动画) |
| POST | `/api/generate/agent-profiles` | 生成 AI Agent 角色配置 |

#### 多媒体生成

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/api/generate/image` | 文生图 |
| POST | `/api/generate/video` | 文生视频 (异步任务, 最长 300s) |
| POST | `/api/generate/tts` | TTS 语音合成 |

#### 文档处理

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/api/parse-pdf` | PDF 解析 (multipart 上传) |
| POST | `/api/web-search` | Web 搜索 (Tavily) |
| POST | `/api/transcription` | ASR 语音转文字 |

#### PBL (项目式学习)

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/api/pbl/chat` | PBL 运行时对话 (@mention 路由到对应 Agent) |

#### 课堂存储与媒体

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/api/classroom` | 保存课堂到服务端 |
| GET  | `/api/classroom?id={id}` | 获取已保存的课堂 |
| GET  | `/api/classroom-media/[classroomId]/[...path]` | 获取课堂媒体文件 |
| POST | `/api/proxy-media` | 服务端媒体代理, 绕过 CORS |

#### 认证与健康检查

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/api/access-code/verify` | 验证访问码 (HMAC-SHA256) |
| GET  | `/api/access-code/status` | 检查认证状态 |
| GET  | `/api/health` | 健康检查 + 服务端能力报告 |

#### Provider 验证

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/api/verify-image-provider` | 验证图片 Provider 凭证 |
| POST | `/api/verify-pdf-provider` | 验证 PDF Provider 凭证 |
| POST | `/api/verify-video-provider` | 验证视频 Provider 凭证 |
| POST | `/api/azure-voices` | 获取 Azure TTS 语音列表 |

---

## 5. 核心逻辑层 (lib/)

```
lib/
├── ai/                # AI Provider 管理 (providers.ts, llm.ts)
├── orchestration/     # LangGraph 多智能体编排 (director-graph.ts)
├── generation/        # 课堂生成流水线 (outline → content → actions)
├── store/             # Zustand 全局状态 (settings, stage, canvas...)
├── types/             # TypeScript 类型定义 (12 个类型文件)
├── hooks/             # React 自定义 Hook (13 个)
├── contexts/          # React Context (scene, media-stage)
├── api/               # Stage API 抽象层 (stage-api-*.ts, 9 个文件)
├── server/            # 服务端工具 (SSRF 防护, Provider 配置, 课堂存储)
├── audio/             # TTS / ASR Provider (OpenAI, Azure, GLM, Qwen, MiniMax...)
├── media/             # 图片/视频生成 Provider + 编排器
├── chat/              # 聊天消息处理
├── action/            # Action 执行引擎
├── export/            # 导出 (PPTX, HTML, ZIP)
├── import/            # 导入 (ZIP 课堂包)
├── pdf/               # PDF 解析 (unpdf, MinerU)
├── playback/          # 播放引擎 (状态机, 派生状态)
├── prosemirror/       # ProseMirror 富文本 (schema + plugins + commands)
├── storage/           # 存储抽象层
├── buffer/            # Stream Buffer
├── pbl/               # 项目式学习 (PBL) 模块
├── web-search/        # Web 搜索 (Tavily)
├── i18n/              # 国际化 (6 种语言)
├── utils/             # 通用工具 (14 个)
├── constants/         # 应用常量
└── logger.ts          # 结构化日志
```

### 核心模块说明

| 模块 | 文件数 | 职责 |
|------|--------|------|
| **ai/** | 3 | 统一的 LLM Provider 注册表, 支持 10+ 家 Provider |
| **orchestration/** | 8+ | LangGraph 有向图编排: `START → Director → Agent Generate → [Director \| END]` |
| **generation/** | 12+ | 两阶段课堂生成: 大纲 → 内容 + 动作, 含 JSON 修复和 Prompt 模板 |
| **store/** | 10 | Zustand 持久化状态: settings, stage, canvas, keyboard, snapshot... |
| **server/** | 11 | 服务端: SSRF 防护, 课堂 Job Runner, 媒体生成, Provider 配置 |
| **audio/** | 9 | TTS/ASR: 7 种 TTS Provider, 3 种 ASR Provider, 语音解析 |
| **media/** | 5+ | 图片生成 (5 Provider) + 视频生成 (6 Provider) + Media Orchestrator |
| **playback/** | 4 | 课堂播放状态机, 控制幻灯片自动播放与动画 |
| **prosemirror/** | 6+ | 富文本 Schema/Plugin/Command, 幻灯片内文本编辑 |
| **export/** | 8+ | PPTX (via PptxGenJS) + ZIP (课堂完整打包) + LaTeX→OMML |
| **pdf/** | 6 | PDF 解析: unpdf (轻量) / MinerU (高精度, 支持 Cloud) |

---

## 6. 组件层 (components/)

```
components/
├── 顶层组件                    # access-code-guard, header, stage, user-profile...
├── agent/         (4)         # Agent 头像/选择栏/配置面板/揭示弹窗
├── ai-elements/   (29)        # AI 对话元素: message, reasoning, code-block, citation...
├── audio/         (2)         # 语音按钮, TTS 配置浮窗
├── canvas/        (2)         # Canvas 画布区域 + 工具栏
├── chat/          (8)         # 聊天区域, 会话管理, SSE 流处理
├── generation/    (4)         # 生成进度条, 大纲编辑器, 媒体浮窗
├── roundtable/    (4)         # 圆桌讨论 (多人演示/朗读覆盖层)
├── scene-renderers/ (5+6)     # 场景渲染器: Quiz / Interactive / PBL
├── settings/      (16)        # 全面的设置面板 (LLM/TTS/ASR/PDF/Image/Video/WebSearch)
├── slide-renderer/ (40+)      # 幻灯片渲染: Editor + Canvas + Element 渲染器
│   ├── Editor/                # 编辑器主体 (Spotlight/Laser/Zoom)
│   ├── Editor/Canvas/         # 画布: 选择/对齐/网格/尺子
│   ├── Editor/Canvas/Operate/ # 元素操作: 缩放/旋转/边框
│   └── components/element/    # 元素渲染: Text/Image/Shape/Chart/Code/LaTeX/Table/Video/Line
├── stage/         (2)         # Stage 场景渲染器 + 侧边栏
├── ui/            (32)        # shadcn/ui 基础组件库 (Button/Dialog/Select/Card...)
└── whiteboard/    (3)         # 数字白板 (绘图/擦除/历史)
```

### 关键组件区域

| 区域 | 组件数 | 说明 |
|------|--------|------|
| **slide-renderer/** | 40+ | 最复杂的组件树, 完整的幻灯片编辑器, 含 10+ 种元素渲染器 |
| **ai-elements/** | 29 | AI 对话的可视化组件: 思维链、推理、工具调用、源引用等 |
| **settings/** | 16 | 覆盖所有 Provider 的配置面板 |
| **ui/** | 32 | 基于 shadcn/ui + Radix UI 的设计系统 |
| **scene-renderers/** | 11 | 支持 Quiz / Interactive / PBL 三种额外场景类型 |

---

## 7. 配置层 (configs/)

| 文件 | 用途 |
|------|------|
| `animation.ts` | 动画参数/时序 |
| `chart.ts` | ECharts 图表配置 |
| `element.ts` | 幻灯片元素属性 |
| `font.ts` | 字体族定义 |
| `hotkey.ts` | 快捷键映射 |
| `image-clip.ts` | 图片裁剪选项 |
| `latex.ts` | LaTeX 渲染配置 |
| `lines.ts` | 线条/箭头属性 |
| `mime.ts` | MIME 类型映射 |
| `shapes.ts` | 几何图形定义 |
| `storage.ts` | 存储配置 |
| `symbol.ts` | 符号定义 |
| `theme.ts` | 主题/配色方案 |

---

## 8. 本地包 (packages/)

| 包名 | 版本 | 用途 | 原始仓库 |
|------|------|------|----------|
| `mathml2omml` | 0.5.0 | MathML → Office Math Markup Language | fiduswriter/mathml2omml |
| `pptxgenjs` | 4.0.1 | JavaScript PPT 生成 | gitbrent/PptxGenJS |

两个包均通过 Rollup 构建为 ESM + CJS 格式, 通过 `pnpm-workspace.yaml` 作为 workspace 依赖引用。

---

## 9. 状态管理

采用 **Zustand** + `persist` middleware, 核心 Store:

| Store | 文件 | 职责 |
|-------|------|------|
| `useSettingsStore` | `lib/store/settings.ts` | 全局配置: Provider 选择、API Key、TTS/ASR/PDF/Image/Video 设置 |
| `useStageStore` | `lib/store/stage.ts` | 课堂 Stage: 场景列表、当前场景、编辑状态 |
| `useCanvasStore` | `lib/store/canvas.ts` | 画布状态: 缩放、元素选择、编辑模式 |
| `useKeyboardStore` | `lib/store/keyboard.ts` | 键盘快捷键状态 |
| `useSnapshotStore` | `lib/store/snapshot.ts` | 撤销/重做快照 |
| `useMediaGenerationStore` | `lib/store/media-generation.ts` | 媒体生成进度追踪 |
| `useWhiteboardHistoryStore` | `lib/store/whiteboard-history.ts` | 白板绘画历史 |
| `useUserProfileStore` | `lib/store/user-profile.ts` | 用户昵称等个人信息 |

### Settings Store 特殊机制

- **Server Providers 同步**：`fetchServerProviders()` 从 `/api/server-providers` 拉取服务端 `.env` 配置, 自动合并到客户端状态
- **Auto-config 首次运行**：`autoConfigApplied` 标志位, 首次加载自动选择最佳 Provider
- **Provider 校验链**：`validateProvider()` → `validateModel()` 确保选中的 Provider/Model 始终可用
- **Fallback 机制**：按 `服务端配置优先 → 客户端 API Key → 默认值` 依次回退

---

## 10. AI 与多智能体编排

### Provider 架构

```
lib/ai/providers.ts
├── PROVIDERS 注册表 (Record<ProviderId, ProviderConfig>)
│   ├── openai      (GPT-4o, o3-mini, ...)
│   ├── anthropic   (Claude 4, Claude 3.5, ...)
│   ├── google      (Gemini 2.5, ...)
│   ├── deepseek    (V3.2, R1, ...)
│   ├── kimi        (K2.5, K2-Thinking, ...)
│   ├── minimax     (M2.7, ...)
│   ├── glm         (GLM-4-Plus, ...)
│   ├── siliconflow (多模型聚合: DeepSeek, Qwen, ...)
│   ├── qwen        (Qwen3, QwQ, ...)
│   ├── doubao      (Doubao-pro, ...)
│   ├── grok        (Grok-3, ...)
│   └── ollama      (本地模型, 无需 API Key)
└── 每个 Provider 定义:
    ├── id, name, type (openai|anthropic|google)
    ├── defaultBaseUrl, requiresApiKey
    ├── models[] → {id, name, contextWindow, outputWindow, capabilities}
    └── icon (public/logos/*)
```

### LangGraph 编排流程

```
lib/orchestration/director-graph.ts

┌─────────┐     ┌──────────┐     ┌─────────────────┐
│  START   │────▶│ Director │────▶│ Agent Generate  │
└─────────┘     └──────────┘     └─────────────────┘
                     ▲                     │
                     │    需要更多轮次?     │
                     └─────────────────────┘
                                           │
                                    完成?   ▼
                                        ┌──────┐
                                        │ END  │
                                        └──────┘

- Director: 决定下一个执行的 Agent (单 Agent 走代码逻辑, 多 Agent 走 LLM 决策)
- Agent Generate: 执行具体的 Agent 任务 (通过 Tool Schema 调用 Action)
- 流式输出: SSE 自定义 Stream Mode
```

### Agent Registry

```
lib/orchestration/registry/
├── types.ts  → AgentConfig, AgentTemplate 接口
└── store.ts  → Agent 注册表 Store (生成后持久化)
```

---

## 11. 课堂生成流水线

```
用户输入 (PDF + 文字需求)
        │
        ▼
┌─ 1. PDF 解析 ──────────────────┐
│   unpdf / MinerU / MinerU Cloud │
└────────────────┬────────────────┘
                 │
        ▼
┌─ 2. Web 搜索 (可选) ───────────┐
│   Tavily → 补充学术资料          │
└────────────────┬────────────────┘
                 │
        ▼
┌─ 3. 场景大纲生成 (SSE 流式) ───┐
│   /api/generate/scene-outlines   │
│   输出: 场景列表 + 语言指令       │
└────────────────┬────────────────┘
                 │
        ▼
┌─ 4. 场景内容生成 ──────────────┐
│   /api/generate/scene-content    │
│   为每个场景生成幻灯片/测验/互动   │
└────────────────┬────────────────┘
                 │
        ▼
┌─ 5. 场景动作生成 ──────────────┐
│   /api/generate/scene-actions    │
│   为每个场景生成语音/动画/指令     │
└────────────────┬────────────────┘
                 │
        ▼
┌─ 6. 多媒体生成 (并行) ────────┐
│   图片: Seedream/DALL-E/MiniMax  │
│   视频: Seedance/Kling/Veo/Sora │
│   TTS:  OpenAI/Azure/MiniMax/... │
└────────────────┬────────────────┘
                 │
        ▼
┌─ 7. Agent 角色生成 ───────────┐
│   /api/generate/agent-profiles   │
│   生成教师/助教/学生等角色配置     │
└────────────────┬────────────────┘
                 │
        ▼
    课堂就绪 → /classroom/[id]
```

### 关键代码位置

| 阶段 | 文件 |
|------|------|
| 流水线入口 | `lib/generation/pipeline-runner.ts` |
| 大纲生成 | `lib/generation/outline-generator.ts` |
| 场景构建 | `lib/generation/scene-builder.ts` / `scene-generator.ts` |
| Prompt 模板 | `lib/generation/prompts/` |
| JSON 修复 | `lib/generation/json-repair.ts` |
| 动作解析 | `lib/generation/action-parser.ts` |
| 后处理 | `lib/generation/interactive-post-processor.ts` |

---

## 12. 多模态能力

### TTS (文字转语音)

| Provider | ID | 说明 |
|----------|----|------|
| OpenAI TTS | `openai-tts` | 标准 & HD 语音 |
| Azure Speech | `azure-tts` | 丰富语种 |
| GLM (智谱) | `glm-tts` | 中文优化 |
| Qwen (通义) | `qwen-tts` | 阿里云 |
| Doubao (豆包) | `doubao-tts` | 字节跳动 |
| MiniMax | `minimax-tts` | speech-2.8 系列 |
| ElevenLabs | `elevenlabs-tts` | 高质量多语种 |
| Browser Native | `browser-native-tts` | 浏览器原生 (无需 API Key) |

### ASR (语音转文字)

| Provider | ID |
|----------|----|
| OpenAI Whisper | `openai-whisper` |
| Qwen ASR | `qwen-asr` |
| Browser Native | `browser-native` |

### Image Generation (图片生成)

| Provider | ID |
|----------|----|
| Seedream (字节) | `seedream` |
| Qwen Image | `qwen-image` |
| Nano Banana | `nano-banana` |
| MiniMax Image | `minimax-image` |
| Grok Image | `grok-image` |

### Video Generation (视频生成)

| Provider | ID |
|----------|----|
| Seedance (字节) | `seedance` |
| Kling (快手) | `kling` |
| Veo (Google) | `veo` |
| Sora (OpenAI) | `sora` |
| MiniMax Video | `minimax-video` |
| Grok Video | `grok-video` |

### PDF 解析

| Provider | ID | 说明 |
|----------|----|------|
| unpdf | `unpdf` | 轻量, 无需 API Key |
| MinerU (本地) | `mineru` | 高精度, 本地部署 |
| MinerU Cloud | `mineru-cloud` | 高精度, 云端 API |

---

## 13. 国际化 (i18n)

支持 **6 种语言**:

| 语言 | 文件 |
|------|------|
| 简体中文 | `lib/i18n/locales/zh-CN.json` |
| English | `lib/i18n/locales/en-US.json` |
| 日本語 | `lib/i18n/locales/ja-JP.json` |
| Русский | `lib/i18n/locales/ru-RU.json` |
| العربية | `lib/i18n/locales/ar-SA.json` |

翻译通过 `useI18n()` Hook 和 `t()` 函数调用。详见 `lib/i18n/TRANSLATION_GUIDE.md`。

---

## 14. 安全机制

| 机制 | 位置 | 说明 |
|------|------|------|
| **Access Code** | `middleware.ts` | HMAC-SHA256 令牌验证, Cookie 鉴权 |
| **SSRF 防护** | `lib/server/ssrf-guard.ts` | 阻止 localhost/内网 URL 请求 |
| **CSP 头** | `next.config.ts` | `X-Frame-Options: SAMEORIGIN` + 可配置 `frame-ancestors` |
| **API 鉴权** | `middleware.ts` | 所有 API 路由 (除 `/api/access-code/*`, `/api/health`) 受保护 |
| **Provider 验证** | `lib/store/settings-validation.ts` | 确保 Provider 凭证有效后才允许使用 |
| **请求限制** | `next.config.ts` | 请求体最大 200MB |
| **安全响应** | `SECURITY.md` | 48 小时漏洞响应, GitHub Private Vulnerability Reporting |

---

## 15. 测试体系

### 单元测试 (Vitest)

```
tests/
├── setup-env.ts                          # 测试环境初始化
├── ai/minimax-provider.test.ts           # AI Provider
├── audio/minimax-tts-models.test.ts      # TTS 模型
├── export/classroom-zip.test.ts          # ZIP 导出
├── generation/outline-language.eval.test.ts  # 生成质量评估
├── server/
│   ├── classroom-agent-mode.test.ts      # Agent 模式
│   ├── provider-config.test.ts           # Provider 配置
│   ├── security-headers.test.ts          # 安全头
│   └── ssrf-guard.test.ts               # SSRF 防护
└── settings/
    ├── custom-provider-baseurl.test.ts   # 自定义 Provider URL
    ├── settings-server-sync.test.ts      # 设置同步
    └── settings-validation.test.ts       # 设置校验
```

### E2E 测试 (Playwright)

```
e2e/
├── fixtures/                              # 测试数据
├── pages/                                 # Page Object Model
│   ├── home.page.ts
│   ├── classroom.page.ts
│   └── generation-preview.page.ts
└── tests/
    ├── full-happy-path.spec.ts           # 完整用户旅程
    ├── home-to-generation.spec.ts        # 首页 → 生成
    ├── generation-flow.spec.ts           # 生成流程
    └── classroom-interaction.spec.ts     # 课堂交互
```

**配置**: Chromium 浏览器, CI 中 2 次重试, 失败时截图 + trace。

---

## 16. 部署与基础设施

### Docker 部署

```yaml
# docker-compose.yml
services:
  openmaic:
    build: .
    ports: ["3000:3000"]
    volumes: [openmaic-data:/data]
    env_file: .env.local
    restart: unless-stopped
```

**Dockerfile 多阶段构建:**
1. **base**: node:22-alpine + pnpm
2. **deps**: 安装 pnpm 依赖 (含 python3, cairo, pango 等原生构建依赖)
3. **builder**: `next build` (standalone 输出)
4. **runner**: 最小运行镜像, 非 root 用户 (nextjs)

### Vercel 部署

```json
{
  "framework": "nextjs",
  "functions": { "app/api/**/*.ts": { "maxDuration": 300 } }
}
```

### 环境变量

通过 `.env` / `.env.local` 配置, 支持:
- 10+ LLM Provider 的 API Key / Base URL / Models
- 7 种 TTS Provider
- 3 种 ASR Provider
- 3 种 PDF Provider
- 5 种 Image 和 6 种 Video Provider
- Web Search (Tavily)
- ACCESS_CODE 认证
- Ollama 本地模型

---

## 17. 数据流总览

```
┌──────────────────────────────────────────────────────────┐
│                        客户端                             │
│                                                          │
│  ┌─────────┐   ┌──────────┐   ┌───────────────────────┐ │
│  │ Zustand  │   │  Dexie   │   │     React 组件树      │ │
│  │ Stores   │◀─▶│ IndexedDB│   │  (Stage/Chat/Canvas)  │ │
│  └────┬─────┘   └──────────┘   └───────────┬───────────┘ │
│       │                                     │             │
│       │        SSE / fetch / WebSocket      │             │
└───────┼─────────────────────────────────────┼─────────────┘
        │                                     │
        ▼                                     ▼
┌──────────────────────────────────────────────────────────┐
│                     Next.js API 层                        │
│                                                          │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐ │
│  │ middleware   │  │ API Routes   │  │ Server Actions  │ │
│  │ (Auth)      │  │ (app/api/)   │  │ (lib/server/)   │ │
│  └─────────────┘  └──────┬───────┘  └────────┬────────┘ │
│                          │                    │          │
└──────────────────────────┼────────────────────┼──────────┘
                           │                    │
                           ▼                    ▼
┌──────────────────────────────────────────────────────────┐
│                    外部服务层                              │
│                                                          │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌───────┐ │
│  │  LLM   │ │  TTS   │ │ Image  │ │ Video  │ │  PDF  │ │
│  │Providers│ │Providers│ │  Gen  │ │  Gen   │ │Parser │ │
│  └────────┘ └────────┘ └────────┘ └────────┘ └───────┘ │
│                                                          │
│  ┌────────┐ ┌────────┐ ┌────────┐                       │
│  │  ASR   │ │Tavily  │ │ Ollama │                       │
│  │Providers│ │Search  │ │(Local) │                       │
│  └────────┘ └────────┘ └────────┘                       │
└──────────────────────────────────────────────────────────┘
```

---

*文档生成时间: 2026-04-17 | 基于项目版本 v0.1.1*
