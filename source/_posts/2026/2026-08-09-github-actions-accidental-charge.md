---
title: GitHub Actions 半夜尝试扣我 50 美元，顺手记录一下这次 macOS Runner 踩坑
date: 2026-08-09 20:56:00
updated: 2026-08-09 20:56:00
tags:
  - GitHub
  - GitHub Actions
  - CI/CD
  - AI Agent
  - macOS
categories:
  - 技术研究
cover: /2026/08/09/github-actions-accidental-charge/cover.webp
description: 复盘一次由私有仓库 macOS Runner、高频 PR 更新和自动化工作流共同放大的 GitHub Actions 意外费用，以及发现后的止损、CI 加固和计费检查方法。
permalink: /2026/08/09/github-actions-accidental-charge/
top_img: false
article_version: 1.0.0
article_history:
  - version: 1.0.0
    date: 2026-08-09
    summary: 首次发布
---

{% asset_img cover.webp "深夜里被自动化流程放大的 CI 费用" %}

事情是这样的。

北京时间 2026 年 8 月 9 日凌晨 03:10，我手机突然收到两条招商银行短信。

第一条说信用卡发生了一笔 50 美元的网上交易，商户是 GitHub。第二条紧跟着说交易失败。

我当时人都有点懵，凌晨三点看到 GitHub 扣 50 美元，第一反应肯定不是“哦，Actions 超额了”，而是账号是不是被盗了，或者某个 Agent 在后台做了什么奇怪的事情。

我一直知道 GitHub Actions 有免费额度和付费 Runner，不过以前常用的是 Ubuntu，也没认真算过每个 Job 多少钱。50 美元说多不多，说少也不少，主要是完全不知道它从哪里冒出来的。

我第一反应是把信用卡删掉，结果 GitHub 那边一时还删不了。我在页面里找了半天，后来想了一下，就算把卡删掉，正在运行的 Actions 还是会继续跑。已经产生的用量也不会因为支付方式消失。所以我先不和删卡较劲，把正在跑和排队的任务全部停了。

然后打开 Billing，按仓库和 SKU 往下找。这个页面我以前基本只会看订阅有没有续费，很少认真点进 Usage。现在想想，银行短信都发过来了才看 Usage，确实有点晚了。

先说最后查到的结果：

- 招商银行的 50 美元交易失败了，没有成功入账。
- GitHub Billing 里已经产生了 50.63 美元的净计量费用。
- 其中 49.37 美元来自 macOS Runner。
- repo-harness 没有直接扣钱，不过它让 PR 更新得更频繁，把这个配置问题放大了。

<!-- more -->

下面是银行 App 里的交易记录。信用卡尾号和商户电话已经用实色遮掉，图片也重新导出清理了元数据。

{% asset_img bank-transaction-failed-publish.png "招商银行显示 GITHUB CARD VERIFY 50 美元交易失败" %}

PS：本文费率是我在 2026 年 8 月 9 日查的，GitHub 后面可能会改价格，实际使用时最好再看一次官方文档。

## 我一开始差点把两件事混在一起

银行里的商户描述是 `GITHUB* CARD VERIFY`，金额 50 美元，状态是交易失败。

这只能说明这一次刷卡没有成功，不能说明 GitHub 上的费用没了。至于为什么商户名称里有 `CARD VERIFY`，它在 GitHub 支付系统里具体代表什么，我也不知道，单靠银行短信判断不了。

所以我给 Support 写工单时没有说“GitHub 验卡扣错钱”，只写已经确认的情况：GitHub 发起了一笔 50 美元交易，招商银行显示交易失败。

GitHub Billing 记录的是工作流已经跑掉的资源。Runner 只要开始运行，用量就会累计，信用卡刷不刷得过去是后面的事情。

我看到的总净费用是 50.63 美元，其中 macOS Runner 占了 49.37 美元。

{% asset_img billing-breakdown.png "GitHub Actions 净计量费用对比" %}

下面这张是 8 月 8 日当天的 SKU 明细。`Actions macOS 3-core` 跑了 392 分钟，单价 $0.062，当天是 $24.06。

{% asset_img github-billing-detail-cropped.png "GitHub Billing 中 2026 年 8 月 8 日的 Actions macOS 3-core SKU 明细" %}

这里要注意一下，392 分钟是单日数据。后面会提到的 1,088 分钟和 $49.37 是当时看到的月度汇总，不要把两组数混在一起。

银行失败算是暂时没扣出去，但 GitHub 的用量没有自动清零。后面会不会重新扣款，要看支付重试和 Support 怎么处理。

