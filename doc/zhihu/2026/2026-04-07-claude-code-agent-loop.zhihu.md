# Claude Code 源码拆解：Agent Loop 为什么能一直思考、调用工具、自动恢复？

2026 年 3 月末，随着 Claude Code 源码因意外泄露的 `.map` 文件而公开，我们终于能直接看到一个生产级 AI Agent 的内部循环是怎么写出来的。

很多人把 Agent 理解成“模型输出一下，调用个工具，再输出一下”。但真正能进生产环境的 Agent，难点从来不在“会不会调工具”，而在另一面：上下文会爆、输出会截断、工具有副作用、流式过程会失败、hook 会插入新消息、压缩如果做不好还会把自己压死。

Claude Code 的 `queryLoop` 正是在解决这些问题。它不是一个简单的问答循环，而是一个负责状态推进、上下文压缩、工具并发、错误恢复和终止判定的执行内核。

这篇文章我想回答四个问题：

- 它的主循环骨架到底长什么样。
- 为什么它要做五层上下文压缩。
- 工具执行为什么能和流式输出并行。
- 遇到 413、输出截断、媒体过大时，它是怎么自救的。

说明：本文所有代码来自公开泄露的源码，仅用于技术研究目的。

## 一、先建立心智模型：Agent Loop 在整个系统里的位置

先别急着看 `while (true)`。如果不先知道它在整个调用栈中的位置，很容易把它误判成一个“超级大的函数”。

Claude Code 的对话引擎大体可以分成两层：

```text
SDK / REPL / headless 调用方
  -> QueryEngine
     - 维护会话级状态
     - 管权限、transcript、缓存和最终结果组装
  -> query()
     - 单次 turn 的薄封装
  -> queryLoop()
     - 真正的主循环
     - 负责思考、调用工具、压缩上下文、错误恢复
  -> model API
```

这里最重要的区别是：

- `QueryEngine` 面向整个会话生命周期。
- `queryLoop()` 只面向“当前这一次 turn 怎么跑完”。

所以 `queryLoop()` 的职责不是保存长期状态，而是把这一轮用户请求推进到一个确定的终点。这个终点可能是正常完成，也可能是 `max_turns`、`prompt_too_long`、`image_error` 等受控退出。

理解这层边界后，后面很多设计就顺了。比如为什么工具执行上下文和消息数组都在 loop 内部传递，为什么它特别在意“继续下一轮”的原因，为什么 stop hooks 会在循环里而不是引擎外部触发。

## 二、骨架其实很朴素：`while (true)` 加一个可变 State

Claude Code 的核心状态并没有被拆成一堆小对象来回传，而是集中放进一个 `State`：

```typescript
type State = {
  messages: Message[]
  toolUseContext: ToolUseContext
  autoCompactTracking: AutoCompactTrackingState | undefined
  maxOutputTokensRecoveryCount: number
  hasAttemptedReactiveCompact: boolean
  maxOutputTokensOverride: number | undefined
  pendingToolUseSummary: Promise<...> | undefined
  stopHookActive: boolean | undefined
  turnCount: number
  transition: Continue | undefined
}
```

这套写法看起来很“传统”，但其实很适合 Agent 这种长循环。

如果用递归来表示“工具执行完后再继续思考”，调用栈会随着轮次变深；再加上流式资源、预取任务和错误恢复，清理成本会越来越高。用 `while (true)` 加 `state = nextState; continue`，反而更稳定。

里面我最喜欢的是 `transition` 字段。它不是业务必需字段，而是一个专门暴露“这次为什么会继续循环”的可测试钩子。它让测试可以直接断言：

- 这次是普通下一轮。
- 这次是 `collapse_drain_retry`。
- 这次是 `reactive_compact_retry`。
- 这次是 `max_output_tokens_recovery`。

这类设计很工程化。因为 Agent 的很多恢复路径最终都会重新回到同一个主循环，如果没有一个显式 transition，你就只能靠消息内容去猜这轮发生了什么。

同样很重要的还有两层外围设计：

