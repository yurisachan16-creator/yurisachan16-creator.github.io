---
title: Claude Code 源码解析：深度拆解 Agent Loop 主循环
date: 2026-04-07 18:00:00
updated: 2026-04-07 20:00:00
tags:
  - 源码分析
  - AI
  - Agent
  - TypeScript
  - 架构设计
categories:
  - 技术研究
keywords: Claude Code, Agent Loop, queryLoop, 源码分析, AI Agent, TypeScript, 上下文压缩
description: 深入剖析 Claude Code 的 Agent Loop 核心实现——从 while(true) 状态机到多层上下文压缩，从并发工具执行到 3 种错误恢复路径，完整还原一个生产级 LLM 循环引擎的全貌。
permalink: /2026/04/07/claude-code-agent-loop/
---

2026 年 3 月末，随着 Claude Code 源码因意外泄露的 `.map` 文件而公开，我们得以直视一个生产级 AI Agent 的内部构造。我在此前的文章中梳理了整体架构，而本文聚焦于最核心的部分——**Agent Loop**：也就是让 Claude Code 能够持续思考、调用工具、从错误中恢复的那个 `while (true)` 循环。

这个循环埋在 `src/query.ts` 的 `queryLoop` 函数里，全长约 1500 行。它不是一个简单的"问答循环"，而是一个有完整状态机、多层上下文压缩、并发工具执行和分级错误恢复的复杂系统。读懂它，就能理解 Claude Code 为什么能在上下文即将耗尽时自动压缩、为什么能在输出被截断时自动续写、为什么多个工具调用可以并行执行。

> **说明**：本文所有代码来自公开泄露的源码，仅用于技术研究目的。

<!-- more -->

---

## 一、Agent Loop 在整体架构中的定位

首先建立一个心智模型。Claude Code 的对话引擎分为两层：

```
┌──────────────────────────────────────────────────────┐
│              SDK 调用方 / REPL / headless              │
└──────────────────────┬───────────────────────────────┘
                       │ for await (msg of submitMessage())
┌──────────────────────▼───────────────────────────────┐
│                   QueryEngine                         │
│  · 会话级状态（mutableMessages, readFileState...）    │
│  · 权限拦截（wrappedCanUseTool）                      │
│  · transcript 持久化                                  │
│  · 最终 SDKResult 组装                                │
└──────────────────────┬───────────────────────────────┘
                       │ for await (msg of query())
┌──────────────────────▼───────────────────────────────┐
│              query() → queryLoop()                    │
│  · while (true) 主循环                                │
│  · 上下文压缩 / 工具执行 / 错误恢复                   │
│  · yield 流式事件给上层                               │
└──────────────────────┬───────────────────────────────┘
                       │ deps.callModel()
┌──────────────────────▼───────────────────────────────┐
│              Anthropic API（HTTP SSE 流）              │
└──────────────────────────────────────────────────────┘
```

**`QueryEngine`** 是会话对象——一个 `QueryEngine` 实例对应一个完整的对话生命周期，跨 Turn 持久化消息历史、文件缓存、用量统计。每次用户发消息，`submitMessage()` 被调用一次，开启一个新的 Turn。

**`query()` / `queryLoop()`** 是单次 Turn 的执行引擎——它接受当前消息数组，驱动一次"思考 → 工具调用 → 再思考 → …"的完整循环，直到模型不再调用工具（或触发某个终止条件）。

**`query()` 本身只是一个薄封装**（L219）：

```typescript
export async function* query(params: QueryParams): AsyncGenerator<..., Terminal> {
  const consumedCommandUuids: string[] = []
  const terminal = yield* queryLoop(params, consumedCommandUuids)
  // 循环正常退出后，为已消费的 slash command 触发 'completed' 生命周期事件
  for (const uuid of consumedCommandUuids) {
    notifyCommandLifecycle(uuid, 'completed')
  }
  return terminal
}
```

真正的逻辑全在 `queryLoop`（L241）。

---

## 二、State 状态机：循环的骨架

`queryLoop` 的核心结构是一个 `while (true)` + 单一可变 `State` 对象：