这里还有一个容易产生误会的地方。银行显示的是 03:12，短信提醒是 03:10 左右，两边的时间差并不影响结论。它们只是银行交易发生和通知到达的时间，不是 GitHub Actions 开始运行的时间。Actions 的费用是之前很多次 Job 慢慢累积出来的，不是凌晨三点突然运行了一个价值 50 美元的任务。

我一开始看到金额差不多，还以为 GitHub 是按 50 美元一档充值。后来把 SKU 展开才发现不是，它就是用量累计到了这个位置，支付系统刚好尝试收款。

## 最后查到了哪个工作流

这里稍微介绍一下 repo-harness。

我最近在用它跑多 Agent 开发。一个目标会被拆成不同任务，让 Agent 写代码、检查代码、跑测试，再通过 PR 合并。它确实很好用，尤其是同时做几个功能的时候，不用一直手工盯着每一步。

大概流程是这样的：

```text
目标
  ↓
Agent 开发和本地检查
  ↓
创建 PR
  ↓
GitHub Actions 验证
  ↓
根据测试和评审继续修改 PR
```

这套流程比 Agent 直接往 main 推代码安全很多。每个任务有自己的 PR，测试结果和评审意见也能留下来。以后出了问题，至少可以顺着 commit 找到当时改了什么。

但 Agent 修东西的频率也比人高。测试失败了会推一次，评审有意见又推一次，遇到冲突再改一次。几个 Agent 同时工作时，仓库里会有很多 PR 更新。

这本来没什么，Ubuntu 测试多跑几次也不会太夸张。问题是有人在一个监听 `pull_request` 的 workflow 里加了 macOS 全量测试。

