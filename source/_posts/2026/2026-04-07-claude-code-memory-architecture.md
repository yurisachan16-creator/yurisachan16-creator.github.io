---
title: Claude Code 源码深度解析：泄露代码里的记忆系统是如何运转的
date: 2026-04-07 20:00:00
updated: 2026-04-07 20:00:00
tags:
  - 源码分析
  - AI
  - Claude Code
  - Memory
  - TypeScript
categories:
  - 技术研究
keywords: Claude Code, 记忆系统, Auto Memory, Session Memory, Team Memory, Agent Memory
description: 从 Claude Code 泄露源码出发，系统拆解其记忆架构：跨会话文件记忆、查询期相关记忆召回、会话摘要、后台提取、AutoDream 整理，以及团队与 Agent 级扩展。
permalink: /2026/04/07/claude-code-memory-architecture/
article_version: 1.0.0
article_history:
  - version: 1.0.0
    date: 2026-04-07
    summary: 首次发布
---

2026 年 3 月 31 日，Anthropic 在 npm 发布包中意外暴露了 `.map` 文件，使 Claude Code CLI 的完整 TypeScript 源码得以公开。继上一篇对整体架构的拆解之后，这次我们只聚焦一个更有意思、也更容易被外界误解的部分：**Claude Code 的记忆系统**。

很多人提到“AI Agent 有记忆”时，脑海里浮现的是一个模糊的黑箱：也许是向量库，也许是数据库，也许只是把历史消息无限追加到 prompt 里。但从这份源码来看，Claude Code 走的是另一条路线。

它没有把“记忆”做成一个单点模块，而是拆成了三层：

- `Persistent Memory`：跨会话、文件系统上的持久化记忆。
- `Session Memory`：当前长会话里的后台摘要缓存。
- `Recall / Consolidation Layer`：查询时按需召回、turn 结束自动提取、跨会话后台整理。

换句话说，Claude Code 的“记忆”不是一个 feature，而是一套围绕 token 成本、权限边界、长期协作和后台维护构建出来的**分层记忆架构**。

> **免责声明**：本文仅用于教育目的与安全研究，分析对象来自一次公开传播的源码快照，不涉及任何恶意用途。

<!-- more -->

---

## 一、先看总图：Claude Code 到底把“记忆”拆成了什么

如果只看 `src/memdir/memdir.ts`，你会以为 Claude Code 的记忆系统不过是一个 `~/.claude/.../memory/` 目录。但顺着 `QueryEngine`、`query.ts`、`stopHooks.ts` 往下追，就会发现它其实是一条完整流水线：

```text
用户对话
  ↓
system prompt 注入“如何使用记忆”的机制说明
  ↓
MEMORY.md 作为常驻索引进入上下文
  ↓
查询开始时异步预取 relevant memories
  ↓
只把最相关的 topic files 作为 attachment 注入
  ↓
turn 结束后触发 extractMemories
  ↓
将新获得的 durable facts 写回 memory 目录
  ↓
多会话累积后触发 autoDream
  ↓
把零散记录蒸馏成更稳定的 topic files + MEMORY.md
```

这个总图很重要，因为它直接决定了 Claude Code 的核心设计判断：

> 它并不是把所有历史都塞进 prompt，而是把记忆拆成“常驻索引 + 按需正文 + 后台蒸馏”三层。

这和很多简单 Agent 最大的不同在于，**记忆不等于上下文**。上下文是当前模型这次采样能看到什么；记忆则是一个长期存在、可以被检索、可以被维护、可以被重写的外部知识层。

---

## 二、Persistent Memory：文件系统，而不是隐藏数据库

### 2.1 入口：`loadMemoryPrompt()` 只注入“机制”，不注入全部正文

Persistent Memory 的核心入口在 `src/memdir/memdir.ts` 的 `loadMemoryPrompt()`，而调用链从 `src/constants/prompts.ts` 和 `src/QueryEngine.ts` 进入。

`QueryEngine.submitMessage()` 在组装 system prompt 时，会把默认系统提示、可能的自定义提示，以及 memory mechanics prompt 合并在一起：

```ts
const systemPrompt = asSystemPrompt([
  ...(customPrompt !== undefined ? [customPrompt] : defaultSystemPrompt),
  ...(memoryMechanicsPrompt ? [memoryMechanicsPrompt] : []),
  ...(appendSystemPrompt ? [appendSystemPrompt] : []),
])
```

这里有一个很容易忽略的点：`loadMemoryPrompt()` 返回的并不是“所有 memory 文件的全文”，而是一段**关于记忆系统如何工作**的说明文字。它告诉模型：

- 记忆目录在哪里。
- 应该存哪些类型的内容。
- 什么内容不该存。
- 如何写 topic file。
- 如何维护 `MEMORY.md` 这个索引。