```typescript
// query.ts L204-L217
type State = {
  messages: Message[]                           // 本迭代的消息历史
  toolUseContext: ToolUseContext                // 工具执行上下文（含 AppState 引用）
  autoCompactTracking: AutoCompactTrackingState | undefined // 自动压缩追踪
  maxOutputTokensRecoveryCount: number          // max_output_tokens 恢复尝试次数
  hasAttemptedReactiveCompact: boolean          // 防止 reactive compact 死循环
  maxOutputTokensOverride: number | undefined   // 动态输出 token 上限
  pendingToolUseSummary: Promise<...> | undefined // 后台生成的工具摘要（Haiku）
  stopHookActive: boolean | undefined           // stop hook 重试中
  turnCount: number                             // 已执行的轮次
  transition: Continue | undefined              // 上一次迭代的 continue 原因（可测试性）
}
```

**为什么不用递归而用 `while (true) + continue`？**

工具调用完成后需要带着新消息"继续循环"。最自然的写法是递归调用自身，但递归有两个问题：一是调用栈会随工具调用深度增长，长对话可能栈溢出；二是跨迭代的 `using` 资源（如 `pendingMemoryPrefetch`）需要 `while` 循环的作用域来保证 dispose。

`State` 对象让循环内部的所有"继续"都变成 `state = {...nextState}; continue`，9 个字段的更新集中在一处，而非分散在整个函数体里。

**`transition` 字段的设计意图**（L213）：

```typescript
// 记录上一次迭代为何继续。undefined 表示第一次迭代。
// 允许测试断言"某个恢复路径触发了"，而不必检查消息内容。
transition: Continue | undefined
```

`Continue` 类型是一个枚举：

```typescript
type Continue =
  | { reason: 'next_turn' }
  | { reason: 'collapse_drain_retry'; committed: number }
  | { reason: 'reactive_compact_retry' }
  | { reason: 'max_output_tokens_escalate' }
  | { reason: 'max_output_tokens_recovery'; attempt: number }
  | { reason: 'stop_hook_blocking' }
  | { reason: 'token_budget_continuation' }
```

### 2.1 不可变配置快照：`buildQueryConfig()`

循环入口处会调用一次 `buildQueryConfig()`，把环境变量和 Statsig feature gate 的当前值快照成一个 `QueryConfig`：

```typescript
// query/config.ts
export type QueryConfig = {
  sessionId: SessionId
  gates: {
    streamingToolExecution: boolean  // Statsig: tengu_streaming_tool_execution2
    emitToolUseSummaries: boolean    // Env: CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES
    isAnt: boolean                   // Env: USER_TYPE === 'ant'
    fastModeEnabled: boolean         // !DISABLE_FAST_MODE
  }
}
```

**为什么要快照而不是每次读取？** 因为 `feature()` gates 是 bun:bundle 的树摇边界——它们必须内联在 `if/ternary` 条件里才能做死代码消除，不能存进变量。`QueryConfig` 里的 `gates` 是普通 boolean，可以自由传递和测试，是对这一限制的优雅绕开。

### 2.2 依赖注入：`productionDeps()`

```typescript
// query/deps.ts
export type QueryDeps = {
  callModel: typeof queryModelWithStreaming  // HTTP 流式调用 Claude API
  microcompact: typeof microcompactMessages  // 轻量级工具结果清理
  autocompact: typeof autoCompactIfNeeded    // 上下文超阈值时的全量压缩
  uuid: () => string                         // UUID 生成（方便测试注入固定值）
}

export function productionDeps(): QueryDeps {
  return {
    callModel: queryModelWithStreaming,
    microcompact: microcompactMessages,
    autocompact: autoCompactIfNeeded,
    uuid: randomUUID,
  }
}
```

`params.deps ?? productionDeps()` 让 query() 的 I/O 依赖可以在测试时替换，而不需要 spyOn 7 个不同模块。

---

## 三、每次迭代的完整执行序列

理解了状态机骨架后，我们来看每次迭代内部的执行顺序。这是整个 Agent Loop 最核心的部分：

