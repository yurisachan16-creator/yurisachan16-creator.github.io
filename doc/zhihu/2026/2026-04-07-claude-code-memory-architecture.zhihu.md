# Claude Code 源码拆解：它的记忆系统到底是怎么工作的？

2026 年 3 月 31 日，Anthropic 在 npm 发布包中意外暴露了 `.map` 文件，使 Claude Code CLI 的完整 TypeScript 源码得以公开。继上一篇对整体架构的拆解之后，这次我想集中聊一个更容易被误解、但也更能体现产品成熟度的部分：记忆系统。

很多人一提到“AI Agent 有记忆”，会立刻想到向量库、数据库，或者“把历史消息一直往 prompt 里叠”。但 Claude Code 这套实现真正有意思的地方，恰恰在于它没有把记忆做成一个单点黑盒。

它拆出来的是一整条流水线：

- 持久化记忆放在文件系统里。
- 查询开始时按需召回最相关的记忆。
- 长会话会维护一份 session memory，专门服务 compact。
- turn 结束后后台提取 durable facts。
- 多会话积累之后再由 autoDream 慢慢整理。
- 再往上，还有 team memory 和 agent memory，开始回答“这份记忆属于谁”。

所以这篇文章想回答的不是“Claude Code 有没有记忆”，而是另一个更实在的问题：

它到底把“记忆”拆成了哪些层，每一层各负责什么，又为什么要这么拆。

说明：本文仅用于教育目的与安全研究，分析对象来自一次公开传播的源码快照，不涉及任何恶意用途。

## 一、总图先看明白：这不是一个模块，而是一条流水线

如果只看 `src/memdir/memdir.ts`，你可能会以为 Claude Code 的记忆系统不过是 `~/.claude/.../memory/` 下面的一堆 Markdown 文件。

但沿着 `QueryEngine`、`query.ts`、`attachments.ts`、`stopHooks.ts` 这条调用链一路看下去，会发现它其实更像下面这套流程：

```text
用户对话
  -> system prompt 注入记忆机制说明
  -> MEMORY.md 作为入口索引进入上下文
  -> query 开始时异步预取 relevant memories
  -> 只把最相关的 topic files 作为 attachment 注入
  -> turn 结束后后台 extractMemories
  -> 新的 durable facts 写回 memory 目录
  -> 多会话累积后触发 autoDream
  -> 把零散记录重新蒸馏成 topic files + MEMORY.md
```

这一张图很关键，因为它揭示了 Claude Code 的基本判断：

记忆不等于上下文。

上下文解决的是“这次采样模型看见什么”，记忆解决的是“哪些知识长期存在、可被检索、可被维护、可被重写”。把这两个问题混在一起，系统很快就会失控。

## 二、Persistent Memory：Claude Code 把长期记忆做成了文件系统知识库

先看最基础的一层，也就是长期持久化记忆。

### 1. 注入进 system prompt 的不是全文，而是机制

`loadMemoryPrompt()` 返回的不是“把所有 memory 文件全文塞进 prompt”，而是一段关于记忆系统如何工作的说明。

它会告诉模型：

- 记忆目录在哪里。
- 哪些信息值得记。
- 哪些信息不该记。
- topic file 应该怎么写。
- `MEMORY.md` 应该怎么维护。

这意味着 Claude Code 注入的是 memory mechanics，而不是 full memory payload。它先教模型“怎么用记忆”，而不是一开始就把所有记忆正文硬塞进去。

### 2. memory 路径不是随便拼的，而是有优先级解析链

`getAutoMemPath()` 的解析顺序非常有意思。

它会优先看 override 和可信 settings source，最后才落到默认路径；而默认路径也不是简单按当前目录分桶，而是尽量先找到 canonical git root，再挂到对应的 project memory 目录下。

这背后其实反映了一个产品判断：

对 Claude Code 来说，“我正在处理这个 repo”比“我当前 shell 在哪个子目录”更像一个稳定的记忆单位。