也就是说，这里注入的是 **memory mechanics**，不是 full memory payload。

### 2.2 目录解析：记忆目录是有优先级链路的

`src/memdir/paths.ts` 里，`isAutoMemoryEnabled()` 和 `getAutoMemPath()` 基本把这套持久化记忆的运行前提写透了。

#### auto memory 的启用顺序

`isAutoMemoryEnabled()` 的优先级是：

1. `CLAUDE_CODE_DISABLE_AUTO_MEMORY` 环境变量。
2. `CLAUDE_CODE_SIMPLE`，也就是 `--bare` 极简模式。
3. 远程模式但没有持久化 memory mount。
4. settings.json 里的 `autoMemoryEnabled`。
5. 默认开启。

这说明 auto memory 在产品层面是“默认特性”，而不是高阶实验功能。

#### memory 路径的解析顺序

`getAutoMemPath()` 的解析顺序更有意思：

1. `CLAUDE_COWORK_MEMORY_PATH_OVERRIDE`
2. 可信 settings source 中的 `autoMemoryDirectory`
3. 默认路径：`<memoryBase>/projects/<sanitized-git-root>/memory/`

其中默认路径不是按当前 shell cwd 生硬分桶，而是先走 `findCanonicalGitRoot(getProjectRoot()) ?? getProjectRoot()`。也就是说：

> Claude Code 更想把“同一代码仓库的不同 worktree / 子目录”视为同一个记忆单元。

这背后是很明显的协作取向。对人来说，“我正在操作这个 repo”比“我当前在 repo 的哪个目录”更接近一个稳定身份。

### 2.3 `MEMORY.md` 不是正文，而是索引

这是 Claude Code 记忆系统最关键的设计之一。

`src/memdir/memdir.ts` 中 `buildMemoryLines()` 明确规定，保存记忆是两步：

1. 把真正的记忆写到独立 topic file。
2. 在 `MEMORY.md` 中加一行指向该文件的索引。

源码里甚至把这句话写得非常直接：`MEMORY.md` is an index, not a memory。

也就是说，目录形态大致是：

```text
memory/
├── MEMORY.md
├── user_role.md
├── feedback_testing.md
├── project_release_freeze.md
└── reference_dashboards.md
```

其中：

- `MEMORY.md` 提供导航和简要 hook。
- 真正有信息密度的内容在 topic files。

这个设计非常像一个轻量知识库，而不是聊天记录堆。

### 2.4 为什么要限制 `MEMORY.md`：行数上限 + 字节上限

`truncateEntrypointContent()` 是这套系统很“工程化”的一个信号。

它对 `MEMORY.md` 做了双重约束：

- `MAX_ENTRYPOINT_LINES = 200`
- `MAX_ENTRYPOINT_BYTES = 25_000`

并且不是简单粗暴地截断，而是先按行截，再按最后一个换行安全地按字节截，最后补一条 warning。

这说明开发者已经在真实使用中碰到了两个问题：

1. 索引过长，直接挤占 system prompt 预算。
2. 有些索引条目虽然行数不多，但单行极长，导致“行数限制”失效。

因此这里加 byte cap，本质上是在防“超长索引条目”这种现实世界里的退化输入。

### 2.5 Claude Code 明确限制“什么不该进记忆”

`src/memdir/memoryTypes.ts` 是 Persistent Memory 的产品哲学中心。

它把记忆强约束为四种类型：

| 类型 | 作用 |
|------|------|
| `user` | 用户角色、目标、知识背景、偏好 |
| `feedback` | 用户给出的工作方式反馈 |
| `project` | 代码之外的项目状态、决策、截止期、事故背景 |
| `reference` | 外部系统入口，如 Linear、Slack、Grafana、文档 |

与此同时，源码非常明确地排除了另一类内容：

- 代码结构
- 项目架构
- 文件路径
- Git 历史
- 调试方案
- 已存在于 `CLAUDE.md` 的内容
- 当前会话临时状态

这条边界非常重要，因为它说明 Claude Code 的 memory 不是“第二份代码索引”，而是**只存代码外部、又足够 durable 的协作知识**。

换句话说，代码里能推导出来的东西，不值得浪费长期记忆位。

### 2.6 `KAIROS`：长生命周期会话改成 daily log 模式

`memdir.ts` 里还有一个很有意思的分支：`buildAssistantDailyLogPrompt()`。

在 `feature('KAIROS') && getKairosActive()` 条件下，Claude Code 不再让模型实时维护 `MEMORY.md` 索引，而是要求它把新信息按日期 append 到：

```text
<autoMemPath>/logs/YYYY/MM/YYYY-MM-DD.md
```

这个模式下：

- 新信息写进 daily log。
- `MEMORY.md` 继续作为 distilled index 被加载。
- 夜间再靠 dream/consolidation 把日志蒸馏回 topic files + 索引。