```
╔══════════════════════════════════════════════════════╗
║              queryLoop 单次迭代                       ║
╠══════════════════════════════════════════════════════╣
║  ① 技能发现预取（异步并行启动，不阻塞）              ║
║  ② 工具结果预算裁剪（applyToolResultBudget）         ║
║  ③ History Snip（标记删除旧消息）        [feature]   ║
║  ④ Microcompact（工具结果局部清理）                  ║
║  ⑤ Context Collapse（消化暂存折叠队列） [feature]    ║
║  ⑥ Autocompact（token 超阈值时全量压缩）             ║
║  ─────────────────────────────────────────────────── ║
║  ⑦ callModel()：HTTP SSE 流式调用                    ║
║     └─ StreamingToolExecutor 边流边执行工具           ║
║  ─────────────────────────────────────────────────── ║
║  ⑧ 错误恢复判断（PTL / max_output / media）          ║
║  ⑨ Stop Hooks 执行                                   ║
║  ⑩ 工具执行收尾 + 附件注入 + Token Budget 检查       ║
║     → state = next; continue                         ║
╚══════════════════════════════════════════════════════╝
```

### 阶段 ①：技能发现预取

```typescript
// 在迭代开始立即启动，返回 Promise，后续 await
const pendingSkillPrefetch = skillPrefetch?.startSkillDiscoveryPrefetch(
  null, messages, toolUseContext,
)
```

技能（Skill）是可复用的工作流。预取在模型流式输出期间并行运行，通常在 turn 结束前就已 settle，实现"零额外延迟"的技能发现。

### 阶段 ②：工具结果预算裁剪

```typescript
messagesForQuery = await applyToolResultBudget(
  messagesForQuery,
  toolUseContext.contentReplacementState,
  persistReplacements ? records => void recordContentReplacement(...) : undefined,
  // 对声明了 maxResultSizeChars = Infinity 的工具（如 Read）不裁剪
  new Set(tools.filter(t => !Number.isFinite(t.maxResultSizeChars)).map(t => t.name)),
)
```

每条消息中的工具结果如果超过预算阈值（默认 50k 字符/条），会被持久化到磁盘，消息内容替换为 `<persisted-output path="...">` 引用。**这是 API 请求前的最后一道"体积控制"**，防止单次请求体过大。

### 阶段 ③~⑥：多层压缩（详见第四章）

这四个阶段构成完整的上下文压缩体系，此处仅标注执行顺序：

- **Snip** → 标记删除历史消息
- **Microcompact** → 清理过期工具结果
- **Context Collapse** → 折叠暂存队列消化
- **Autocompact** → 超阈值时触发 LLM 全量摘要

### 阶段 ⑦：callModel 流式调用

```typescript
for await (const message of deps.callModel({
  messages: prependUserContext(messagesForQuery, userContext),
  systemPrompt: fullSystemPrompt,
  tools: toolUseContext.options.tools,
  options: {
    model: currentModel,
    fallbackModel,
    maxOutputTokensOverride,
    queryTracking,  // 链路追踪（chainId + depth）
    // ...
  },
})) {
  // 处理每一条流式消息
  if (message.type === 'assistant') {
    assistantMessages.push(message)
    // 发现 tool_use 块 → 交给 StreamingToolExecutor
    for (const block of toolUseBlocks) {
      streamingToolExecutor?.addTool(block, message)
    }
  }
  // 对可恢复错误暂时 withhold，不 yield 给上层
  if (!withheld) yield yieldMessage
}
```

关于"withhold"机制：PTL（prompt-too-long）、`max_output_tokens` 等错误消息不立即 yield，等待恢复逻辑判断是否真的需要 surface，避免 SDK 调用方因收到错误消息而终止会话。

### 阶段 ⑧⑨：错误恢复 + Stop Hooks（详见第六、七章）

### 阶段 ⑩：工具执行收尾与状态组装

```typescript
// 执行工具（或消费 StreamingToolExecutor 剩余结果）
for await (const update of toolUpdates) {
  yield update.message
  toolResults.push(...)
}

// 注入附件：memory prefetch、skill prefetch、queued commands
for await (const attachment of getAttachmentMessages(...)) {
  yield attachment
  toolResults.push(attachment)
}

// 刷新 MCP 工具列表（中途连接的 MCP server 即时生效）
if (updatedToolUseContext.options.refreshTools) { ... }

// 检查 maxTurns 限制
if (maxTurns && nextTurnCount > maxTurns) {
  yield createAttachmentMessage({ type: 'max_turns_reached', ... })
  return { reason: 'max_turns', turnCount: nextTurnCount }
}

// 组装下一轮 State，continue
state = {
  messages: [...messagesForQuery, ...assistantMessages, ...toolResults],
  toolUseContext: toolUseContextWithQueryTracking,
  turnCount: nextTurnCount,
  transition: { reason: 'next_turn' },
  // ...
}
```