### 3. `MEMORY.md` 是索引，不是正文

这是整套系统最关键的设计之一。

Claude Code 的 memory 目录大致长这样：

```text
memory/
  MEMORY.md
  user_role.md
  feedback_testing.md
  project_release_freeze.md
  reference_dashboards.md
```

这里真正承载信息密度的是 topic files，而 `MEMORY.md` 只负责提供导航和 hook。

这个区别非常重要。因为一旦 `MEMORY.md` 变成正文仓库，系统马上会遇到几个问题：

- 常驻 prompt 体积快速膨胀。
- 所有 recall 都退化成全量读取。
- 不同主题混在一个文件里，更新和去重都变笨。

把 `MEMORY.md` 做成 index 之后，Claude Code 就能把“入口常驻”和“正文按需”分开处理。

### 4. 长期记忆是强类型的，而且明确排除很多内容

`memoryTypes.ts` 里，Claude Code 把长期记忆强约束为几类：

- `user`：用户角色、目标、偏好、知识背景。
- `feedback`：用户对工作方式的反馈。
- `project`：代码之外的项目状态、决策、截止期、事故背景。
- `reference`：外部系统入口，比如 Linear、Slack、Grafana、文档链接。

与此同时，它又很明确地说，这些东西不应该写进 memory：

- 代码结构
- 文件路径
- Git 历史
- 调试方案
- 已经存在于 `CLAUDE.md` 的内容
- 当前会话的短期临时状态

这条边界非常见功力。因为 Claude Code 并不想把 memory 变成“第二份代码索引”或“杂项缓存桶”，它只想存那些代码里推不出来、但又足够 durable 的协作知识。

### 5. KAIROS 模式说明他们已经碰到超长生命周期记忆维护问题

源码里还有一个很有意思的分支：KAIROS。

在这个模式下，Claude Code 不再要求主 agent 实时维护 `MEMORY.md` 索引，而是先把新信息按日期 append 到 daily log，之后再靠后台 consolidation 把这些日志慢慢蒸馏回 topic files 和索引。

这说明团队已经非常清楚一件事：

当会话生命周期足够长时，让主 agent 一边干活一边持续维护结构化记忆，成本很高，也很容易漂。

所以他们给出的答案是：

先低摩擦记录，再异步整理。

## 三、Recall Layer：不是全量加载，而是索引常驻、正文按需

Persistent Memory 解决的是“记忆放在哪里”，Recall Layer 解决的是“哪些记忆应该在这次 query 里被模型看见”。

### 1. 常驻的是索引，不是所有正文

`claudemd.ts` 会统一发现 memory / instruction 文件，再把需要常驻的部分组装进系统提示。

在不同 feature gate 下，Claude Code 会尝试两种策略：

- 让 `MEMORY.md` 常驻进入 system prompt。
- 连 `MEMORY.md` 也不常驻，而是进一步走更细粒度的 recall。

无论选择哪条路径，核心思想都没变：常驻层应该尽量轻，给模型一个方向感，而不是把所有主题文件都直接注进去。

### 2. `findRelevantMemories()` 用的不是向量库，而是“小模型挑文件”

这是整套系统最有“Claude Code 风格”的地方之一。

它的流程不是 embedding 检索，而是：

1. 扫描 memory 目录里的 Markdown 文件。
2. 读取每个文件前几行描述信息。
3. 提取 `filename / description / type / mtimeMs` 组成 manifest。
4. 再让一个 side query 小模型从 manifest 里选出最多 5 个明显相关的文件。

也就是说，Claude Code 的 recall selector 更像一个轻量二次推理器，而不是一个传统向量搜索黑盒。

这套方案的优点很明显：

- 可解释：为什么选中某个文件，用户可以直接看 `filename` 和 `description`。
- 可编辑：你改 Markdown 的描述，就能影响 recall 质量。
- 低耦合：不需要额外维护 embedding pipeline。