这说明团队已经意识到：**在超长生命周期 session 里让主 agent 实时维护结构化索引，成本太高，也太容易漂移**。

因此 KAIROS 的答案是：先写 append-only log，再异步整理。

### 2.7 这一层的本质

Persistent Memory 最核心的结论可以直接下：

> Claude Code 把长期记忆设计成一个文件系统上的知识库，而不是隐藏数据库，也不是无限扩展的 prompt。

这让它天然具备几个优点：

- 可审计，用户能直接看到记忆文件。
- 可编辑，模型和人都能修改。
- 可同步，team memory 可以做文件级同步。
- 可分层，索引与正文可以独立处理。

---

## 三、Recall 不是全量加载，而是“索引常驻 + 正文按需加载”

如果说 Persistent Memory 解决的是“记忆存在哪里”，那 Recall Layer 解决的就是“哪些记忆该在这次 query 里进入模型上下文”。

这一层主要分布在：

- `src/utils/claudemd.ts`
- `src/utils/attachments.ts`
- `src/memdir/findRelevantMemories.ts`

### 3.1 常驻层：`MEMORY.md` 负责方向感

`claudemd.ts` 负责统一发现和读取 memory/instructions 文件。

源码里 `getMemoryFiles()` 会把多类 instruction source 收集起来，其中包含：

- managed memory
- user memory
- project/local `CLAUDE.md`
- auto memory 的 `MEMORY.md`
- team memory 的 `MEMORY.md`

而 `getClaudeMds()` 会把这些文件格式化成系统提示的一部分。

但这里还有一个关键 feature gate：`tengu_moth_copse`。

在这个 gate 打开时，`filterInjectedMemoryFiles()` 会把 `AutoMem` 和 `TeamMem` 从“直接注入系统 prompt”的集合里滤掉。源码注释写得非常直白：

> 当 relevant memory prefetch 存在时，`MEMORY.md` index 不再注入 system prompt。

也就是说，Claude Code 在不同实验阶段里尝试过两种策略：

1. 直接把 `MEMORY.md` 常驻注入。
2. 连 `MEMORY.md` 也走更细粒度的 recall 路径。

无论哪种模式，核心思想都是一样的：**索引优先，正文懒加载**。

### 3.2 `findRelevantMemories()`：不是向量库，而是“小模型挑文件”

`src/memdir/findRelevantMemories.ts` 这部分非常有代表性。

它的工作流程不是 embedding 检索，而是：

1. `scanMemoryFiles()` 扫描 memory 目录里所有 `.md` 文件。
2. 读取每个文件前 30 行 frontmatter。
3. 提取 `filename / description / type / mtimeMs`。
4. 把这些 header 组成 manifest。
5. 调用 `sideQuery()`，让一个 Sonnet 模型从 manifest 里选出最多 5 个“明显相关”的文件。

这等于说 Claude Code 的 recall selector 是一个小型二次推理器，而不是单纯相似度检索。

`SELECT_MEMORIES_SYSTEM_PROMPT` 甚至特意要求：

- 不确定就不要选。
- 最近已经成功使用过的工具文档不要重复选。
- 真正有 warning / gotcha 的内容可以继续选。

这是一种很“Agent-native”的思路：不是用统一向量空间近似一切，而是先把记忆缩成可解释的 manifest，再让模型做一次轻量判断。

### 3.3 查询开始时就异步预取，而不是等主模型卡住

`src/query.ts` 的主循环里有这样一段：

```ts
using pendingMemoryPrefetch = startRelevantMemoryPrefetch(
  state.messages,
  state.toolUseContext,
)
```

这一步发生在 query loop 一开始。也就是说：

- 用户刚发出请求。
- 主模型还在流式生成。
- relevant memory prefetch 已经并行启动。

等到工具调用和 attachment 收集阶段，`query.ts` 再检查 prefetch 是否已经完成。如果完成，就把相关记忆作为 attachment 注入；如果还没完成，就直接跳过，不阻塞这轮 turn。

这是一种非常典型的 latency hiding：

> 记忆召回不是阻塞 query 的前置步骤，而是和主生成链路并行的后台工作。

### 3.4 attachment 注入：不是读盘全文，而是受控 surfacing

`src/utils/attachments.ts` 的 `readMemoriesForSurfacing()` 会把入选的记忆文件读出来，并附上：

- 截断后的正文
- 新鲜度 header
- 如果被截断，给出“请用 FileReadTool 查看完整内容”的提示

header 由 `memoryHeader()` 生成，会把 `mtimeMs` 转成人类可读的新鲜度，比如“saved 3 days ago”。

这意味着 Claude Code 在 recall 阶段不是把文件原封不动塞给模型，而是做了三件事：