---

## 四、上下文压缩体系：五层防护

这是 Claude Code 区别于普通聊天 UI 的核心能力之一。它不是单一策略，而是五层从轻到重的梯级体系，加上一个被动响应层：

```
Token 使用量
     ↑
  100% ── 硬阻塞限制（isAtBlockingLimit = contextWindow - 3k）
           → 返回错误，用户必须手动 /compact
   ~93% ── Autocompact 阈值（contextWindow - 13k）  ← 层 5
           → 触发 LLM 全量摘要压缩
   ~80% ── 警告阈值（UI 显示"上下文紧张"）
           ↑ 以上每轮迭代都在尝试 Snip/Micro/Collapse
```

### 层 1：工具结果预算（applyToolResultBudget）

**触发时机**：每次迭代都会执行，是最先运行的裁剪。

**工作方式**：按 API 消息分组（以 assistant 消息为分界），对每组中超出阈值的 `tool_result` 内容持久化到磁盘。使用 `ContentReplacementState` 追踪已替换的记录，避免每轮重复写入：

```typescript
type ContentReplacementState = {
  seenIds: Set<string>        // 已审查的 tool_use_id
  replacements: Map<string, string>  // tool_use_id → 替换文本
}
```

`frozen`（已见但未替换）的记录永远不会被替换，以保持 prompt cache 的前缀稳定性。

### 层 2：History Snip（`HISTORY_SNIP` feature gate）

**触发时机**：每次迭代，但有 `findWritePivot` 的写操作守卫。

**工作方式**：不删除消息，而是"标记删除"——打 snip 标记。`projectSnippedView()` 在读取时做投影过滤，`getMessagesAfterCompactBoundary()` 内部会调用它。对 UI 透明，对 API 请求不可见。

### 层 3：Microcompact（工具结果局部清理）

**触发时机**：每次迭代；有两个子策略按优先级尝试。

**子策略一：时间基础清理**（`tengu_slate_heron` GrowthBook flag）

```typescript
const TIME_GAP_THRESHOLD = 60  // 分钟

// 距上次 assistant 消息超过 60 分钟 → 服务器 prompt cache 已过期
// → 无论如何都要重写全前缀 → 提前清理旧工具结果，减少请求体积
if (minutesSinceLastAssistant > TIME_GAP_THRESHOLD) {
  // 保留最近 keepRecent（默认 5）个工具结果，清除其余
}
```

**子策略二：内容清理**（通用路径）

对 Bash、Grep、Glob、Read、WebFetch 等"读取类"工具的旧结果替换为 `[Old tool result content cleared]`。这些工具的输出是一次性的——模型已经看过，后续 turn 不需要再次发给 API。

### 层 4：Context Collapse（`CONTEXT_COLLAPSE` feature gate）

**核心思路**：把"折叠"分为「暂存」和「提交」两个阶段。

- **暂存**：标记某段消息可以被折叠，但不立即执行。
- **消化**（`applyCollapsesIfNeeded`）：每次迭代检查暂存队列，在合适时机提交折叠，保留粒度比全量摘要高。
- **PTL 时强制消化**（`recoverFromOverflow`）：当 API 返回 413 时，把所有暂存折叠一次性提交，尝试降低 token 数。

这是"在真正需要压缩前的最后一道便宜防线"。

### 层 5：Autocompact（核心防线）

**触发条件**：

```typescript
// autoCompact.ts
const threshold = getAutoCompactThreshold(model)
// = getEffectiveContextWindowSize(model) - AUTOCOMPACT_BUFFER_TOKENS(13_000)
// 例：200k 窗口 - 20k 保留输出 - 13k 缓冲 = 167k ≈ 92.8% 使用率

if (tokenCountWithEstimation(messages) >= threshold) {
  // 触发压缩
}
```

