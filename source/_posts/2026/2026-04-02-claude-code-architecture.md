---
title: Claude Code 源码深度解析：一个 AI 编程 CLI 的完整架构拆解
date: 2026-04-02 18:00:00
updated: 2026-04-02 20:00:00
tags:
  - 源码分析
  - AI
  - CLI
  - TypeScript
  - 架构设计
categories:
  - 技术研究
keywords: Claude Code, 源码分析, AI CLI, TypeScript, 多智能体, MCP, Tool System
description: 通过对 Claude Code CLI 泄露源码的逐层解析，深入理解一个生产级 AI 驱动命令行工具的完整架构——从启动优化、工具系统、权限模型，到多智能体协调与 IDE 桥接。
cover: /2026/04/02/claude-code-architecture/cover.png
permalink: /2026/04/02/claude-code-architecture/
---

2026 年 3 月 31 日，Anthropic 在 npm 发布包中意外暴露了 `.map` 文件，使 Claude Code CLI 的完整 TypeScript 源码得以公开。这份快照让我们第一次得以从源码层面审视一个生产级 AI 驱动命令行工具的内部构造。

本文是对这份源码的系统性分析，覆盖启动链路、核心对话循环、工具系统、权限模型、多智能体架构、IDE 桥接，以及 Bun 构建时死代码剥离机制。

> **免责声明**：本文仅用于教育目的与供应链安全研究，不涉及任何恶意用途。

<!-- more -->

---

## 一、项目全貌

### 技术栈