1. 标记 freshness。
2. 限制大小。
3. 保留继续显式读取原文的路径。

这本质上是在把 recall 变成一种**受控的只读上下文补丁**。

### 3.5 去重：同一份记忆不会被反复塞给模型

去重逻辑主要靠两套状态：

- `loadedNestedMemoryPaths`
- `readFileState`

`memoryFilesToAttachments()` 和 `filterDuplicateMemoryAttachments()` 都会使用它们。

设计意图很清晰：

- `loadedNestedMemoryPaths` 是不驱逐的 set，避免 LRU 失效后重复注入相同 memory file。
- `readFileState` 负责跨函数、跨 turn 的“模型已经看过什么”。

源码注释里明确提到，之前如果只靠 LRU cache，会出现 busy session 里旧条目被逐出，接着又被重新注入的情况。这是很典型的 Agent 工程问题：**上下文 dedup 不能完全依赖通用 cache**。

### 3.6 这一层的本质

Recall Layer 的结论可以概括成一句话：

> Claude Code 的记忆召回更像“搜索引擎 + 候选文件清单 + 小模型选择 + attachment 注入”，而不是传统意义上的向量数据库黑盒。

它的优势是：

- 可解释：为什么某个记忆被选中，可以追溯到 filename/description。
- 可控：最多 5 个文件，有明确字节和行数限制。
- 便宜：只在真正相关时注入正文。

代价则是需要开发者认真维护 frontmatter 质量，否则 recall 的“目录层语义”会退化。

---

## 四、Session Memory：它不是长期记忆，而是长会话压缩缓存

Persistent Memory 面向未来会话，Session Memory 则完全是另一类东西。

源码位置主要在：

- `src/services/SessionMemory/sessionMemory.ts`
- `src/services/SessionMemory/sessionMemoryUtils.ts`
- `src/services/compact/sessionMemoryCompact.ts`

### 4.1 定位：服务于 compact，而不是服务于“记住用户”

`sessionMemory.ts` 文件开头就写得很清楚：

> Session Memory automatically maintains a markdown file with notes about the current conversation.

注意这里说的是 **current conversation**。

这和 auto memory 最大的差别在于：

- auto memory 关注跨会话可复用事实。
- session memory 关注当前长会话在 compact 之后如何不丢语义。

所以它本质上更接近一个“长期上下文缓存层”。

### 4.2 触发阈值：不是每轮都跑

`shouldExtractMemory()` 里有三类阈值：

| 阈值 | 默认值 | 含义 |
|------|--------|------|
| `minimumMessageTokensToInit` | 10000 | 上下文至少够大，才初始化 session memory |
| `minimumTokensBetweenUpdate` | 5000 | 距上次摘要后，context 至少又增长这么多 |
| `toolCallsBetweenUpdates` | 3 | 工具调用也要积累到一定程度 |

真正触发条件是：

- token 增量阈值满足，且 tool call 阈值满足；或
- token 增量阈值满足，且最近一轮 assistant turn 没有 tool calls。

这体现出很强的“自然停顿点”意识。Claude Code 不想在还在执行工具链时就插入摘要，而更偏向在一个相对完整的工作片段结束时再提炼。

### 4.3 触发机制：post-sampling hook + forked subagent

`initSessionMemory()` 会注册一个 post-sampling hook：

```ts
registerPostSamplingHook(extractSessionMemory)
```

之后每轮结束，hook 判断是否达到阈值。如果达到了：

1. 准备 session memory 文件。
2. 读取当前文件内容。
3. 生成 update prompt。
4. 用 `runForkedAgent()` 启动一个隔离子 agent 来更新这个文件。

这意味着主线程不会直接“顺手总结一下”，而是把会话摘要也交给了**后台分叉 agent**。

### 4.4 权限极窄：只允许 Edit 这个文件

这层设计里最值得点名的是权限收缩。

`createMemoryFileCanUseTool()` 明确规定，session memory subagent 唯一被允许的写操作是：

- `FileEditTool`
- 目标必须是 session memory 对应的那个精确文件路径

除此之外一律 deny。

这说明 session memory 被实现成了一个非常保守的后台 worker：

- 它可以总结。
- 它不能乱读乱写其他地方。
- 它不是一个拿着完整工具箱的 autonomous agent。

### 4.5 compact 时会等待摘要完成，再把摘要带过去

`src/services/compact/sessionMemoryCompact.ts` 又把这套机制闭合起来了。

这里有两件重要的事：

1. compact 之前会 `waitForSessionMemoryExtraction()`，避免边 compact 边写摘要造成状态错位。
2. compact 时会读取 `getSessionMemoryContent()`，把 session memory 作为压缩后保留上下文的一部分。

所以 Session Memory 的真正角色是：

> 在长对话被 compact 之前，提前做出一份会话内摘要，以降低 compact 造成的语义损失。