**执行顺序**：

```
shouldAutoCompact() 通过后：
  1. 尝试 SessionMemory 增量压缩（trySessionMemoryCompaction）
     └─ 如果存在持久化的会话内存 → 只摘要"新增部分"
     └─ 失败或不适用 → 继续

  2. 全量压缩（compactConversation）
     a. 执行 pre-compact hooks（用户自定义指令注入）
     b. 流式调用 LLM 生成摘要（streamCompactSummary）
        ├─ tengu_compact_cache_prefix 启用时：
        │  forked agent 重用主线程的 prompt cache 前缀
        │  避免重建 cache 的额外开销
        └─ 标准路径：独立 API 调用
     c. PTL 重试（最多 3 次）：摘要本身太长时截断最早回合后重试
     d. buildPostCompactMessages()：
        [compact_boundary, ...summaryMessages, ...messagesToKeep,
         ...attachments, ...hookResults]
     e. runPostCompactCleanup()：重置 microcompact 状态、清除缓存
```

**电路断路器**（重要！）：

```typescript
const MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3

if (consecutiveFailures >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES) {
  // 停止重试，放弃本次压缩，让上层继续（可能最终触发硬阻塞）
  return { wasCompacted: false, consecutiveFailures }
}
```

据源码注释，没有这个机制之前，某些会话触发了 **3,272 次连续失败**，每天浪费约 25 万次 API 调用。

### 被动层：Reactive Compact

不主动触发，而是响应真实的 API 413 响应（`prompt_too_long`）。在 withhold 住 413 错误消息后，调用 `tryReactiveCompact()` 尝试压缩后重试。`hasAttemptedReactiveCompact` 标志防止"压缩后仍 413 → 再压缩 → 循环"的死循环。

---

## 五、流式 API 调用与工具执行并发

### 5.1 StreamingToolExecutor：边流边执行

传统的"先完成流式输出，再执行工具"意味着工具执行总是串在 API 调用之后。`StreamingToolExecutor` 改变了这一点：

```
API 流式输出：
  ┌────────────────────────────────────────────────────┐
  │ text block → text block → tool_use A → tool_use B │
  └──────────────────────┬─────────────────┬──────────┘
                         │ addTool(A)       │ addTool(B)
                    ┌────▼───┐        ┌────▼───┐
                    │ exec A │        │ exec B │   ← 在流式输出期间并行执行
                    └────────┘        └────────┘
```

执行时有**并发安全检查**：

```typescript
// 每个工具通过 isConcurrencySafe(input) 声明自己是否线程安全
function canExecuteTool(isConcurrencySafe: boolean): boolean {
  // 如果新工具并发安全，且当前所有执行中的工具也并发安全 → 可并行
  // 否则 → 必须等待所有当前工具完成（独占锁）
  const allCurrentAreConcurrent = executingTools.every(t => t.isConcurrencySafe)
  return isConcurrencySafe && allCurrentAreConcurrent
}
```

Bash 等有副作用的工具 `isConcurrencySafe` 返回 false，会独占执行；Read、Grep 等只读工具返回 true，可以与其他只读工具并行。

### 5.2 Streaming Fallback：tombstone 处理

当主模型不可用、需要切换到 fallback 模型时：

```typescript
if (streamingFallbackOccured) {
  // 1. 为已流出的 assistant 消息发出 tombstone
  //    （通知 UI 和 transcript 删除这些消息）
  for (const msg of assistantMessages) {
    yield { type: 'tombstone', message: msg }
  }
  // 2. 清空本轮所有中间状态
  assistantMessages.length = 0
  toolResults.length = 0
  toolUseBlocks.length = 0
  // 3. 丢弃正在执行的工具（防止孤儿 tool_result）
  streamingToolExecutor?.discard()
  streamingToolExecutor = new StreamingToolExecutor(...)
}
```

被 tombstone 的消息有「签名保护」的 thinking 块，replay 给 fallback 模型会 400 报错，所以必须彻底清除。

### 5.3 yieldMissingToolResultBlocks：消息序列合法性保证

Claude API 要求每个 `tool_use` 块后必须有对应的 `tool_result`。如果流式调用中途抛出异常，`yieldMissingToolResultBlocks` 为所有已发出但缺少结果的 tool_use 补充错误 tool_result：