- `buildQueryConfig()`：把 feature gate 和环境变量快照成普通布尔值，避免边跑边读动态配置。
- `productionDeps()`：把 `callModel`、`microcompact`、`autocompact`、`uuid` 等 I/O 依赖注入出去，让核心循环可以被完整替换和测试。

也就是说，这个大循环虽然长，但并不是“泥球式代码”。它有清晰的状态面和 I/O 边界。

## 三、每次迭代实际上在做什么

如果把一轮迭代压缩成一句话，它做的是：

先尽量把上下文整理到可发送状态，再调用模型；模型一边流式输出，一边并发执行可安全的工具；最后根据输出结果决定是继续、恢复、重试还是结束。

源码里的执行顺序，大致可以整理成下面这样：

```text
1. 启动技能发现和记忆预取
2. 对超大 tool_result 做预算裁剪
3. 做 history snip / microcompact / context collapse / autocompact
4. 发起 callModel() 流式请求
5. 边收消息边把 tool_use 交给 StreamingToolExecutor
6. 判断是否发生 PTL、max_tokens、media size 等可恢复错误
7. 执行 stop hooks
8. 收尾工具结果、附件注入、刷新工具列表
9. 组装 next state，继续下一轮，或返回 terminal
```

这里最值得注意的是前半段的节奏。Claude Code 并不是“先问模型，出问题再补救”，而是每次在请求前都做一轮上下文卫生处理。

这意味着它把上下文健康当成常规路径，而不是异常路径。

比如 `applyToolResultBudget()` 会先处理超大工具输出，把内容替换成持久化引用；skill discovery 和 memory prefetch 会在一开始就异步启动，尽量把等待隐藏到模型流式阶段；context collapse 和 autocompact 则把便宜压缩和昂贵压缩分层处理。

这种节奏感很重要。因为真正的 Agent loop 不只是“不断追加消息”，而是“不断维护一个还能继续工作的消息历史”。

## 四、Claude Code 为什么要做五层上下文压缩

Claude Code 最有代表性的地方，不是它会 compact，而是它不把 compact 设计成唯一手段。

它做的是一整套从轻到重的梯级体系。

### 1. 工具结果预算裁剪

最轻的一层是 `applyToolResultBudget()`。

思路很直接：如果某个 `tool_result` 太大，就不要每轮都原样塞回模型，而是把原始内容持久化下来，消息里只保留替代引用。这样做的意义不在“总结信息”，而在“避免请求体先被大结果撑爆”。

这一步每轮都会跑，是最基础的体积控制。

### 2. History Snip

`History Snip` 不是暴力删消息，而是做“标记删除”。

这类设计的好处是：

- UI 或调试层仍然能知道历史存在过。
- 真正发给 API 时，可以投影成一个更干净的视图。
- 一旦和 compact 边界、缓存前缀协同起来，行为会比物理删除更安全。

它本质上是逻辑视图层，不是数据销毁层。

### 3. Microcompact

这一层很像“局部清理工”。

Claude Code 会针对 Bash、Read、Grep、Glob、WebFetch 这类读取型工具的旧输出做替换，把它们清成类似“旧工具结果已清理”的占位文本。因为这些输出通常只在刚生成的那一刻最有价值，后面继续原样保留只是浪费上下文。

另外它还有一个很真实的分支：如果距离上次 assistant 输出已经很久了，比如超过一个 prompt cache 的有效窗口，那缓存前缀反正也要重建，不如顺手把旧工具结果一起清掉，减少请求体积。

这说明 Claude Code 的压缩不只是看 token，也在看缓存生命周期。

### 4. Context Collapse

`Context Collapse` 是我觉得特别像“生产事故产物”的设计。

它不是一上来就把某段消息压掉，而是先把候选折叠放进暂存队列，等到合适时机再提交。这样可以避免过早损失信息密度，同时保留一个在 PTL 到来前还能紧急排水的缓冲带。

一旦 API 返回 413，系统会优先尝试把这些暂存折叠一次性消化。如果光靠这一步就能把 token 数拉下来，就没必要立刻进入更贵的 reactive compact。