### 4.6 这一层的本质

这一层非常适合一句话总结：

> Session Memory 不是用户长期偏好库，而是长会话压缩辅助层。

如果把 auto memory 看成 repo 外部知识库，那 session memory 更像当前对话的 checkpoint。

---

## 五、写入链路：主 Agent 没记住的，后台再补一次

Claude Code 真正“记忆闭环”的关键不在 prompt，而在 turn 结束后的 stop hooks。

相关代码分布在：

- `src/query/stopHooks.ts`
- `src/services/extractMemories/extractMemories.ts`
- `src/services/extractMemories/prompts.ts`

### 5.1 `handleStopHooks()`：turn 结束时的后台调度器

`query.ts` 在一次 turn 结束时会进入 `handleStopHooks()`。

这个函数并不只负责一个 stop hook，而是会在非 bare 模式下并行触发一批后台工作，包括：

- prompt suggestion
- extract memories
- autoDream

源码中的注释直接写了：

```ts
// --bare / SIMPLE: skip background bookkeeping
// (prompt suggestion, memory extraction, auto-dream)
```

也就是说，Claude Code 把 memory maintenance 明确视为一类后台 housekeeping。

### 5.2 `extractMemories`：不是重跑全文，而是只看新增消息

`extractMemories.ts` 的闭包状态里维护了一个 `lastMemoryMessageUuid`，用来标记上次处理到哪里。

每次 runExtraction 时，它只看：

- 自上次 cursor 之后新增的 model-visible messages

而不是整段历史重扫一遍。

这意味着 memory extraction 是**增量处理**，不是全量重建。

### 5.3 如果主 Agent 已经直接写了 memory，后台提取就跳过

这是这套系统最漂亮的协调点之一。

`hasMemoryWritesSince()` 会扫描 assistant 消息中的 `tool_use` block，检查最近是否已经对 auto memory 路径做了 `Write/Edit`。

如果主 agent 已经直接写入 memory 文件，后台 extraction 会：

- 直接跳过
- 把 cursor 前移
- 记录 `tengu_extract_memories_skipped_direct_write`

这等于说 Claude Code 有两条写入通道：

1. 主 agent 当场记忆。
2. 后台 extraction 补记忆。

二者不是竞争关系，而是互补关系。

### 5.4 提取 agent 复用 prompt cache，但权限高度收缩

`runForkedAgent()` 是 extraction 的核心执行器。

它复用了父会话的 cache-safe params，这样 memory extraction 不需要重新构建一整套新上下文，能吃到 prompt cache 红利。

但在权限上，`createAutoMemCanUseTool()` 非常克制，只允许：

- `FileRead`
- `Grep`
- `Glob`
- 只读 `Bash`
- `FileEdit` / `FileWrite`，且目标必须在 memory dir 内

其它工具，尤其是 MCP、Agent、可写 Bash，一律 deny。

这是非常典型的“高上下文继承 + 低权限执行”设计。

### 5.5 extraction prompt 明确禁止“再去查代码验证”

`src/services/extractMemories/prompts.ts` 里最有意思的一句话是：

> Do not waste any turns attempting to investigate or verify that content further.

也就是 extraction subagent 不应该去 grep 代码、查 git、验证实现细节。它的职责只是在**最近消息**里提取 durable memory。

这条约束背后非常合理：

- 记忆提取关注的是对话中刚刚出现的外部知识。
- 它不是第二个 code review agent。
- 如果放任它继续探索，会把本来 cheap 的后台任务变成昂贵的 rabbit hole。

### 5.6 `MEMORY.md` 更新只是机械索引维护

`extractMemories.ts` 对写入结果还有个细节处理：

- 如果写入的是 `MEMORY.md`，把它当成机械索引更新。
- 真正计入“memory saved”的是 topic file。

这再次说明在 Claude Code 的世界里：

> `MEMORY.md` 是入口，不是知识本体。

### 5.7 这一层的本质

写入链路的核心结论可以概括成：

> Claude Code 用“主 agent 直接记忆 + 后台 extraction 补记忆”的双通道，尽量降低漏记概率，同时避免两者互相踩踏。

这比单纯依赖模型“记得自己去写 memory”稳健得多。

---

## 六、AutoDream：更慢、更重、也更像真正的 consolidation

如果 extractMemories 是“每轮小修小补”，那 `autoDream` 就是更慢频、更大粒度的记忆整理器。

核心文件是：

- `src/services/autoDream/autoDream.ts`
- `src/services/autoDream/consolidationLock.ts`
- `src/tasks/DreamTask/DreamTask.ts`

### 6.1 触发条件：时间门槛 + 会话数门槛 + 锁

`autoDream.ts` 文件开头已经把 gate order 写成注释：