```typescript
function* yieldMissingToolResultBlocks(
  assistantMessages: AssistantMessage[],
  errorMessage: string,
) {
  for (const msg of assistantMessages) {
    const toolUseBlocks = msg.message.content
      .filter(c => c.type === 'tool_use') as ToolUseBlock[]
    for (const toolUse of toolUseBlocks) {
      yield createUserMessage({
        content: [{
          type: 'tool_result',
          content: errorMessage,
          is_error: true,
          tool_use_id: toolUse.id,  // 必须与 tool_use 的 id 对应
        }],
      })
    }
  }
}
```

---

## 六、Stop Hooks：模型输出后的拦截层

Stop Hooks 在每轮模型输出完成、工具执行前触发，是用户自定义逻辑介入 Agent Loop 的接入点。

### 6.1 handleStopHooks 完整执行流程

```typescript
// query/stopHooks.ts
export async function* handleStopHooks(
  messagesForQuery: Message[],
  assistantMessages: AssistantMessage[],
  systemPrompt, userContext, systemContext,
  toolUseContext: ToolUseContext,
  querySource: QuerySource,
  stopHookActive?: boolean,
): AsyncGenerator<..., StopHookResult>

type StopHookResult = {
  blockingErrors: Message[]    // hook 检查失败，需要重新查询
  preventContinuation: boolean // hook 要求终止整个循环
}
```

**执行步骤（按顺序）**：

**① 保存缓存安全参数**

将 `systemPrompt + userContext + systemContext + toolUseContext + messages` 打包，供后续 fork 出的子 agent 使用。REPL 的 `/btw` 命令（"by the way"追加上下文）正是通过这个机制插入的。

**② 模板作业分类**（`TEMPLATES` feature gate）

```typescript
// 用小模型（Haiku 级别）对当前任务进行分类
// 结果写入 jobClassifier 状态，用于 stop hooks 的任务状态跟踪
await jobClassifier?.classify(cacheSafeParams)
```

**③ 后台异步任务（fire-and-forget）**

这些任务不阻塞主循环：

- **提示建议**（可选）：分析当前上下文，生成改进建议
- **记忆提取**（`EXTRACT_MEMORIES` feature gate）：从对话中提取值得记住的信息，写入 Memory 文件
- **自动梦境生成**：Anthropic 内部的一个特性，用于异步生成会话摘要

**④ Stop Hooks 执行（核心）**

```typescript
// 执行用户在 settings.json 中配置的 stop hooks
// 每个 stop hook 可以：
// 1. 返回新消息 → 追加到 blockingErrors，触发一次"重新查询"
// 2. 返回 prevent_continuation → 终止整个 Agent Loop
// 3. 什么都不返回 → 允许继续
for (const hookResult of await executeStopHooks(
  lastAssistantMessage,
  toolUseContext,
  messagesForQuery,
)) {
  if (hookResult.preventContinuation) {
    return { blockingErrors: [], preventContinuation: true }
  }
  if (hookResult.blockingError) {
    blockingErrors.push(hookResult.blockingError)
  }
}
```

**⑤ Chicago MCP 清理**（`CHICAGO_MCP` feature gate，主线程专用）

```typescript
// Chicago MCP 是 Claude Code 的计算机使用（Computer Use）相关功能
// 每轮结束后需要：
// 1. 自动取消隐藏被 CU 隐藏的 UI 元素
// 2. 释放 CU 持有的独占锁
// 仅在主线程执行（子 agent 不持有 UI 锁）
try {
  const { cleanupComputerUseAfterTurn } = await import('./utils/computerUse/cleanup.js')
  await cleanupComputerUseAfterTurn(toolUseContext)
} catch {
  // 静默失败——这是调试用功能，不影响关键路径
}
```

**⑥ Teammate 专用 hooks**（多代理协作场景）

```typescript
// 当前代理是"队友"（teammate）时：
// - 任务完成 hook：通知协调器本任务已完成
// - 空闲 hook：通知协调器可以接受新任务
// 这两个 hook 只在多代理协调器模式（COORDINATOR_MODE）下生效
await executeTaskCompletedHook(...)
await executeTeammateIdleHook(...)
```