我顺着 Git 历史找到了这个提交：[`22b0751 ci: run full Fairy suite on macOS`](https://github.com/yurisachan16-creator/yurisa-Fairy/commit/22b0751b6c8b054649eee767bcd5fa9f9c8ccee7)。它新增了 `macos-26` Runner，还会跑完整 pytest，超时上限是 30 分钟。

{% asset_img commit-macos-runner-cropped.png "关键 commit 在 test.yml 中新增 runs-on macos-26 和 30 分钟全量测试" %}

事故发生时 `yurisa-Fairy` 是私有仓库。私有仓库会先吃套餐里的 Actions 分钟，用完后就按 Runner SKU 收费。

这个配置为什么会进来，其实也不复杂。

当时的任务目标是“让完整测试在 macOS 上运行”，Agent 把它做完了。YAML 能执行，测试能通过，从代码角度看没什么错误。`runs-on: macos-26` 在 diff 里就一行，很容易当成普通 CI 修改看过去。

但这次评审没有问另外几个问题：这是私有仓库还是公开仓库？每次 PR 更新都需要跑吗？有没有预算？文档改动也要跑完整 macOS 测试吗？

我当时也没有规定“改 `runs-on` 必须检查费用”。最后就是测试覆盖率变高了，账单也一起变高了。

如果是人手工开发，一个 PR 改三四次可能就结束了。Agent 不太一样，它不会嫌重跑麻烦。一个测试失败可以连续修几轮，评审 Agent 再提几条意见，又会产生新的 commit。repo-harness 还会同时推进多个任务，于是 PR 数量和每个 PR 的更新次数一起增加。

这也是为什么单看任意一次 Actions 都不觉得夸张。十几分钟的 macOS 测试，跑一次也就不到一美元。页面上看到一个绿色勾，也很难想到它在另一个 PR 上已经重复出现了很多次。

## repo-harness 到底算不算原因

我觉得要分直接原因和间接原因。

直接花钱的是 macOS Runner。repo-harness 自身的协作和检查大部分跑在 Ubuntu，它不是账单里那 49.37 美元。

但 repo-harness 和多个 Agent 会频繁创建、更新 PR。每更新一次，`pull_request` workflow 就再跑一次，里面那个 macOS Job 也会跟着启动。

{% asset_img trigger-amplification.png "Agent 和高频 PR 如何放大 macOS 任务" %}

大概可以写成：

```text
总运行时间 ≈ PR 数量 × 每个 PR 的更新次数 × 每次 macOS Job 的时间
```

每个数字单独看都不大，乘起来就不一样了。

图里的箭头看起来有点多，实际触发关系很简单：Agent 每推一次，GitHub 就把它当成一次新的 PR 事件。旧任务如果没有配置 `cancel-in-progress`，即使新 commit 已经来了，它也可能继续跑。新旧两批任务重叠时，用量涨得更快。

所以 repo-harness 算是放大器，workflow 才是直接原因。换成其他会频繁推送 PR 的 Agent 工具，一样可能踩到这个坑。

## 50.63 美元怎么算出来的

我对着 [GitHub Actions Billing 文档](https://docs.github.com/en/billing/concepts/product-billing/github-actions)算了一遍，账基本能对上。

| Runner | 单价 |
| --- | ---: |
| Linux 1-core x64 | $0.002 / 分钟 |
| Linux 2-core x64 | $0.006 / 分钟 |
| Windows 2-core | $0.010 / 分钟 |
| macOS 3-core 或 4-core | $0.062 / 分钟 |

macOS 一共跑了 1,088 分钟：

```text
1,088 × $0.062 = $67.456
```

毛用量约 67.46 美元，抵扣账户当期额度后，macOS 的净费用是 49.37 美元。

Linux 是 630 分钟：

```text
630 × $0.006 = $3.78
```

Linux 抵扣后大约 1.25 美元，再加少量其他计量项，最后页面显示 50.63 美元。不同 Billing 页面的小数位显示不太一样，末尾可能差 0.01 美元左右。

还有一个我之前没注意过的地方：GitHub 会按 Job 向上取整分钟。很多短 Job 反复启动时，checkout、安装 Python、Homebrew 和测试依赖都在计时，不是只有真正跑 pytest 的那几分钟才收费。

例如一个 Job 实际只跑了 1 分 05 秒，计费时会按 2 分钟算。单次看只多了不到一分钟，几十个短 Job 重复启动后就比较明显了。再加上 macOS Runner 的每分钟价格比 Ubuntu 高，初始化时间也会变成费用的一部分。

macOS 测试当然有用。真实系统能发现平台差异，比一句“我本地能跑”可靠。但是把它放在每次 PR 更新上，成本确实太高了。

原来的思路也不是完全错。项目确实需要跨平台验证，Agent 每次提交后自动拿到反馈也很方便。错的是运行频率没有分层：普通逻辑改动、文档改动、发布前验证，全都走了同一套 macOS 全量测试。

我现在更愿意让 Ubuntu 多跑几次。大部分 lint、单元测试和构建问题，在 Linux 上就能发现。macOS 留给平台相关改动和发布前检查，少跑一点不会失去跨平台测试的价值。

## 我是怎么先停下来的

发现账单以后，我先做了下面几件事。

{% asset_img stop-loss-timeline.png "这次事故的止损时间线" %}

第一，取消正在运行和排队的 Actions。

只改 workflow 没用，旧版本已经启动的 Job 还会继续跑。如果队列里有几个 PR，它们还是会按原配置花分钟数。

第二，把 Actions 预算设为 0 美元，同时打开 `Stop usage when budget limit is reached`。

这个开关很重要。按照 [GitHub 的预算设置文档](https://docs.github.com/en/billing/how-tos/set-up-budgets)，只填预算但不打开 Stop usage，超额后可能只是发邮件提醒，不会真的停。

新建预算也不会抹掉之前产生的费用，它只管创建之后的新用量。

我原来以为预算就是信用卡的“限额”，超过以后自然会停。GitHub 这里不是这样。预算可以只用来提醒，也可以用来停止用量，取决于有没有打开 Stop usage。如果只设置 0 美元却没打开停止开关，最坏的情况是邮件一直提醒，任务还是照常运行。

第三，PR 默认只跑 Ubuntu。

lint、单元测试、主要集成测试和构建继续自动跑。macOS 改成手动输入，默认是 `false`。Pages 部署和每日任务也明确传 `false`，要跑 macOS 时必须主动打开。

长任务加 `timeout-minutes`，同一个 PR 用 `concurrency` 和 `cancel-in-progress` 取消旧任务。文档或无关代码可以用 `paths` / `paths-ignore` 直接跳过昂贵测试。

第四，提交 GitHub Support。

我把 Billing 数据、相关 commit、触发方式和已经做的修复都放进工单，申请一次性 goodwill credit。目前还没有结果，能不能减免不知道。

申请 Support 时我尽量只写能证明的事情，没有把它描述成盗刷。仓库是我的，Runner 也是工作流自己启动的，分钟数和单价都能算出来。能申请减免的理由主要是第一次发生、不是主动购买的预期用量，以及发现后马上停掉并修改了配置。

## 后面准备怎么跑

现在的思路很简单：便宜的测试自动跑，贵的测试手动跑。

PR 用 Ubuntu 挡住大部分问题。准备发布、修改 macOS 相关代码，或者确实需要验证时，再手动启动 macOS。

也可以使用本地 Mac 或自托管 Runner。GitHub 不收自托管 Runner 的 Actions 分钟费，但机器、电费、网络、系统更新和安全都要自己处理。尤其不要让陌生 fork PR 直接跑在有内网权限或者长期密钥的机器上。

我手里本来就有 Mac，所以发布前在本地跑一次其实也可以。缺点是要自己记得运行，环境坏了也得自己修。自托管 Runner 可以继续接入 GitHub 的流程，不过机器需要长期在线，对个人博客或者小项目来说可能有点重。

另外 GitHub 会计费的东西不止 Actions：

| 产品 | 主要计量单位 | 我以前容易忽略的地方 |
| --- | --- | --- |
| GitHub Actions | Runner 分钟、Artifacts / Cache 存储 | 失败和重跑也算时间，每个 Job 向上取整 |
| Codespaces | 计算时间、CPU 规格、GB-hours 存储 | 关掉网页不一定停机，停止的 Codespace 还可能占存储 |
| Codespaces Prebuilds | Actions 分钟、预构建存储 | 还没进入 Codespace，预构建可能已经产生用量 |
| GitHub Packages | 包存储、对外传输 | 大镜像和频繁拉取会慢慢涨 |
| Git LFS | 存储、带宽 | 文件放进 LFS 不代表免费，clone / pull 也会消耗带宽 |
| GitHub Copilot | 许可证、AI credits、部分高级能力 | 月费和超额计量可能同时存在，部分 Agent 能力还会触发 Actions |

Artifacts 和 Cache 也值得单独注意。删除文件只能停止后续继续累计存储，当期已经产生的 GB-hours 不会倒退。Codespaces 也是类似，关掉浏览器标签不一定等于停机，已经停止的 Codespace 只要还保留着，存储仍然可能继续算。

这些金额平时都不大，所以很容易被忽略。问题是自动化工具不会因为“今天已经跑很多了”就自己停下来。没有预算或者 workflow 条件，它只会继续按照配置执行。

参考文档放在这里，后面我自己也方便查：

- [Actions runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing)
- [Budgets and alerts](https://docs.github.com/en/billing/concepts/budgets-and-alerts)
- [GitHub Codespaces billing](https://docs.github.com/en/billing/concepts/product-billing/github-codespaces)
- [GitHub Packages billing](https://docs.github.com/en/billing/concepts/product-billing/github-packages)
- [Git Large File Storage billing](https://docs.github.com/en/billing/concepts/product-billing/git-lfs)
- [GitHub Copilot licenses](https://docs.github.com/en/billing/concepts/product-billing/github-copilot-licenses)

公开仓库使用标准 GitHub-hosted Runner 当前免费，自托管 Runner 也不收 Actions 分钟费。私有仓库是先扣套餐额度，用完后计费。

这里还有个坑：Larger Runner 即使在公开仓库里也收费，而且不能拿套餐分钟抵扣。仓库后来改成私有、Runner 换成 Larger Runner，原本免费的 workflow 就可能开始花钱。

我给后面的 Agent 工作流留了一份检查表：

```text
[ ] PR 默认使用标准 Ubuntu Runner
[ ] Windows / macOS / Larger Runner 要人工确认
[ ] 修改 runs-on 时检查仓库可见性和 Runner SKU
[ ] 昂贵 Job 不直接绑定高频 pull_request / push
[ ] 长任务设置 timeout-minutes
[ ] 同一 PR 使用 concurrency + cancel-in-progress
[ ] 预算设置为可接受金额，并打开 Stop usage
[ ] 每周按仓库和 SKU 看一次 Usage
[ ] Agent 不能自己扩大付费测试矩阵
```

只写检查表还不够，我也把要求直接放进 Agent 的任务说明里。现在遇到 CI 修改时，我会先写一句：

```text
默认只运行标准 Ubuntu 测试。
未经人工明确批准，不得启用 Windows、macOS、Larger Runner 或其他可能计费的资源。
修改 runs-on、定时任务和 pull_request 触发条件时，先检查仓库可见性、预算与并发设置。
如果无法确认费用，保留手动入口，不要自动触发。
```

提示词当然也可能被忽略，所以最后还是要靠 workflow 条件和账户预算。它的作用主要是让 Agent 在生成 YAML 时先想到费用，不要又只检查“能不能跑”。

目前银行那笔 50 美元还是交易失败，GitHub Billing 里的 50.63 美元也还在。Support 可能给一次性减免，也可能要求正常支付，工单期间还有可能重新尝试扣款。

我会继续看银行通知和 Support 回复。如果后面减免成功，或者 GitHub 再次扣款，我再回来更新文章。

这次最大的教训大概就是：不要等银行半夜发短信，才想起来看 Actions Usage。