1. 距上次 consolidation 经过了足够时间。
2. 自上次 consolidation 以来累计了足够多会话。
3. 没有其它进程已经在做 consolidation。

默认值是：

- `minHours = 24`
- `minSessions = 5`

这说明 autoDream 明确不是“每轮运行”的功能，而是**低频后台整理**。

### 6.2 输入不是当前 turn，而是多个 session transcript

`listSessionsTouchedSince(lastAt)` 会列出上次 consolidation 之后活跃过的 session。

再结合 `getProjectDir(getOriginalCwd())` 提供的 transcript 目录，autoDream 的输入范围明显比 extractMemories 大很多：

- 它不是只看最近几条消息。
- 它是在看多个 session 的累积痕迹。

因此它适合做：

- 去重
- 归并
- 把零散日志蒸馏成稳定主题

### 6.3 输出仍然是 memory 目录，而不是另建存储系统

即便是 AutoDream，这套系统也没有引入额外数据库。

它仍然通过 `createAutoMemCanUseTool(memoryRoot)` 受限地写回原有 memory 目录。

这一点很关键，因为它表明 Claude Code 的 memory architecture 从头到尾都在坚持一个原则：

> 所有长期记忆最终都回到同一个文件系统表示层。

没有出现“实时 memory 一套格式、后台 consolidation 另一套格式”的分裂。

### 6.4 `DreamTask`：后台整理是可观测的

AutoDream 不是偷偷在后台跑。

`registerDreamTask()`、`addDreamTurn()`、`completeDreamTask()` 和 UI 里的 `DreamDetailDialog` 表明，这个后台过程在产品层面是可见的。

用户或系统至少能看到：

- 当前 dream 是否在运行
- 看过多少 sessions
- touched 了哪些文件
- 过程中 agent 说了什么

这对于“让 AI 自己维护长期记忆”来说很重要，因为可观测性直接决定用户是否敢信任它。

### 6.5 和 `KAIROS` 的关系：日志先行，dream 蒸馏

前面提到，KAIROS 模式下主 agent 更倾向往 daily log 里 append，而不是实时维护索引。

AutoDream 正好补上这一步：

- daily log 负责低摩擦记录。
- autoDream 负责周期性 consolidation。
- 最终产出稳定 topic files 与 `MEMORY.md`。

这个组合非常像日志系统里的：

- write-ahead log
- background compaction

只不过对象从 KV 数据变成了协作记忆。

### 6.6 这一层的本质

AutoDream 非常适合被概括成一句话：

> 它是 Claude Code 记忆系统里的 garbage collection + summarization + re-indexing。

前台记录可以粗糙，后台整理再把它们收敛成更稳定的知识形态。

---

## 七、Team Memory 与 Agent Memory：开始回答“这份记忆属于谁”

到这里为止，Persistent Memory 已经很像一个个人知识库了。但 Claude Code 没停在这里，它还继续把“记忆归属”做成了一等概念。

### 7.1 Team Memory：private 与 team 两层目录

`src/memdir/teamMemPrompts.ts` 和 `src/memdir/teamMemPaths.ts` 共同定义了 Team Memory 模式。

在该模式下，memory 从单目录变成双目录：

- private directory：个人私有
- team directory：项目共享

prompt 里甚至会明确写出两者的含义：

- private 只在当前用户之间持久化
- team 会在该项目内同步给其他协作者

这不是让模型自由发挥“这个应该共享吗”，而是把 scope 规则塞进 type taxonomy 本身。

例如 `feedback` 类型不是简单写“shared or private”，而是：

- 默认 private
- 只有明确属于项目公共约束时才写 team

这就是很典型的 **prompt-level policy encoding**。

### 7.2 Team Memory 的安全边界做得很重

`src/memdir/teamMemPaths.ts` 是整套记忆系统里安全味最浓的文件之一。

里面显式防了多种路径攻击：

- null byte
- URL 编码 traversal
- Unicode NFKC 归一化绕过
- 反斜杠路径分隔符注入
- 绝对路径注入
- symlink escape
- dangling symlink
- symlink loop

尤其是 `realpathDeepestExisting()` 和 `isRealPathWithinTeamDir()` 这套逻辑，说明作者不是只停留在 `path.resolve()` 层面，而是意识到了：

> `resolve()` 能消除 `..`，但不能解决 symlink 把路径“带出 teamDir”的问题。

这已经是很成熟的文件系统安全思维了。

### 7.3 Team Memory 还支持远端同步

`src/services/teamMemorySync/index.ts` 显示 Team Memory 并不只是本地共享目录。

它有一个完整的同步服务：

- `GET /api/claude_code/team_memory`
- `PUT /api/claude_code/team_memory`

并且语义也写得很清楚：

- pull 时 server wins
- push 时只上传 checksum 改变的条目
- 删除不传播