### 6.2 Stop Hooks 对循环流的影响

```typescript
// query.ts L1267-L1305
const stopHookResult = yield* handleStopHooks(...)

if (stopHookResult.preventContinuation) {
  return { reason: 'stop_hook_prevented' }  // 终止整个循环
}

if (stopHookResult.blockingErrors.length > 0) {
  // 把 hook 错误追加到消息历史，重新进入循环
  state = {
    messages: [...messagesForQuery, ...assistantMessages, ...stopHookResult.blockingErrors],
    stopHookActive: true,
    hasAttemptedReactiveCompact,  // 注意：保留此标志，防止重试引发压缩死循环
    transition: { reason: 'stop_hook_blocking' },
    // ...
  }
  continue
}
```

注意 `hasAttemptedReactiveCompact` 被保留——如果此前已经做过 reactive compact，stop hook 重试时不能再次触发，否则会陷入"压缩 → 还是太长 → 错误 → stop hook → 压缩 → ..."的无限循环。

---

## 七、错误恢复的三条分层路径

### 7.1 路径一：PTL（Prompt Too Long / API 413）

```
API 返回 413 → 消息被 withhold（不 yield 给上层）
    │
    ▼
第一步：Context Collapse drain（如已暂存折叠且本轮未尝试过）
    └─ 成功提交 N 个折叠 →
       state = { transition: { reason: 'collapse_drain_retry' } }; continue
    │ 折叠队列为空 / 已尝试过
    ▼
第二步：Reactive Compact（tryReactiveCompact）
    └─ 压缩成功 →
       state = { hasAttemptedReactiveCompact: true, transition: { reason: 'reactive_compact_retry' } }; continue
    │ 压缩失败 / 已尝试过
    ▼
surface 错误消息给上层 + executeStopFailureHooks()
return { reason: 'prompt_too_long' }
（不进 stop hooks 正常流程，防止死循环）
```

**为什么不进 stop hooks？** stop hooks 可能注入更多消息（blocking error），而我们已经 413 了，注入更多内容只会让情况更糟，形成死循环。

### 7.2 路径二：max_output_tokens（输出被截断）

模型在回答到一半时碰到了 token 上限，`stop_reason === 'max_tokens'`：

```typescript
// Step 1: Token 数升级（一次性机会）
// 如果当前未设置 maxOutputTokensOverride，升级到 64k
if (capEnabled && maxOutputTokensOverride === undefined) {
  state = {
    maxOutputTokensOverride: ESCALATED_MAX_TOKENS,  // 64k
    transition: { reason: 'max_output_tokens_escalate' },
    // ...
  }
  continue
}

// Step 2: "继续输出"meta 消息注入（最多 MAX_OUTPUT_TOKENS_RECOVERY_LIMIT = 3 次）
if (maxOutputTokensRecoveryCount < 3) {
  const recoveryMessage = createUserMessage({
    content: 'Output token limit hit. Resume directly — no apology, no recap...',
    isMeta: true,  // isMeta = true 表示模型不会在 UI 中看到这条消息
  })
  state = {
    messages: [...messagesForQuery, ...assistantMessages, recoveryMessage],
    maxOutputTokensRecoveryCount: maxOutputTokensRecoveryCount + 1,
    transition: { reason: 'max_output_tokens_recovery', attempt: ... },
  }
  continue
}

// Step 3: 恢复耗尽 → surface 错误
yield lastMessage  // 那条被 withhold 的 max_output_tokens 错误消息
```

meta 消息的措辞很有讲究：`"Resume directly — no apology, no recap of what you were doing. Pick up mid-thought if that is where the cut happened."` 告诉模型直接接着写，不要说"抱歉我被打断了"。

### 7.3 路径三：Media size 错误（图片/PDF 过大）

```typescript
const isWithheldMedia =
  mediaRecoveryEnabled &&
  reactiveCompact?.isWithheldMediaSizeError(lastMessage)

if (isWithheldMedia && reactiveCompact) {
  // 同 PTL 的 reactive compact 路径
  // 区别：不尝试 context collapse drain（collapse 不能 strip 图片）
  const compacted = await reactiveCompact.tryReactiveCompact({ ... })
  if (compacted) { ... continue }

  // 恢复失败 → surface 错误
  return { reason: 'image_error' }
}
```