所以它可以被理解成：正式压缩之前的最后一道低成本防线。

### 5. Autocompact

最重的一层才是真正意义上的 conversation compact。

它的触发逻辑不是“快满了再说”，而是预留出一段显式缓冲区，避免在最危险的边缘上才行动。进入 compact 之后，Claude Code 还会优先尝试 session memory 路径，如果已有会话摘要，就只压新增部分；不行再走全量摘要。

这条链路里有几个细节特别说明它已经在生产里打磨过很久：

- compact 前会执行 pre-compact hooks。
- 摘要本身如果过长，也会再做 PTL 重试。
- compact 完成后还会清理 microcompact 状态和相关缓存。
- 连续失败有断路器，避免“压缩失败后疯狂重试”。

源码注释里提到，没加断路器之前，曾经出现过几千次连续失败，每天白白浪费大量 API 调用。你一看到这种注释，就知道这不是纸上设计，而是被线上问题逼出来的。

### 6. 还有一层被动响应：Reactive Compact

除了主动压缩，Claude Code 还保留了一条被动路径。

当 API 已经真实返回 `prompt_too_long` 或者媒体尺寸错误时，它会把错误先 withholding，不马上 surface 给上层，而是尝试走一次 reactive compact。只有恢复失败，才真正把错误抛出来。

这个 withholding 机制很关键。因为如果错误消息先被暴露给 SDK 调用方，外层往往会直接认为会话失败，不会再给内部恢复留机会。

## 五、工具执行为什么能和流式输出并行

普通实现里，Agent 往往是这样的：

1. 等模型完整吐出一条 assistant 消息。
2. 扫描其中的 `tool_use`。
3. 依次执行工具。
4. 再把结果发回模型。

Claude Code 的 `StreamingToolExecutor` 把这个时序改了。

```text
模型流式输出 text -> text -> tool_use A -> tool_use B
                    |                   |
                    v                   v
                 执行 A              执行 B
```

也就是说，工具不是等模型说完才执行，而是在流式过程中一旦发现 `tool_use` 块，就尽快调度起来。

不过这里不是“无脑并发”。每个工具都要声明 `isConcurrencySafe(input)`，然后交给执行器判定是否能和当前正在跑的工具并行：

```typescript
function canExecuteTool(isConcurrencySafe: boolean): boolean {
  const allCurrentAreConcurrent = executingTools.every(t => t.isConcurrencySafe)
  return isConcurrencySafe && allCurrentAreConcurrent
}
```

这个策略很实用：

- Bash 这类可能改文件、改环境的工具必须独占。
- Read、Grep 这类只读工具可以彼此并行。

于是 Claude Code 在性能和正确性之间找到了一个中间点：既不是保守到全串行，也不是激进到什么都一起跑。

还有两个流式细节也很关键。

第一个是 fallback tombstone。主模型如果中途不可用，需要切换 fallback 模型，已经流出的 assistant 消息会被发 tombstone，然后中间状态和正在执行的工具都被清掉。因为这些半成品里可能带着 thinking 签名或不完整的 tool 序列，强行复用会把后续消息历史搞坏。

第二个是 `yieldMissingToolResultBlocks()`。如果流式过程中抛错，系统会给所有已经出现过的 `tool_use` 补一条错误 `tool_result`，保证消息序列仍然合法。这个设计特别细，但很重要，因为很多模型 API 对 tool_use/tool_result 的配对关系要求非常严格。

## 六、Stop Hooks：Claude Code 给外部逻辑留的插口

主模型输出结束后、工具结果真正收尾之前，Claude Code 还会执行一层 `Stop Hooks`。

这一层不是单纯的“跑几个用户脚本”，而是一个统一的拦截点。它可以承接：

- 任务分类
- 提示建议
- 记忆提取
- autoDream
- 用户自定义 stop hooks
- 特定模式下的 teammate 协调逻辑

其中 stop hook 本身的返回值会直接影响循环走向：

- 返回 blocking error：把新消息追加进历史，再查一轮。
- 返回 `preventContinuation`：终止整个主循环。
- 什么都不返回：允许继续。