代价则是 frontmatter 和描述质量会直接影响召回效果。

### 3. relevant memory prefetch 是并行启动的，不阻塞主链路

在 `queryLoop` 一开始，Claude Code 就会启动 relevant memory prefetch。

关键点在于：它不是同步前置步骤，而是和主模型流式生成并行跑的后台任务。等到后面收集 attachment 的时候，如果 prefetch 已经完成，就把记忆文件注入；如果没完成，就直接跳过，不拖慢这轮 turn。

这是一种非常典型的 latency hiding：

记忆召回不是“模型卡住了才去找记忆”，而是尽量把等待隐藏在本来就要发生的生成时间里。

### 4. attachment 注入也不是无脑读全文

被选中的 memory file 在真正注入前，还会再做一次受控 surfacing：

- 加 freshness header。
- 截断正文长度。
- 如果内容被截断，提示模型可以用工具继续读全文。

这说明 recall 在 Claude Code 里并不是“全量搬运知识”，而是一个受控的只读补丁层。

### 5. 去重做得很重，因为 busy session 很容易重复塞相同记忆

Claude Code 不只靠普通缓存，而是还维护了更偏状态化的去重信息，比如：

- `loadedNestedMemoryPaths`
- `readFileState`

原因其实很现实：如果只靠 LRU cache，在长会话里旧条目被驱逐后，很可能又被重新注入一次。对 Agent 来说，这种“模型其实已经看过，但系统忘了它看过”是非常常见也很烦的工程问题。

所以这一层的本质可以概括成一句话：

Claude Code 的 recall 更像“搜索引擎 + 候选清单 + 小模型选择 + attachment 注入”，而不是传统意义上的向量数据库。

## 四、Session Memory：它不是长期记忆，而是长会话的压缩缓存

很多人第一次看到 `Session Memory` 这个名字，会误以为它也是长期偏好库的一部分。其实不是。

它的真正职责更接近：

为长会话 compact 提前准备一份 checkpoint。

### 1. 它服务的是 compact，不是“记住用户”

源码里写得很直白：session memory 自动维护的是关于 current conversation 的一份 Markdown 笔记。

所以它关心的不是跨会话复用，而是这次超长对话之后还能不能平滑 compact，并且在 compact 后尽量少丢关键信息。

### 2. 它不是每轮都跑，而是在自然停顿点提炼

Claude Code 会综合几类阈值来决定是否提取 session memory：

- 当前上下文是否已经足够大。
- 距离上次摘要是否又新增了足够多 token。
- 工具调用数量是否积累到一定程度。

这套条件反映出一个非常实用的判断：摘要最好发生在一个工作片段相对完整的时候，而不是在模型还在连着打工具链时频繁插针。

### 3. 真正执行摘要的是一个 forked subagent

触发之后，主线程不会“顺手总结一下”，而是注册 post-sampling hook，然后用 `runForkedAgent()` 拉起一个隔离子 agent 去更新 session memory 文件。

这个子 agent 的权限极窄：

- 只能编辑那一个 session memory 文件。
- 不能随意读写其他文件。
- 不拿到完整自治工具箱。

这种权限收缩很值得注意。因为它说明 Claude Code 对“后台总结任务”是高度保守的：给它足够上下文，但不给它多余副作用。

### 4. compact 前还会等待 session memory 完成

在真正做 compact 时，Claude Code 还会显式等待 session memory extraction 结束，再把那份内容带进压缩后的上下文。

于是这条链路就闭环了：

- 对话增长。
- 达到阈值。
- 后台总结成 session memory。
- compact 前等待这份摘要落盘。
- compact 时把它带过去。

所以 session memory 的本质并不是“长期记忆的一部分”，而是长会话压缩辅助层。

## 五、写入链路：主 Agent 没记住的，后台再补一次