| 层次 | 技术选型 |
|------|----------|
| 运行时 | Bun |
| 语言 | TypeScript（strict 模式） |
| 终端 UI | React + [Ink](https://github.com/vadimdemedes/ink) |
| CLI 解析 | Commander.js |
| Schema 验证 | Zod v4 |
| 代码搜索 | ripgrep |
| Lint | Biome |
| Feature Flags / A-B | GrowthBook |
| 协议 | MCP（Model Context Protocol）、LSP |
| 遥测 | OpenTelemetry + gRPC（懒加载） |

### 顶层目录结构

```
src/
├── main.tsx              # CLI 入口（4683 行）
├── QueryEngine.ts        # 会话生命周期（1295 行）
├── query.ts              # 对话循环核心（1729 行）
├── Tool.ts               # 工具基础类型（792 行）
├── tools.ts              # 工具注册表（389 行）
├── commands.ts           # 斜杠命令注册表
├── context.ts            # 上下文收集
├── tools/                # 每个工具的独立模块目录
├── commands/             # 每个斜杠命令的实现
├── services/             # 服务层（API、MCP、LSP、OAuth…）
├── components/           # ~140 个 Ink React 组件
├── hooks/                # React Hooks + 权限系统
├── bridge/               # IDE 扩展桥接层
├── coordinator/          # 多智能体协调器
├── skills/               # 可复用 Skill 工作流
├── state/                # 全局状态（AppState）
├── entrypoints/          # SDK / CLI 入口点
└── utils/                # 工具函数
```

---

## 二、启动链路与性能优化

### 2.1 入口文件 `src/main.tsx`（4683 行）

这是整个 CLI 最重要的文件。它的开头有一段注释，直接说明了为什么某些 `import` 必须排在最前面：

```typescript
// 1. profileCheckpoint 在模块加载开始前打时间戳
// 2. startMdmRawRead 启动 MDM 子进程（plutil/reg query），让它与后续
//    135ms 的模块加载并行运行
// 3. startKeychainPrefetch 并行触发两次 macOS keychain 读取（OAuth + 旧版
//    API key），否则 applySafeConfigEnvironmentVariables() 会顺序 spawn
//    同步调用（macOS 每次启动额外 ~65ms）

import { profileCheckpoint } from './utils/startupProfiler.js';
profileCheckpoint('main_tsx_entry');

import { startMdmRawRead } from './utils/settings/mdm/rawRead.js';
startMdmRawRead();  // 立即触发，不等待结果

import { startKeychainPrefetch } from './utils/secureStorage/keychainPrefetch.js';
startKeychainPrefetch();  // 同上
```

**关键设计思路**：在 Node/Bun 进行模块图解析（约 135ms）的同时，把几个必须走 IPC/系统调用的耗时操作并行发射出去。等业务逻辑真正需要这些数据时，它们已经准备好了。这是一个将 **IO 延迟与 CPU 工作并行化** 的经典技巧。

### 2.2 Commander.js 命令树

`main.tsx` 用 Commander.js 构建了完整的 CLI 命令树。顶层命令对应 `claude` 本身（交互式 REPL），子命令如 `claude doctor`、`claude config`、`claude mcp` 等都有独立实现。

### 2.3 React/Ink 渲染器

交互式 REPL 模式下，整个 TUI 是一棵 React 组件树，通过 Ink 渲染到终端。`src/interactiveHelpers.tsx` 中的 `renderAndRun()` 负责挂载根组件，`src/components/App.tsx` 是主 Shell。

---

## 三、核心对话循环

Claude Code 的核心是一个 **流式工具调用循环**，分布在三个文件中：

```
用户输入
  ↓
query.ts（processUserInput → ask）
  ↓ 调用 Anthropic API，流式接收
QueryEngine.ts（会话状态管理）
  ↓ 发现 tool_use 块
Tool 分发 → call() 执行 → 结果追加到消息队列
  ↓ 无更多工具调用时停止
返回最终 assistant 消息
```

### 3.1 `query.ts`（1729 行）——对话循环底层

这是实际发出 API 请求、处理流事件的地方。关键逻辑：

- **流式解析**：逐个处理 `content_block_start` / `content_block_delta` / `content_block_stop` 事件，在流中实时更新 UI
- **tool_use 分发**：每收到一个完整的 `tool_use` 块，就调用对应工具的 `call()` 方法，把结果包装成 `tool_result` 消息，塞回队列继续下一轮
- **上下文压缩**：当消息历史超过 token 阈值时，通过 `services/compact/` 触发自动压缩（`autoCompact`），支持 `REACTIVE_COMPACT`、`CONTEXT_COLLAPSE`、`HISTORY_SNIP` 等多种策略，均通过 feature flag 控制
- **Thinking 模式**：透传 `thinkingConfig` 给 API，支持 extended thinking
- **重试逻辑**：`services/api/withRetry.ts` 封装了带指数退避的重试，`FallbackTriggeredError` 用于在主模型失败时切换 fallback 模型

```typescript
// query.ts 中的关键流处理伪代码
for await (const event of stream) {
  if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
    // 开始收集工具调用参数
  }
  if (event.type === 'content_block_stop') {
    // 工具调用参数收集完毕，分发执行
    const result = await dispatchTool(toolUseBlock, context)
    messages.push(createToolResultMessage(result))
    // 继续下一轮 API 请求
  }
}
```

### 3.2 `QueryEngine.ts`（1295 行）——会话生命周期

`QueryEngine` 是一个类，持有会话级别的状态，被 SDK 路径（headless）和 REPL 路径共用。**一个 QueryEngine 实例对应一个完整会话**，每次 `submitMessage()` 调用开启新的 Turn，消息历史、文件缓存、用量统计等**跨 Turn 持久化**。

**类的私有字段**（揭示了会话状态的全部组成）：

```typescript
class QueryEngine {
  private config: QueryEngineConfig
  private mutableMessages: Message[]            // 完整消息历史
  private abortController: AbortController      // 用于中断当前 Turn
  private permissionDenials: SDKPermissionDenial[]  // 收集权限拒绝记录（SDK 模式用）
  private totalUsage: NonNullableUsage          // 累计 token 用量
  private hasHandledOrphanedPermission = false  // 孤儿权限处理标记
  private readFileState: FileStateCache         // 文件读取状态缓存
  private discoveredSkillNames = new Set<string>()     // 动态发现的 Skill
  private loadedNestedMemoryPaths = new Set<string>()  // 已加载的嵌套 Memory 路径
}
```

**submitMessage 方法签名**：

```typescript
async *submitMessage(
  prompt: string | ContentBlockParam[],
  options?: { uuid?: string; isMeta?: boolean },
): AsyncGenerator<SDKMessage, void, unknown>
```

返回值是一个 `AsyncGenerator`，每次 `yield` 一条 SDK 消息（文本流片段、工具调用、工具结果等），调用方通过 `for await` 实时消费。

**多层 System Prompt 拼装**（`asSystemPrompt` 把多段合并为一个数组）：

```typescript
const systemPrompt = asSystemPrompt([
  // 默认系统提示，或用户自定义提示
  ...(customPrompt !== undefined ? [customPrompt] : defaultSystemPrompt),
  // Memory 文件注入的记忆机制说明
  ...(memoryMechanicsPrompt ? [memoryMechanicsPrompt] : []),
  // 用户追加的额外提示（通过 --append-system-prompt 传入）
  ...(appendSystemPrompt ? [appendSystemPrompt] : []),
])
```

**权限拦截包装**（`wrappedCanUseTool` 在真实权限检查之上叠加一层 denial 追踪，供 SDK 层汇报）：

```typescript
const wrappedCanUseTool: CanUseToolFn = async (
  tool, input, toolUseContext, assistantMessage, toolUseID, forceDecision,
) => {
  const result = await canUseTool(tool, input, toolUseContext, assistantMessage, toolUseID, forceDecision)
  // 非 allow 时记录 denial，SDK 消费端可以知道哪些工具调用被拒绝了
  if (result.behavior !== 'allow') {
    this.permissionDenials.push({
      tool_name: sdkCompatToolName(tool.name),
      tool_use_id: toolUseID,
      tool_input: input,
    })
  }
  return result
}
```

它的构造参数 `QueryEngineConfig` 同样非常值得细读：

```typescript
export type QueryEngineConfig = {
  cwd: string
  tools: Tools
  commands: Command[]
  mcpClients: MCPServerConnection[]
  agents: AgentDefinition[]
  canUseTool: CanUseToolFn          // 权限检查函数
  getAppState: () => AppState
  setAppState: (f: (prev: AppState) => AppState) => void
  initialMessages?: Message[]
  readFileCache: FileStateCache      // 文件状态缓存（用于 diff/history）
  customSystemPrompt?: string
  thinkingConfig?: ThinkingConfig
  maxTurns?: number
  maxBudgetUsd?: number
  snipReplay?: (msg, store) => ...   // HISTORY_SNIP 特性注入点
  // ...
}
```

### 3.3 `query.ts` 内部的循环状态机

`query.ts` 的主循环维护一个可变的 `State` 对象，在每轮迭代之间传递：

```typescript
type State = {
  messages: Message[]
  toolUseContext: ToolUseContext
  autoCompactTracking: AutoCompactTrackingState | undefined
  maxOutputTokensRecoveryCount: number  // max_output_tokens 错误恢复计数
  hasAttemptedReactiveCompact: boolean
  maxOutputTokensOverride: number | undefined
  pendingToolUseSummary: Promise<ToolUseSummaryMessage | null> | undefined
  stopHookActive: boolean | undefined
  turnCount: number                    // 本轮对话已用 Turn 数
  transition: Continue | undefined     // 上一次迭代为何继续循环
}
```

**工具结果缺失时的错误恢复**——当某个 `tool_use` 块没有收到对应的 `tool_result` 时（比如因为网络中断），`yieldMissingToolResultBlocks` 会补充错误消息，保证消息序列合法：

```typescript
function* yieldMissingToolResultBlocks(
  assistantMessages: AssistantMessage[],
  errorMessage: string,
) {
  for (const assistantMessage of assistantMessages) {
    const toolUseBlocks = assistantMessage.message.content
      .filter(c => c.type === 'tool_use') as ToolUseBlock[]

    for (const toolUse of toolUseBlocks) {
      yield createUserMessage({
        content: [{
          type: 'tool_result',
          content: errorMessage,
          is_error: true,
          tool_use_id: toolUse.id,
        }],
        toolUseResult: errorMessage,
        sourceToolAssistantUUID: assistantMessage.uuid,
      })
    }
  }
}
```

---

## 四、工具系统

工具系统是 Claude Code 最核心的设计，也是它与普通聊天 AI 的本质区别。

### 4.1 工具基础接口 `Tool.ts`（792 行）

`Tool.ts` 定义了完整的工具契约。每个工具通过 `buildTool` 工厂函数创建，工厂会补全所有有默认值的方法：

```typescript
export type Tool<
  Input extends AnyObject = AnyObject,
  Output = unknown,
  P extends ToolProgressData = ToolProgressData,
> = {
  readonly name: string
  aliases?: string[]            // 工具别名（用于向后兼容重命名）
  searchHint?: string           // 在 ToolSearchTool 中的搜索提示

  // ── 核心执行 ──────────────────────────────────────────────
  call(
    args: z.infer<Input>,
    context: ToolUseContext,
    canUseTool: CanUseToolFn,
    parentMessage: AssistantMessage,
    onProgress?: ToolCallProgress<P>,
  ): Promise<ToolResult<Output>>

  description(input, options): Promise<string>    // 动态描述（发给 Claude 的）

  // ── Schema ───────────────────────────────────────────────
  readonly inputSchema: Input                     // Zod schema（双用途：验证 + 类型推断）
  readonly inputJSONSchema?: ToolInputJSONSchema  // 手动覆盖的 JSON Schema
  outputSchema?: z.ZodType<unknown>

  // ── 行为控制标记 ─────────────────────────────────────────
  isConcurrencySafe(input): boolean     // false = 不允许与其他工具并行执行（默认 false，fail-closed）
  isEnabled(): boolean                  // 当前是否可用（默认 true）
  isReadOnly(input): boolean            // Plan 模式下只有此方法返回 true 的工具才被允许
  isDestructive?(input): boolean        // 标记破坏性操作（用于 UI 警告）
  interruptBehavior?(): 'cancel' | 'block'  // 用户按 Ctrl+C 时：cancel=取消工具, block=等待完成

  // ── UI 折叠提示 ──────────────────────────────────────────
  isSearchOrReadCommand?(input): {
    isSearch: boolean   // 折叠为"搜索了 N 次"
    isRead: boolean     // 折叠为"读取了 N 个文件"
    isList?: boolean    // 折叠为"列举了 N 个目录"
  }

  // ── 验证与权限 ────────────────────────────────────────────
  validateInput?(input, context): Promise<ValidationResult>  // API 调用前的参数合法性校验
  checkPermissions?(input, context?): Promise<PermissionResult>

  // ── 延迟加载 ─────────────────────────────────────────────
  readonly shouldDefer?: boolean    // true = 此工具延迟加载（不在首次列表中）
  readonly alwaysLoad?: boolean     // true = 即便在延迟模式下也始终加载

  // ── 结果限制 ─────────────────────────────────────────────
  maxResultSizeChars: number        // 超过此长度的结果会被截断后存储到磁盘

  // ── MCP / LSP 标记 ───────────────────────────────────────
  isMcp?: boolean
  isLsp?: boolean
  mcpInfo?: { serverName: string; toolName: string }
  readonly strict?: boolean
}
```

**`buildTool` 工厂与 Fail-Closed 默认值**

不是所有方法都必须实现——`buildTool` 提供了一组安全的默认值：

```typescript
// 这些方法有默认实现，ToolDef 中可以不写
type DefaultableToolKeys =
  | 'isEnabled'         // 默认 true
  | 'isConcurrencySafe' // 默认 false（fail-closed：不确定就不并行）
  | 'isReadOnly'        // 默认 false（不确定就视为写操作）
  | 'isDestructive'     // 默认 false
  | 'checkPermissions'  // 默认 allow（执行层面的兜底）

const TOOL_DEFAULTS = {
  isEnabled: () => true,
  isConcurrencySafe: (_input?) => false,
  isReadOnly: (_input?) => false,
  isDestructive: (_input?) => false,
  checkPermissions: (input, _ctx?) =>
    Promise.resolve({ behavior: 'allow', updatedInput: input }),
  userFacingName: (_input?) => '',
}

export function buildTool<D extends AnyToolDef>(def: D): BuiltTool<D> {
  return { ...TOOL_DEFAULTS, userFacingName: () => def.name, ...def } as BuiltTool<D>
}
```

这个设计的安全哲学是：**对于权限和并发，默认选择限制最严格的那个**——`checkPermissions` 默认 `allow` 是因为实际权限检查在更上层的 `canUseTool` 中进行；`isConcurrencySafe` 默认 `false` 则是防止新工具未经评估就被并行调用。

`inputSchema` 用 Zod 定义后，会被自动序列化为 JSON Schema 发给 Claude API，这样 Claude 就"知道"每个工具接受什么参数。

### 4.2 工具注册表 `tools.ts`（389 行）

`tools.ts` 是所有工具的汇总注册点。有三种注册方式：

**1. 静态导入（始终启用）**
```typescript
import { BashTool } from './tools/BashTool/BashTool.js'
import { FileEditTool } from './tools/FileEditTool/FileEditTool.js'
import { GlobTool } from './tools/GlobTool/GlobTool.js'
// ...
```

**2. 环境变量条件导入（内部员工工具）**
```typescript
const REPLTool = process.env.USER_TYPE === 'ant'
  ? require('./tools/REPLTool/REPLTool.js').REPLTool
  : null
```

**3. Feature Flag 条件导入（构建时死代码剥离）**
```typescript
const SleepTool = feature('PROACTIVE') || feature('KAIROS')
  ? require('./tools/SleepTool/SleepTool.js').SleepTool
  : null

const cronTools = feature('AGENT_TRIGGERS')
  ? [ CronCreateTool, CronDeleteTool, CronListTool ]
  : []
```

### 4.3 工具清单

| 工具 | 目录 | 核心功能 |
|------|------|----------|
| `BashTool` | `BashTool/` | Shell 命令执行，支持超时、沙箱、后台任务 |
| `FileReadTool` | `FileReadTool/` | 读取文件、图片、PDF、Jupyter Notebook |
| `FileEditTool` | `FileEditTool/` | 精确字符串替换式编辑（非全量覆写） |
| `FileWriteTool` | `FileWriteTool/` | 全量写入文件 |
| `GlobTool` | `GlobTool/` | 文件名模式匹配（ripgrep 支撑） |
| `GrepTool` | `GrepTool/` | 文件内容搜索（ripgrep 支撑） |
| `AgentTool` | `AgentTool/` | 派生子 Agent，支持颜色标识、记忆、恢复 |
| `SkillTool` | `SkillTool/` | 执行可复用 Skill 工作流 |
| `MCPTool` | `MCPTool/` | 调用 MCP 服务器的工具 |
| `LSPTool` | `LSPTool/` | Language Server Protocol 集成 |
| `WebFetchTool` | `WebFetchTool/` | 网页抓取 |
| `WebSearchTool` | `WebSearchTool/` | 网络搜索 |
| `TodoWriteTool` | `TodoWriteTool/` | 任务列表管理 |
| `TaskCreateTool` | `TaskCreateTool/` | 创建并追踪后台任务 |
| `TaskOutputTool` | `TaskOutputTool/` | 获取任务输出 |
| `TaskStopTool` | `TaskStopTool/` | 终止任务 |
| `SendMessageTool` | `SendMessageTool/` | 向其他 Agent 发送消息 |
| `TeamCreateTool` | `TeamCreateTool/` | 创建 Agent 团队 |
| `TeamDeleteTool` | `TeamDeleteTool/` | 删除 Agent 团队 |
| `EnterPlanModeTool` | `EnterPlanModeTool/` | 进入 Plan 模式（只规划不执行） |
| `ExitPlanModeTool` | `ExitPlanModeTool/` | 退出 Plan 模式 |
| `EnterWorktreeTool` | `EnterWorktreeTool/` | 进入 Git Worktree 隔离环境 |
| `ExitWorktreeTool` | `ExitWorktreeTool/` | 退出 Worktree 环境 |
| `AskUserQuestionTool` | `AskUserQuestionTool/` | 向用户提问（中断等待输入） |
| `ScheduleCronTool` | `ScheduleCronTool/` | 定时触发（AGENT_TRIGGERS flag） |
| `RemoteTriggerTool` | `RemoteTriggerTool/` | 远程执行触发 |
| `NotebookEditTool` | `NotebookEditTool/` | Jupyter Notebook 编辑 |
| `ListMcpResourcesTool` | `ListMcpResourcesTool/` | 列举 MCP 资源 |
| `ReadMcpResourceTool` | `ReadMcpResourceTool/` | 读取 MCP 资源 |
| `ToolSearchTool` | `ToolSearchTool/` | 搜索可用工具（延迟加载） |
| `BriefTool` | `BriefTool/` | 生成简报 |
| `SleepTool` | `SleepTool/` | 睡眠等待（PROACTIVE/KAIROS flag） |
| `MonitorTool` | `MonitorTool/` | 监控工具（MONITOR_TOOL flag） |

### 4.4 `BashTool` 细节（代表性分析）

`BashTool.tsx` 约 800+ 行，其中有很多值得学习的细节：

**命令语义分类**：对执行的命令进行语义分类，用于 UI 展示折叠提示（"读取了 N 个文件"、"列举了 N 个目录"等）：

```typescript
// 搜索类命令（grep、find 等）
const BASH_SEARCH_COMMANDS = new Set(['find','grep','rg','ag','ack','locate','which','whereis'])
// 读取类命令（cat、head 等）
const BASH_READ_COMMANDS = new Set(['cat','head','tail','less','more','wc','stat','file','jq','awk','cut','sort','uniq','tr'])
// 目录列举类
const BASH_LIST_COMMANDS = new Set(['ls','tree','du'])
// 语义中性（不影响整体判断）
const BASH_SEMANTIC_NEUTRAL_COMMANDS = new Set(['echo','printf','true','false',':'])
```

**安全解析**：`utils/bash/ast.ts` 中的 `parseForSecurity()` 对命令进行 AST 级解析，检测潜在危险操作。`bashPermissions.ts` 中有通配符规则匹配和命令前缀提取，用于权限规则的精细控制。

**沙箱支持**：`SandboxManager` (`utils/sandbox/sandbox-adapter.ts`) 提供可选的沙箱执行，通过 `shouldUseSandbox.ts` 判断当前命令是否应该沙箱化。

**后台任务**：`tasks/LocalShellTask/LocalShellTask.ts` 实现了后台 Shell 任务管理——可以将前台任务转到后台运行（`backgroundExistingForegroundTask`），或从后台拉回前台（`registerForeground`）。

**Assistant 模式的特殊行为**：当 `KAIROS` feature 开启时（即 assistant/proactive 模式），阻塞式 bash 在主 Agent 中运行超过 `ASSISTANT_BLOCKING_BUDGET_MS = 15_000ms` 后会自动转为后台任务。

---

## 五、斜杠命令系统

### 5.1 注册表 `commands.ts`

斜杠命令（`/clear`、`/commit` 等）与工具系统并列，但走不同的处理路径。`commands.ts` 导入了约 50 个命令实现：

```typescript
import clear from './commands/clear/index.js'
import commit from './commands/commit.js'
import compact from './commands/compact/index.js'
import config from './commands/config/index.js'
import review from './commands/review.js'
import memory from './commands/memory/index.js'
import mcp from './commands/mcp/index.js'
import skills from './commands/skills/index.js'
import teleport from './commands/teleport/index.js'
// ... 约 50 个命令
```

同样有 feature flag 条件导入，Anthropic 内部员工（`USER_TYPE === 'ant'`）可用 `agents-platform` 命令等额外工具。

### 5.2 命令分类

| 类别 | 命令示例 |
|------|----------|
| 会话管理 | `/clear`, `/compact`, `/resume`, `/session` |
| 代码操作 | `/commit`, `/commit-push-pr`, `/autofix-pr`, `/review`, `/security-review` |
| 配置 | `/config`, `/login`, `/logout`, `/theme`, `/vim` |
| 集成 | `/mcp`, `/ide`, `/desktop`, `/teleport` |
| 调试 | `/doctor`, `/cost`, `/status`, `/context`, `/diff` |
| Agent | `/skills`, `/tasks`, `/memory` |
| 其他 | `/help`, `/init`, `/keybindings`, `/share` |

---

## 六、权限系统

### 6.1 架构

权限系统集中在 `src/hooks/toolPermission/`，每次工具调用都必须经过权限检查。

```
工具调用请求
    ↓
PermissionContext.ts（上下文聚合）
    ↓
handlers/（根据运行模式分发）
  ├── interactiveHandler.ts     → 交互模式（询问用户）
  ├── coordinatorHandler.ts     → 多智能体协调器模式
  └── swarmWorkerHandler.ts     → Swarm Worker 模式
    ↓
返回 PermissionResult（allow / deny / ask）
```

### 6.2 权限模式

| 模式 | 说明 |
|------|------|
| `default` | 正常交互，危险操作需用户确认 |
| `plan` | 只规划，不执行任何写操作 |
| `bypassPermissions` | 绕过所有权限检查（需明确授权） |
| `auto` | 自动批准，用于无人值守场景 |

### 6.3 PermissionContext 的核心类型

`PermissionContext.ts` 对"谁批准了这次操作"和"谁拒绝了这次操作"做了精确建模：

```typescript
// 批准来源
type PermissionApprovalSource =
  | { type: 'hook'; permanent?: boolean }   // 由配置 hook 自动批准
  | { type: 'user'; permanent: boolean }    // 用户手动批准（permanent=true 表示记住选择）
  | { type: 'classifier' }                  // 由自动分类器批准

// 拒绝来源
type PermissionRejectionSource =
  | { type: 'hook' }                        // hook 规则拒绝
  | { type: 'user_abort' }                  // 用户中止（Ctrl+C）
  | { type: 'user_reject'; hasFeedback: boolean }  // 用户明确拒绝（可附带文字反馈）
```

### 6.4 竞态安全的 ResolveOnce 模式

权限弹窗是异步的，可能同时有多个路径（hook、分类器、用户点击）触发 resolve。`ResolveOnce` 通过闭包实现原子性的 `claim()` 方法，确保同一个 Promise 只被 resolve 一次：

```typescript
type ResolveOnce<T> = {
  resolve(value: T): void
  isResolved(): boolean
  claim(): boolean  // 原子检查-标记，返回 false 则表示已被其他路径抢先
}

function createResolveOnce<T>(resolve: (value: T) => void): ResolveOnce<T> {
  let claimed = false
  let delivered = false
  return {
    resolve(value: T) {
      if (delivered) return
      delivered = true
      resolve(value)
    },
    isResolved: () => delivered,
    claim(): boolean {
      if (claimed) return false
      claimed = true
      return true
    }
  }
}
```

使用方式：每个异步路径调用 `claim()` 前先竞争，只有抢到 `true` 的路径才能继续 resolve，其他路径直接放弃。这避免了 hook 和用户点击同时触发时的双重 resolve。

### 6.5 权限队列 UI 接口

```typescript
type PermissionQueueOps = {
  push(item: ToolUseConfirm): void      // 推入待确认项（显示弹窗）
  remove(toolUseID: string): void       // 移除（用户已处理）
  update(toolUseID: string, patch: Partial<ToolUseConfirm>): void  // 更新状态
}
```

这个接口连接权限逻辑层与 React UI 层——权限系统把待确认事项推入队列，UI 组件订阅队列变化渲染弹窗，用户操作后通过 `remove/update` 反馈结果。

### 6.6 BashTool 权限规则

`bashPermissions.ts` 实现了一套规则系统：
- **路径前缀匹配**：允许或拒绝特定目录下的命令
- **通配符规则**：`matchWildcardPattern()` 支持 glob 式的命令匹配
- **cd 检测**：`commandHasAnyCd()` 检测命令中是否包含目录切换，因为这会改变后续命令的执行上下文

---

## 七、Bridge 系统（IDE 扩展桥接）

`src/bridge/` 包含约 30 个文件，实现了与 VS Code、JetBrains 等 IDE 扩展的双向通信。

### 7.1 核心文件

| 文件 | 职责 |
|------|------|
| `bridgeMain.ts` | Bridge 主入口，协调整个桥接流程 |
| `replBridge.ts` | REPL 会话桥接 |
| `bridgeMessaging.ts` | 消息收发协议 |
| `bridgeApi.ts` | Bridge API 接口定义 |
| `jwtUtils.ts` | JWT 身份验证 |
| `trustedDevice.ts` | 设备信任管理 |
| `sessionRunner.ts` | 会话执行管理 |
| `inboundMessages.ts` / `inboundAttachments.ts` | 入站消息/附件处理 |
| `remoteBridgeCore.ts` | 远程桥接核心 |
| `pollConfig.ts` | 轮询配置同步 |
| `workSecret.ts` | 工作密钥管理 |

### 7.2 工作原理

Bridge 系统使用 **JWT 身份验证**，通过双向通信信道让 IDE 扩展可以：
- 向 Claude Code 发送代码选区、文件上下文
- 接收 Claude Code 的编辑建议并直接应用到编辑器
- 同步配置状态
- 在 IDE 内嵌面板中显示对话界面

BRIDGE_MODE feature flag 控制整个 bridge 子系统的编译进入，非 IDE 模式下这部分代码会被 Bun bundler 完全剥除。

---

## 八、多智能体系统

这是 Claude Code 架构中最复杂、也最有前瞻性的部分。

### 8.1 三种并行机制

```
多智能体并行
  ├── AgentTool（单个子 Agent 派生）
  ├── TeamCreateTool（Agent 团队，协调型并行）
  └── coordinator/（Coordinator 模式，全局调度）
```

### 8.2 AgentTool（`tools/AgentTool/`）

最基础的多智能体机制。主 Agent 可以通过 `AgentTool` 派生一个完全独立的子 Agent：

- `AgentTool.tsx`：入口，负责创建子 Agent 实例
- `runAgent.ts`：子 Agent 执行循环（复用 query.ts 的核心逻辑）
- `forkSubagent.ts`：从父 Agent 中 fork 出子 Agent
- `agentColorManager.ts`：为每个 Agent 分配不同颜色，在 TUI 中区分显示
- `agentMemory.ts` / `agentMemorySnapshot.ts`：Agent 记忆管理，支持跨会话持久化
- `loadAgentsDir.ts`：从 `.claude/agents/` 目录加载自定义 Agent 定义（`AgentDefinition`）
- `built-in/`：内置 Agent 定义（如 Plan Agent、Explore Agent 等）

子 Agent 拥有完整独立的工具集、消息历史和上下文，与主 Agent 通过 `SendMessageTool` 通信。

**AgentTool 内的时间阈值常量**（控制后台化行为）：

```typescript
// 2秒后开始显示"后台任务进行中"提示
const PROGRESS_THRESHOLD_MS = 2000

// KAIROS 模式下，主 Agent 中的阻塞式 Agent 超过 15 秒自动转后台
const ASSISTANT_BLOCKING_BUDGET_MS = 15_000

// 环境变量可完全禁用后台任务（调试用）
const isBackgroundTasksDisabled =
  isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS)

// 动态决定自动后台化阈值（0 = 不自动后台化）
function getAutoBackgroundMs(): number {
  if (
    isEnvTruthy(process.env.CLAUDE_AUTO_BACKGROUND_TASKS) ||
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_auto_background_agents', false)
  ) {
    return 120_000  // 2 分钟后自动转后台（由 feature flag 或环境变量启用）
  }
  return 0
}
```

**远程 Agent 支持**：AgentTool 不只能在本地 fork 子 Agent，还支持远程执行（`checkRemoteAgentEligibility` 判断是否符合条件，`registerRemoteAgentTask` 注册远程任务，进度通过回调异步推送）。这是 Claude Code 云端化/分布式化的基础设施。

### 8.3 Swarm / Team 系统

```typescript
// TeamCreateTool 创建一组协作 Agent
// SendMessageTool 实现 Agent 间消息传递
// swarmWorkerHandler 处理 Swarm 模式下的权限
```

`src/utils/swarm/` 目录包含：
- `backends/teammateModeSnapshot.ts`：Swarm 状态快照
- `reconnection.ts`：Swarm 重连逻辑
- `teammatePromptAddendum.ts`：为 Swarm 成员注入额外上下文

### 8.4 Coordinator 模式（`src/coordinator/`）

`coordinatorMode.ts` 实现了一个全局协调器，在 `COORDINATOR_MODE` feature flag 启用时生效。协调器负责：
- 将大任务分解并分配给多个 Worker Agent
- 聚合 Worker 的结果
- 维护全局进度视图（`CoordinatorAgentStatus.tsx` 组件）

`handlers/coordinatorHandler.ts` 是协调器模式下专用的权限处理器，与普通交互模式的权限逻辑不同——Worker Agent 的操作由协调器统一授权，无需逐一询问用户。

### 8.5 Skills 系统（`src/skills/`）

Skills 是可复用的工作流定义，类似"宏"或"剧本"：

```
skills/
├── bundled/          # 内置 Skill 定义
├── bundledSkills.ts  # 内置 Skill 注册
├── loadSkillsDir.ts  # 从 .claude/skills/ 加载自定义 Skill
└── mcpSkillBuilders.ts # 从 MCP 服务器构建 Skill
```

`SkillTool` 执行时会把 Skill 的定义注入到 prompt 中，引导 Agent 按照预定义的步骤工作。用户可以通过 `/skills` 命令管理 Skill，也可以在 `.claude/skills/` 目录中定义自己的 Skill。

---

## 九、服务层（`src/services/`）

### 9.1 API 服务（`services/api/`）

| 文件 | 职责 |
|------|------|
| `claude.ts` | Anthropic API 客户端，管理 token 使用统计 |
| `client.ts` | HTTP 客户端基础设施 |
| `bootstrap.ts` | 启动时拉取服务端配置（`fetchBootstrapData`） |
| `filesApi.ts` | Files API，支持上传文件作为对话附件 |
| `withRetry.ts` | 指数退避重试，定义 `FallbackTriggeredError` |
| `errors.ts` | 错误类型（`isPromptTooLongMessage` 等） |
| `logging.ts` | API 调用日志，token 使用追踪 |
| `usage.ts` | 用量统计 |
| `grove.ts` | 内部 Grove 服务（Anthropic 内部） |

### 9.2 MCP 服务（`services/mcp/`）

MCP（Model Context Protocol）是 Anthropic 推出的标准化工具协议。服务层负责：
- 连接和管理多个 MCP 服务器
- OAuth 认证流程（`mcpAuthTool.tsx`、`McpAuthTool`）
- Channel 权限管理
- 官方 MCP 注册表预取（`officialRegistry.ts`）

### 9.3 其他服务

| 服务 | 路径 | 说明 |
|------|------|------|
| OAuth | `services/oauth/` | OAuth 2.0 完整流程 |
| LSP | `services/lsp/` | Language Server Protocol 管理器 |
| Analytics | `services/analytics/` | GrowthBook feature flags + 事件埋点 |
| Compact | `services/compact/` | 对话历史压缩（多种策略） |
| Plugins | `services/plugins/` | 插件加载器 |
| PolicyLimits | `services/policyLimits/` | 组织策略限制执行 |
| ExtractMemories | `services/extractMemories/` | 自动记忆提取 |
| RemoteManagedSettings | `services/remoteManagedSettings/` | 远程托管配置（MDM） |
| SettingsSync | `services/settingsSync/` | 配置跨设备同步 |
| ToolUseSummary | `services/toolUseSummary/` | 工具调用摘要生成 |
| VCR | `services/vcr.ts` | API 调用录放（测试用） |
| Voice | `services/voice.ts` | 语音输入集成 |

---

## 十、UI 层（`src/components/`）

约 140 个 Ink React 组件，覆盖从顶层 Shell 到每个工具的 UI 表示。

### 10.1 关键组件

| 组件 | 职责 |
|------|------|
| `App.tsx` | 主 Shell，整个 TUI 的根节点 |
| `BaseTextInput.tsx` | 基础文本输入框 |
| `BashModeProgress.tsx` | Bash 命令执行进度显示 |
| `CompactSummary.tsx` | 历史压缩后的摘要显示 |
| `CoordinatorAgentStatus.tsx` | 多 Agent 协调状态面板 |
| `ContextVisualization.tsx` | 上下文 token 可视化 |
| `DevBar.tsx` | 开发者调试信息栏 |
| `DiagnosticsDisplay.tsx` | 诊断信息展示 |
| `DesktopHandoff.tsx` | 桌面端切换（Desktop App） |

### 10.2 状态管理（`src/state/`）

```
state/
├── AppState.tsx       # 全局状态类型定义
├── AppStateStore.ts   # 状态存储（基于 useReducer 模式）
├── onChangeAppState.ts # 状态变化回调
└── selectors.ts       # 状态选择器
```

状态变更通过 `setAppState(f: (prev) => next)` 函数式更新，Ink 组件通过 `getAppState()` 读取。

---

## 十一、Feature Flags 与构建时死代码剥除

这是 Claude Code 架构中最有工程价值的设计之一。

### 11.1 `bun:bundle` 的 `feature()` 函数

```typescript
import { feature } from 'bun:bundle'

// 运行时为 false 的 feature，Bun 在构建时会将整个分支剥除
const SleepTool = feature('PROACTIVE') || feature('KAIROS')
  ? require('./tools/SleepTool/SleepTool.js').SleepTool
  : null
```

这不是普通的条件判断——Bun bundler 在构建时就能确定 `feature()` 的值，并通过 Tree Shaking 把 `null` 分支对应的代码完全从产物中移除。

### 11.2 主要 Feature Flags

| Flag | 功能 |
|------|------|
| `PROACTIVE` | 主动/后台模式 |
| `KAIROS` | Kairos Assistant 模式 |
| `BRIDGE_MODE` | IDE 扩展桥接 |
| `DAEMON` | 守护进程模式 |
| `VOICE_MODE` | 语音输入 |
| `AGENT_TRIGGERS` | Agent 定时触发（Cron） |
| `AGENT_TRIGGERS_REMOTE` | 远程触发 |
| `COORDINATOR_MODE` | 多智能体协调器 |
| `MONITOR_TOOL` | 监控工具 |
| `REACTIVE_COMPACT` | 响应式上下文压缩 |
| `CONTEXT_COLLAPSE` | 上下文折叠 |
| `HISTORY_SNIP` | 历史片段裁剪 |
| `EXPERIMENTAL_SKILL_SEARCH` | Skill 向量搜索 |
| `TEMPLATES` | 任务模板分类器 |
| `KAIROS_GITHUB_WEBHOOKS` | GitHub Webhook 集成 |

### 11.3 `USER_TYPE === 'ant'` 内部工具

除了 feature flags，还有一类通过环境变量 `USER_TYPE` 控制的"内部员工专属"工具，如 `REPLTool`（交互式 REPL）、`SuggestBackgroundPRTool`（后台 PR 建议）等。

---

## 十二、上下文收集（`src/context.ts`）

每次会话启动时，`context.ts` 会收集并缓存一次性的系统/用户上下文：

- **Git 状态**：`git status`、当前分支、最近提交
- **环境信息**：操作系统、shell 类型、工作目录
- **CLAUDE.md 内容**：`utils/claudemd.ts` 负责发现并注入项目级和全局的 `CLAUDE.md` 文件，以及 memory 文件
- **已安装工具检测**：检测 ripgrep、git 等依赖是否可用

这些信息被注入到 System Prompt 中，是 Claude 理解工作环境的基础。

### 12.1 memoize + 并行 git 命令

`getGitStatus` 用 `lodash/memoize` 包裹，整个会话期间只执行一次。内部通过 `Promise.all` 把 5 条 git 命令并行发射，完全消除串行等待：

```typescript
export const getGitStatus = memoize(async (): Promise<string | null> => {
  const [branch, mainBranch, status, log, userName] = await Promise.all([
    getBranch(),                                                       // git rev-parse --abbrev-ref HEAD
    getDefaultBranch(),                                                // 判断主分支（main/master）
    execFileNoThrow(gitExe(), ['--no-optional-locks', 'status', '--short']),
    execFileNoThrow(gitExe(), ['--no-optional-locks', 'log', '--oneline', '-n', '5']),
    execFileNoThrow(gitExe(), ['config', 'user.name']),
  ])
  // 拼装为 System Prompt 中的 gitStatus 段落
})
```

### 12.2 调试逃生门：setSystemPromptInjection

`context.ts` 暴露了一个内部调试接口，可以在运行时临时替换整个 System Prompt 的内容，修改后会**立即使缓存失效**：

```typescript
let systemPromptInjection: string | null = null

export function setSystemPromptInjection(value: string | null): void {
  systemPromptInjection = value
  // 清除 getUserContext 和 getSystemContext 的 memoize 缓存
  getUserContext.cache.clear?.()
  getSystemContext.cache.clear?.()
}
```

这个接口不对外暴露给用户，但对 Anthropic 内部的 prompt 调试极为有用——可以在不重启进程的情况下热替换 System Prompt，下一次 Turn 就会生效。

---

## 十三、一些值得关注的工程细节

### 13.1 循环依赖的规避

源码中有多处注释说明了为什么用懒加载（`() => require(...)`）而非直接 `import`：

```typescript
// tools.ts
// Lazy require to break circular dependency: tools.ts → TeamCreateTool → ... → tools.ts
const getTeamCreateTool = () =>
  require('./tools/TeamCreateTool/TeamCreateTool.js').TeamCreateTool
```

```typescript
// main.tsx
// Lazy require to avoid circular dependency: teammate.ts → AppState.tsx → ... → main.tsx
const getTeammateUtils = () => require('./utils/teammate.js')
```

这是大型 TypeScript 模块系统中常见的循环依赖处理方式——不是"坏代码"，而是有意为之的工程决策。

### 13.2 File History 系统

`utils/fileHistory.ts` 实现了文件编辑历史追踪：在每次 `FileEditTool` 或 `BashTool` 修改文件前，先拍一个快照（`fileHistoryMakeSnapshot`）。这使得 `/diff` 命令可以展示本次会话所有改动的 diff，类似一个轻量级的 git 临时暂存区。

### 13.3 Token 费用追踪

`cost-tracker.ts` 实时追踪本次会话的 API 调用次数、输入/输出 token 数以及累计费用，通过 `/cost` 命令可以随时查看。

### 13.4 VCR 录放

`services/vcr.ts` 实现了 API 调用的录放功能——可以录制真实的 API 交互，然后在测试中回放，避免昂贵的 API 调用。

### 13.5 AppStateProvider 嵌套保护

`src/state/AppState.tsx` 中的 `AppStateProvider` 组件在 mount 时会检测 Context 是否已存在，一旦发现嵌套就直接抛出错误：

```typescript
export function AppStateProvider({ children, initialState, onChangeAppState }: Props) {
  // 通过读取 Context 判断是否已被外层挂载
  const hasAppStateContext = useContext(AppStoreContext) !== null
  if (hasAppStateContext) {
    throw new Error('AppStateProvider can not be nested within another AppStateProvider')
  }
  // 只在 mount 时创建一次 store，永不重建
  const [store] = useState(() =>
    createStore(initialState ?? getDefaultAppState(), onChangeAppState)
  )
  // ...
}
```

这种"防御性断言"（Defensive Assertion）比运行时数据错误更容易定位问题——开发者在搭建复杂的 Agent/多面板 UI 时，如果不小心嵌套了两层 Provider，会立刻看到清晰的错误而不是诡异的状态不一致。

### 13.6 FileEditTool 的 V8/Bun 字符串长度上限

`FileEditTool.ts` 开头有一段注释，处理了一个容易被忽视的边界条件：

```typescript
// V8/Bun string length limit is ~2^30 characters (~1 billion).
// For typical ASCII/Latin-1 files, 1 byte on disk = 1 character,
// so 1 GiB in stat bytes is approximately the limit.
```

这意味着超过 1 GiB 的纯 ASCII 文件在读入为 JS 字符串时会溢出。`FileEditTool` 会在处理前检查文件大小，避免触碰这个上限——这是真正处理过"用户把大文件扔给 AI 编辑"场景后才会发现的 corner case。

---

## 十四、整体架构总结

用一张图来总结整个系统的层次关系：

```
┌─────────────────────────────────────────────────────────────────┐
│                        用户界面层                               │
│  Commander.js CLI  ←→  React/Ink TUI  ←→  IDE Bridge (JWT)      │
├─────────────────────────────────────────────────────────────────┤
│                        命令/交互层                               │
│  /slash Commands  ←→  QueryEngine  ←→  AppState                 │
├─────────────────────────────────────────────────────────────────┤
│                     核心对话循环层                               │
│         query.ts（流式 API + tool_use 分发循环）                 │
│    ┌───────────────────────────────────────────────────┐        │
│    │  Anthropic API  →  stream  →  tool_use blocks     │        │
│    │       ↑                          ↓                │        │
│    │  tool_result messages    Tool.call() dispatch     │        │
│    └───────────────────────────────────────────────────┘        │
├─────────────────────────────────────────────────────────────────┤
│                        工具系统层                                │
│  Bash  File  Glob  Grep  Web  Agent  Skill  MCP  LSP  Task...   │
│              ↕ 权限系统（toolPermission/）                       │
├─────────────────────────────────────────────────────────────────┤
│                      多智能体层                                  │
│  AgentTool  TeamCreateTool  Coordinator  Skills  SendMessage     │
├─────────────────────────────────────────────────────────────────┤
│                        服务层                                    │
│  API(retry)  MCP  LSP  OAuth  Compact  GrowthBook  Plugins       │
├─────────────────────────────────────────────────────────────────┤
│                     构建时特性层（Bun）                           │
│  feature('KAIROS') | feature('BRIDGE_MODE') | feature('...')    │
│  → 未启用的 feature 对应代码在打包时完全移除                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## 十五、从这份源码能学到什么

这份代码库是一个难得的"生产级 AI 原生应用"样本，其中有几个设计模式值得特别关注：

**1. 流式 UX 的重要性**：对话循环是流式的，工具执行进度是实时推送的，用户永远不会面对一个"卡住"的光标。这需要从架构层面就设计好异步消息流。

**2. 权限系统要中心化**：所有工具调用统一过权限层，而不是各工具自己判断，使得权限策略的切换（交互/自动/只读/绕过）变得简单。

**3. Feature Flag 即架构隔离**：Bun 的构建时 feature flag 不只是功能开关，它让不同功能集的构建产物互相独立，是一种轻量的"模块化发布"方案。

**4. 多智能体不是噱头**：AgentTool、TeamCreateTool、Coordinator 三层多智能体架构，从单任务派生到全局调度，粒度清晰，互不干扰。

**5. 工具即接口**：每个工具的 Zod inputSchema 同时服务于三个目的——API 参数验证、JSON Schema 生成（给 Claude 看）、TypeScript 类型推断。一份定义，三份价值。

---

## 参考资料

1. [Claude Code 源码仓库（存档）](https://github.com/yurisachan16-creator/claude-code-main)
2. [Ink — React for CLI](https://github.com/vadimdemedes/ink)
3. [Model Context Protocol](https://modelcontextprotocol.io/)
4. [Bun Bundle Feature Flags](https://bun.sh/docs/bundler/macros)
5. [Zod v4 文档](https://zod.dev/)