`hasAttemptedReactiveCompact` 的防螺旋逻辑与 PTL 路径相同：如果压缩后被保留的 tail 中仍有超大图片，下一轮还会 media-error，`hasAttemptedReactiveCompact = true` 让它直接 surface 而非无限循环。

---

## 八、终止条件全景

循环以一个 `Terminal` 类型的值退出。以下是所有可能的退出原因：

| reason | 触发条件 | 是否正常退出 |
|--------|----------|-------------|
| `completed` | 模型不再调用工具，正常完成 | ✓ |
| `max_turns` | 达到 `maxTurns` 限制 | ✓（受控） |
| `blocking_limit` | Token 达到硬阻塞限制（需手动 /compact） | △ |
| `prompt_too_long` | PTL 恢复耗尽 | ✗ |
| `image_error` | Media size 恢复耗尽 | ✗ |
| `model_error` | callModel 抛出未捕获异常 | ✗ |
| `aborted_streaming` | 用户在流式期间按 Ctrl+C | △ |
| `aborted_tools` | 用户在工具执行期间按 Ctrl+C | △ |
| `hook_stopped` | 工具 hook 返回 `hook_stopped_continuation` | △（受控） |
| `stop_hook_prevented` | stop hook 返回 `preventContinuation` | △（受控） |

### Token Budget 自动续写

`TOKEN_BUDGET` feature gate 启用时，循环会在"无工具调用、正常完成"的路径上多一个检查：

```typescript
// query/tokenBudget.ts
function checkTokenBudget(
  tracker: BudgetTracker,
  agentId: string | undefined,
  budget: number | null,
  turnTokens: number,
): TokenBudgetDecision {
  // 子 agent 不启用（budget 机制是主 agent 专属）
  if (agentId || !budget) return { action: 'stop', completionEvent: null }

  const pct = (turnTokens / budget) * 100

  // 检测边际收益递减：连续 3 次以上且每次新增 < 500 token
  const isDiminishing =
    tracker.continuationCount >= 3 &&
    delta < DIMINISHING_THRESHOLD  // 500 tokens

  if (pct < 90 && !isDiminishing) {
    return {
      action: 'continue',
      nudgeMessage: '...继续完成任务...',  // 注入 meta 消息让模型继续
      pct, turnTokens, budget,
    }
  }

  return { action: 'stop', completionEvent: { pct, diminishingReturns: isDiminishing, ... } }
}
```

逻辑是：如果 token 使用不到 90% 且还有实质性进展（每次新增 > 500 token），就插入一条 meta 消息让模型继续工作；反之停止。这实现了"用完预算"而非"生成第一个完整回复就停下"的行为。

---

## 总结

拆解完这 1500 行，我们可以看到一个生产级 Agent Loop 需要解决的核心问题：

1. **上下文有限**：不是靠单一策略，而是靠 5 层从轻到重的梯级体系，在绝大多数情况下无感地维持上下文健康。

2. **输出不可靠**：模型可能被截断、可能碰到 PTL、可能因为图片过大而失败，每种情况都有独立的恢复路径，且路径之间有防死循环机制。

3. **工具执行效率**：StreamingToolExecutor 让工具在流式输出期间就开始执行，并发安全工具并行运行，最大化 I/O 利用率。

4. **可测试性**：`State` 的 `transition` 字段、`QueryDeps` 的依赖注入、`buildQueryConfig()` 的快照设计，让核心循环在不 mock 真实 API 的情况下完全可测。

5. **可扩展性**：Stop Hooks 让循环对外暴露一个干净的介入点，支持用户自定义逻辑（检查、注入、终止），这也是 Claude Code 自定义行为能力的基础。

这个循环不是天然如此的——它是在处理无数边界情况（PTL 死循环、context collapse 与 reactive compact 的协调、streaming fallback 时的消息清理……）的过程中逐渐长成这个形状的。每一段"奇怪"的代码背后，几乎都有一个你不想在生产中遇到的 bug。

---

*本文分析基于 2026 年 3 月 31 日公开的 Claude Code 源码快照。*