这表明 Team Memory 的目标不是做强一致协作文档，而是做**尽量稳妥的共享知识层**。

从产品角度看，这也合理：记忆最怕误删和冲突，保守同步比“全量双向删除同步”更安全。

### 7.4 Agent Memory：不是“这个用户的记忆”，而是“这个 agent 角色的记忆”

`src/tools/AgentTool/agentMemory.ts` 又向前走了一步。

这里定义了三种 scope：

- `user`
- `project`
- `local`

但它们不是人类用户 scope，而是某个 agent type 的 memory scope。

目录结构大致是：

```text
user scope:    <memoryBase>/agent-memory/<agentType>/
project scope: <cwd>/.claude/agent-memory/<agentType>/
local scope:   <cwd>/.claude/agent-memory-local/<agentType>/
```

这说明 Claude Code 已经把“某个专门 agent 如何随着使用逐渐变聪明”视为独立问题。

也就是说：

- auto memory 更像主 assistant 对用户/项目的长期知识。
- agent memory 更像某个角色型 agent 自己的经验库。

### 7.5 Agent Memory Snapshot：项目可以给 agent 下发初始记忆

`src/tools/AgentTool/agentMemorySnapshot.ts` 进一步说明了 Agent Memory 的产品方向。

它支持：

- 检查 snapshot 是否存在
- 第一次初始化时从 snapshot 拷贝
- snapshot 更新后提示替换本地记忆

这几乎等于说：项目维护者可以给某个 agent type 提供一份“预训练好的本地经验模板”。

这已经不是简单的“会话记忆”，而是开始触及**Agent persona bootstrapping**。

### 7.6 这一层的本质

这一层的结论非常明确：

> Claude Code 已经把“这份记忆属于谁”提升成了一等设计维度。

记忆不再只有“长期/短期”之分，还开始区分：

- 属于当前用户
- 属于整个团队
- 属于某个 agent 角色

这恰恰是单人聊天机器人和协作型 agent 平台之间的分水岭。

---

## 八、关键接口地图：把整套系统串起来

如果把本文涉及的主要接口按层次重新排一下，Claude Code 的记忆系统大致可以归纳为下面这张“函数地图”：

| 层次 | 关键接口 | 作用 |
|------|----------|------|
| Persistent Memory | `loadMemoryPrompt()` / `buildMemoryLines()` / `truncateEntrypointContent()` | 定义记忆机制、生成记忆系统提示、限制 `MEMORY.md` 索引尺寸 |
| Query-time Recall | `startRelevantMemoryPrefetch()` / `findRelevantMemories()` / `filterDuplicateMemoryAttachments()` | 查询开始时异步找相关记忆，并在注入前做去重 |
| Session Memory | `initSessionMemory()` / `shouldExtractMemory()` / `manuallyExtractSessionMemory()` | 启动会话摘要机制、判断是否自动提取、支持手动触发 |
| Background Extraction | `executeExtractMemories()` / `createAutoMemCanUseTool()` | turn 结束后后台提取 durable memory，并对后台 agent 做权限收缩 |
| Consolidation | `executeAutoDream()` | 在时间和会话数满足条件后做跨 session 的 consolidation |
| Team / Agent 扩展 | `buildCombinedMemoryPrompt()` / `getAgentMemoryDir()` | 处理 private/team 双目录和 agent 级记忆目录解析 |

把这些函数放在一起看，会发现 Claude Code 并没有试图用一个“万能记忆 API”解决所有问题，而是让每一层只负责自己那部分生命周期：

- prompt 负责定义规则；
- recall 负责选哪些记忆进入本轮上下文；
- session memory 负责长对话摘要；
- extraction 负责把新知识回填到持久层；
- autoDream 负责慢频整理；
- team / agent memory 负责记忆归属。

这其实正是分层架构成熟的标志。

---

## 九、安全模型与关键设计取舍

如果只从“功能很多”来描述 Claude Code 的记忆系统，其实会漏掉最重要的一层：**它为什么要长成这样**。

### 9.1 为什么 project settings 不能随便指定 auto memory 目录

`paths.ts` 里的 `getAutoMemPathSetting()` 特地排除了 `projectSettings`，只允许：

- policy settings
- flag settings
- local settings
- user settings

源码注释已经把原因说透了：

如果仓库内的 `.claude/settings.json` 可以任意指定 `autoMemoryDirectory`，恶意 repo 就能把 memory 定向到如 `~/.ssh` 这样的敏感目录，并借助 memory 的写权限 carve-out 形成静默写入风险。

这说明作者非常清楚：

> “项目可提交配置”和“用户信任边界”不能混在一起。

### 9.2 为什么 memory 目录会获得读写豁免

`src/utils/permissions/filesystem.ts` 里可以看到：