如果说 recall 解决的是“记忆怎么进 prompt”，那写入链路解决的就是“新知识怎么稳定回到持久层”。

这里 Claude Code 走的是双通道设计。

### 1. turn 结束后的 stop hooks 是后台 housekeeping 调度器

每轮结束时，`handleStopHooks()` 不只执行用户自定义逻辑，还会调度一批后台任务，包括：

- prompt suggestion
- extract memories
- autoDream

也就是说，记忆维护在 Claude Code 里被明确视为后台 housekeeping，而不是主对话链路的一部分。

### 2. `extractMemories` 做的是增量处理，不是全量重扫

提取逻辑内部维护了一个 cursor，比如 `lastMemoryMessageUuid`，每次只看上次处理点之后新增的、模型可见的消息。

这意味着 extraction 的成本会更稳定，也更符合“turn 结束后顺手补记忆”的定位。

### 3. 如果主 agent 已经直接写了 memory，后台就不再重复提取

这是整套设计里我非常喜欢的一点。

Claude Code 会扫描最近消息里的 `tool_use`，检查主 agent 有没有已经直接对 memory 目录做过写入。如果有，后台 extraction 就跳过，只推进 cursor。

于是它自然形成了两条互补路径：

- 主 agent 当场记忆。
- 后台 worker 补记忆。

二者不是互相打架，而是互相兜底。

### 4. extraction subagent 高上下文继承，低权限执行

它会复用父会话的 cache-safe params，这样能吃到 prompt cache 红利，不用从零重建上下文。

但权限收得很紧，只允许：

- 只读类文件工具
- 只读 Bash
- 目标限制在 memory dir 内的写入工具

其它 MCP、可写 Bash 或工作区写操作都被拒绝。

这是一种很典型也很稳的组合：

给后台 worker 足够上下文，不给它越界副作用。

### 5. 提取 prompt 甚至明确禁止它“顺手去查代码验证”

源码里有一句话很漂亮，大意是：不要浪费 turns 去进一步调查或验证内容。

这条约束很说明设计思路。

extractMemories 的职责不是再跑一次 code review，也不是再开一轮 Agent 调查，而是从刚刚那段对话里提取 durable facts 并落到 memory 层。把这个任务做重，后台维护成本很快就会上天。

### 6. `MEMORY.md` 的更新仍然只是索引维护

即便到了写回阶段，Claude Code 依然坚持：真正的知识本体是 topic files，`MEMORY.md` 只是入口。

这让整条写入链路始终围绕同一个原则在运作：

索引负责导航，正文负责承载知识。

## 六、AutoDream：更慢、更重，也更像真正的 consolidation

如果 `extractMemories` 是每轮的小修小补，`autoDream` 就是低频的大整理。

### 1. 触发条件说明它就是后台慢任务

它要满足的条件通常包括：

- 距离上次 consolidation 已经过了足够久。
- 上次以来积累了足够多活跃 session。
- 当前没有别的进程已经在做同类整理。

这意味着 autoDream 从定义上就不是“每轮都跑”的东西。

### 2. 它看的不是当前 turn，而是多个 session transcript

这点和 `extractMemories` 很不一样。

extractMemories 只看最近新增消息，而 autoDream 会看上次 consolidation 以来被触达过的多个 sessions。于是它更适合做：

- 去重
- 归并
- 日志蒸馏
- 主题重写

也更像真正意义上的长期记忆整理器。

### 3. 即便如此，输出仍然回到同一个 memory 目录

Claude Code 并没有再额外引入一套“dream 专用存储”。

不管是前台记忆、后台提取还是 autoDream 整理，最终都回到同一个文件系统表示层。这个选择非常重要，因为它避免了多套事实源并存。

### 4. 它还是可观测的

从 `DreamTask` 一整套任务状态和 UI 细节来看，autoDream 不是偷偷在后台跑完就算了，而是尽量让用户能知道：

- 是否正在运行
- 看过多少 sessions
- touched 了哪些文件
- 中间做了什么