这层机制有两个意义。

第一，它给 Claude Code 的“可定制行为”提供了一个正式接入口，而不是让各种旁路逻辑偷偷塞到主循环中间。

第二，它和错误恢复路径之间做了明显隔离。比如在 PTL 场景下，系统就不会再进入 stop hooks 的正常注入流程，因为再加消息只会让 413 更严重。

这种“哪些地方允许扩展，哪些地方坚决不扩展”的边界感，是 production agent 很难但很重要的一部分。

## 七、三条最关键的错误恢复路径

如果说上下文压缩解决的是“尽量别出事”，那恢复路径解决的就是“出了事之后怎么办”。

Claude Code 最关键的恢复链有三条。

### 1. Prompt Too Long / API 413

这条路径的处理顺序非常克制：

```text
API 413
-> 先 withholding 错误
-> 尝试 drain 已暂存的 context collapse
-> 还不行就做 reactive compact
-> 仍失败才 surface 错误并退出
```

它不直接进 stop hooks，也不立刻终止。原因很简单：这时系统最需要的是少发内容，而不是再生成更多内容。

### 2. `max_output_tokens`

模型回答到一半被输出上限切断时，Claude Code 不是只会说“失败了”，而是有一个三步恢复策略。

第一步，如果当前还没抬高输出上限，先把 `maxOutputTokensOverride` 升到更高档位。

第二步，如果还不够，就插入一条 meta 消息，要求模型“直接从中断处续写，不要道歉，不要复述前文”。

第三步，这种续写最多尝试固定次数，耗尽后才真正 surface 错误。

这一点看起来像小优化，实际上直接影响成品体验。因为很多长输出任务并不是模型真的不会做，而只是被 token cap 硬切断。

### 3. 媒体尺寸过大

图片或 PDF 过大时，路径和 PTL 类似，但更聚焦：它不会先尝试 context collapse，因为 collapse 无法去掉超大媒体本身，而是直接看 reactive compact 能不能救回来。

同时它也复用了 `hasAttemptedReactiveCompact` 这类防螺旋标记，避免“压一次还超限，再压一次，再超限”的死循环。

这三条路径放在一起看，会发现 Claude Code 的恢复不是一个统一 catch-all，而是按失败原因做分层处理。对于 Agent 这种复杂状态机来说，这一点非常关键。

## 八、为什么这段主循环值得反复读

把 `queryLoop` 全部拆开以后，我觉得最值得记住的不是某个 if 分支，而是它背后的三条工程原则。

第一，真正的 Agent loop 不是“模型采样器”，而是“状态推进器”。

它需要维护消息历史、上下文预算、工具状态、恢复次数、hook 结果和终止条件。模型输出只是其中一个输入，不是全部。

第二，可靠性来自分层，而不是来自某个神奇策略。

Claude Code 不是靠一次 compact 解决所有问题，也不是靠一次 retry 解决所有错误。它把预算裁剪、局部清理、折叠、主动压缩、被动压缩和错误恢复串成了一整套梯级系统。

第三，可测试性和可扩展性必须提前写进去。

`transition`、依赖注入、配置快照、tool executor、stop hooks，这些东西看似增加了结构复杂度，但如果没有它们，这个循环会很快变成不可测、不可控也不可扩展的黑盒。

如果你在做自己的 Agent 框架，我觉得 Claude Code 这段源码最有价值的启发不是“照抄它的实现”，而是理解它到底在防什么：

- 防上下文慢性膨胀。
- 防工具执行把时序拖死。
- 防错误恢复自己制造死循环。
- 防扩展逻辑把主链路污染到不可维护。

这也是为什么我会觉得，`queryLoop` 才是 Claude Code 最值得深挖的核心之一。它把“能工作”和“能长期稳定工作”之间那道最难的鸿沟，尽量用工程手段填平了。

如果读完这篇你只留下一个印象，我希望是这个：生产级 Agent 的主循环，本质上是一个精心设计的故障处理系统，而不是一个会调工具的聊天循环。