- auto memory files 可以无提示读取
- 在默认路径下，auto memory files 还可以获得无提示写入

原因并不神秘：默认 memory 路径在 `~/.claude/` 下，而这个目录本来会被危险目录规则拦住。如果不做 carve-out，memory 系统自己就没法顺畅工作。

但这里也没有无限放权。

对于 `CLAUDE_COWORK_MEMORY_PATH_OVERRIDE` 这种调用方显式指定的 override path，源码特地取消了 silent write carve-out，要求仍然走普通权限流。

也就是说，Claude Code 的原则是：

- 平台自己定义、可预期的 memory 目录，可以内建豁免。
- 外部调用方随意指定的目录，不自动信任。

### 9.3 为什么 Bash 只允许只读

无论是 `extractMemories` 还是 `autoDream`，后台 agent 的 shell 能力都被限制为只读。

这点看似保守，实际上很合理：

- 这些 agent 本质是“知识整理工人”，不是主执行 agent。
- 允许写 bash 就意味着能绕过 file-level permissions，甚至修改工作区。
- memory maintenance 最怕的不是做少了，而是做过头。

所以 Claude Code 宁可让这些后台 agent 笨一点，也不愿给它们扩大副作用面。

### 9.4 为什么 `MEMORY.md` 必须索引化

如果 `MEMORY.md` 直接存正文，系统会很快遇到三个问题：

1. system prompt token 膨胀。
2. 每次 recall 都是全量读取，无法懒加载。
3. 粗粒度修改容易引发冲突和漂移。

把它改成 index 后：

- 常驻上下文只保留方向感。
- 具体内容按需读入。
- topic files 可以独立更新和去重。

这其实和搜索系统里“倒排索引 vs 原文档”的关系非常像。

### 9.5 为什么不把代码结构、Git 历史、`CLAUDE.md` 重复存进 memory

`memoryTypes.ts` 里这些排除规则，表面上是产品文案，实际上对应非常明确的系统策略：

- 代码结构属于 repo 当前态，读代码即可。
- Git 历史属于 VCS，`git log` 才是权威。
- `CLAUDE.md` 属于 instruction system，本就有独立注入链路。

如果把这些再写进 memory，会产生双份事实源，最后只会制造漂移。

所以 Claude Code 的 memory 明显在刻意避免沦为“杂项缓存桶”。

### 9.6 为什么 recall 选择 frontmatter + side query，而不是全量 embedding

从源码看，Claude Code 明显没有把 memory system 建在统一向量索引上，而是选择：

- frontmatter 描述
- 目录扫描
- 小模型选择

这么做的好处有三个：

1. **可解释**：为什么选中这个文件，一看描述就知道。
2. **低耦合**：不需要单独维护 embedding pipeline。
3. **可编辑**：用户直接改 markdown frontmatter，就能影响 recall 行为。

代价当然也有：

- 召回质量依赖描述文本质量。
- 大规模 memory 目录下扫描成本可能上升。

但对 Claude Code 这种面向真实协作场景的工具来说，这个权衡很合理，因为“可见、可改、可审计”比“理论最优检索精度”更重要。

### 9.7 四个关键词

如果必须把整套设计压缩成四个词，我会选：

- `file-based`
- `typed`
- `lazy-loaded`
- `background-maintained`

这四个词基本概括了 Claude Code 记忆系统和很多“带一点长期上下文功能”的 Agent 之间的本质差异。

---

## 十、结尾：这不是一个 feature，而是一套分层记忆架构

回头看整份源码，Claude Code 的记忆系统最值得注意的不是某个单独函数有多巧，而是它的分层非常清楚：

- `Persistent Memory` 负责长期、文件化、可审计的 durable knowledge。
- `Session Memory` 负责长会话 compact 之前的摘要缓存。
- `Recall / Consolidation Layer` 负责按需召回、turn 结束提取和跨会话整理。

这些层之间不是简单堆叠，而是有明确分工：

- 索引常驻，正文按需。
- 主线程可直接写，后台 worker 负责补漏。
- 高频 extraction 做增量，小频 dream 做整理。
- scope 从个人一路扩展到团队和 agent 角色。

所以，Claude Code 的“记忆”本质上并不是一个单点能力，也不是一个数据库接口，而是：

> 一套围绕 token 成本、长期协作、权限边界和后台异步维护构建出来的分层记忆架构。

这也许才是这份泄露源码最有价值的地方。它让我们看到，真正进入生产环境的 Agent 记忆系统，并不是“记住更多内容”这么简单，而是要同时回答四个问题：

- 什么值得长期保存？
- 什么应该在这次 query 里被看见？
- 什么应该由后台慢慢整理？
- 这份记忆究竟属于谁？

而 Claude Code 给出的答案，是目前我见过最工程化、也最接近真实协作软件的一种实现。