对“让 AI 帮你维护长期记忆”这种能力来说，可观测性几乎就是信任前提。

如果把这一层压缩成一句话，我会说：

AutoDream 是 Claude Code 记忆系统里的 garbage collection、summarization 和 re-indexing。

## 七、Team Memory 和 Agent Memory：真正开始回答“这份记忆属于谁”

到这里，Claude Code 已经不只是“有长期记忆”了，它开始进一步追问记忆归属问题。

### 1. Team Memory 把共享边界显式做成双目录

在 team memory 模式下，系统会把记忆拆成两层：

- private directory：个人私有
- team directory：项目共享

而且共享规则不是模糊留给模型自由发挥的，而是直接写进 prompt policy 里。比如某些 feedback 默认应该留在 private，只有明确属于团队公共约束时才写入 team。

这相当于把“共享边界”编码成了机制本身。

### 2. Team Memory 的路径安全做得非常重

`teamMemPaths.ts` 里显式防了很多路径攻击和绕过手法，包括：

- null byte
- 编码后的 traversal
- Unicode 归一化绕过
- 反斜杠分隔符注入
- 绝对路径注入
- symlink escape
- dangling symlink
- symlink loop

特别是它不满足于 `path.resolve()`，而是进一步检查真实路径是否仍然落在 team 目录内部。这说明开发者防的不是“看起来像越界”的路径，而是“在文件系统真实解析后会不会越界”的路径。

### 3. Team Memory 甚至还支持远端同步

它不是一个纯本地目录，而是有专门的同步服务去 pull / push。

但语义又非常保守：

- pull 时 server wins
- push 只传 checksum 改变的项
- 删除不传播

这背后的产品取向也很清楚：记忆层最怕误删和冲突，宁可保守同步，也不要激进地做强一致共享文档。

### 4. Agent Memory 更进一步：记忆不只属于人，也可以属于某个 agent 角色

Claude Code 里还有一层 `Agent Memory`。

它区分的 scope 不再只是用户或项目，而是某个 agent type 自己的记忆空间。于是我们开始看到这样的问题被正式建模：

- 某个专门 agent 随着反复使用会不会积累自己的经验？
- 这种经验属于用户级、项目级，还是本地临时级？
- 项目能不能给某个 agent 发一份初始化记忆 snapshot？

一旦走到这一步，记忆系统其实已经从“聊天助手的长期上下文”进化成“协作型 agent 平台的知识层”了。

## 八、为什么这套记忆架构值得研究

如果只从表面看，Claude Code 的记忆系统当然可以被概括成“会把一些 Markdown 文件记下来”。

但真正重要的是它背后的设计取舍。

第一，它坚持 file-based。

记忆存在文件系统里，可见、可审计、可编辑，也便于后续扩展到 team sync 和 agent snapshot。

第二，它坚持 typed。

不是所有信息都值得进入长期记忆，系统通过类型约束和 prompt policy 主动限制记忆范围。

第三，它坚持 lazy-loaded。

索引常驻，正文按需，不让长期记忆天然演变成无限膨胀的 prompt。

第四，它坚持 background-maintained。

高频 extraction 负责增量补漏，低频 autoDream 负责慢整理，主 agent 不需要把所有记忆维护工作都扛在前台。

如果把这四点连起来，你会发现 Claude Code 解决的根本不是“怎么让模型记住更多”，而是更接近这四个问题：

- 什么值得长期保存？
- 什么应该在这次 query 里进入上下文？
- 什么适合在后台慢慢整理？
- 这份记忆到底属于用户、团队，还是某个 agent 角色？

我觉得这也是这份源码最有价值的地方。它让我们看到，真正进入生产环境的 Agent 记忆系统，并不是一个向量库接口，也不是一份不断膨胀的聊天历史，而是一套围绕 token 成本、权限边界、长期协作和后台维护建立起来的分层知识架构。
