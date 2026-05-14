---
title: AI WebSearch 工具横评与 MCP 实战：给 Agent 接上可靠互联网
date: 2026-05-14 18:00:00
updated: 2026-05-14 18:00:00
tags:
  - AI
  - MCP
  - Agent
  - WebSearch
  - Python
categories:
  - 技术研究
keywords: AI WebSearch, MCP, OpenClaw, Hermes, Tavily, Exa, Brave Search, Firecrawl
description: 从 WebSearch provider 横评开始，设计并实现一个通用 Python MCP 服务，让 OpenClaw、Hermes、Claude Desktop、Cursor 等 Agent 客户端共享可替换的联网搜索能力。
permalink: /2026/05/14/ai-websearch-mcp/
article_version: 1.0.0
article_history:
  - version: 1.0.0
    date: 2026-05-14
    summary: 首次发布
---

我最近想给 OpenClaw、Hermes 这类 AI Agent 做一套可复用的 WebSearch 工具。灵感来自小根伴的《[WebSearch工具对比](https://www.xiaogenban1993.com/blog/26.03/WebSearch%E5%B7%A5%E5%85%B7%E5%AF%B9%E6%AF%94)》和 B 站视频《【AI】WebSearch工具横评》。

结论先说：不要把“搜索网页”“抓取网页”“生成带引用答案”混成一个工具。Agent 需要的是四个稳定能力：

1. `web_search`：找候选来源。
2. `web_fetch`：把 URL 变成干净正文。
3. `web_answer`：让支持引用答案的 provider 直接回答。
4. `provider_status`：告诉 Agent 当前哪些 provider 可用、缺什么 key、支持什么能力。

我把这个做成了一个独立 Python MCP 服务：`ai-websearch-mcp`。

<!-- more -->

---

## 为什么不用单一 WebSearch 工具

传统搜索 API 返回的是 SERP：标题、链接、摘要。Agent 真正要完成任务，还需要读页面、过滤噪声、处理失败、保留引用。

模型内置的 Web Search 又是另一类东西。OpenAI 和 Anthropic 的 web search 是模型工具能力，适合“直接得到带引用回答”，但它不是可替换的普通搜索 API。把它伪装成 `web_search` 会让调试变难：你以为拿到的是搜索结果，实际拿到的是模型加工后的答案。

所以我把 provider 分成四类：

| Tier | Provider | 用途 |
| --- | --- | --- |
| `core` | Brave、Tavily、Exa、Firecrawl | v1 稳定实现和测试 |
| `local` | SearXNG、ddgs、native fetch | 免费、自托管、本地兜底 |
| `answer` | OpenAI、Anthropic、Perplexity、Linkup | 带引用答案，不伪装成搜索 |
| `experimental` | Parallel、Serper、SerpApi、SearchAPI.io | 先纳入对比和适配器骨架 |

---

## 2026 年选型现实

有两个旧选项已经不适合作为新项目默认选择：

- Microsoft 已公告 Bing Search APIs 于 **2025-08-11** 退休，迁移方向是 Azure AI Agents 的 Grounding with Bing Search。
- Google Custom Search JSON API 已对新客户关闭，现有客户需要在 **2027-01-01** 前迁移；官方文档也把 Vertex AI Search 作为替代方向之一。

这意味着个人 Agent 工具不要再把 Google CSE 或旧 Bing Search API 当主路。

更现实的默认组合是：

| 场景 | 推荐 |
| --- | --- |
| 个人低成本 | Brave Search API + native fetch |
| Agent 搜索质量优先 | Tavily |
| 技术文档/语义检索 | Exa |
| 抓取正文/复杂页面 | Firecrawl |
| 自托管/隐私优先 | SearXNG |
| 直接要引用答案 | Perplexity、Linkup、OpenAI/Anthropic web search |

Brave 的优势是独立索引和成本清晰。Tavily 的优势是为 Agent 搜索做了结果摘要和抽取。Exa 更像“给 LLM 找语义相关网页”的搜索。Firecrawl 的强项不是搜索，而是把网页变成 Agent 能读的正文。

---

## MCP 工具契约

服务提供四个工具。

```python
web_search(
    query: str,
    provider: str = "auto",
    limit: int = 5,
    locale: str | None = None,
    recency_days: int | None = None,
    domains: list[str] | None = None,
)
```

返回统一结构：

```json
{
  "success": true,
  "provider": "brave",
  "results": [
    {
      "title": "Result title",
      "url": "https://example.com",
      "snippet": "Short summary",
      "rank": 1,
      "provider": "brave"
    }
  ]
}
```

`web_fetch` 返回 `FetchedDocument`，`web_answer` 返回 `AnswerWithCitations`，`provider_status` 返回每个 provider 的能力矩阵。

错误也必须结构化：

```json
{
  "success": false,
  "error": {
    "code": "missing_api_key",
    "message": "Provider 'brave' is missing required configuration: BRAVE_SEARCH_API_KEY.",
    "action": "Set BRAVE_SEARCH_API_KEY or choose another provider.",
    "provider": "brave"
  }
}
```

这对 Agent 很重要。它不应该猜“失败字符串”是什么意思，它应该知道下一步是换 provider、补 key、降低频率，还是调用 `provider_status`。

---

## 实现结构

仓库结构：

```text
ai-websearch-mcp/
├── pyproject.toml
├── src/ai_websearch_mcp/
│   ├── server.py
│   ├── cli.py
│   ├── config.py
│   ├── doctor.py
│   ├── models.py
│   ├── security.py
│   ├── tools.py
│   └── providers/
│       ├── base.py
│       ├── registry.py
│       └── http_providers.py
├── examples/
├── docs/
└── tests/
```

MCP 入口用 `FastMCP` 暴露 stdio server：

```python
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("ai-websearch-mcp")

@mcp.tool()
async def web_search_tool(query: str, provider: str = "auto", limit: int = 5) -> dict:
    return await web_search(query, provider=provider, limit=limit)
```

Provider 不直接暴露给 MCP。MCP 只依赖统一工具函数；工具函数再通过 registry 选择 provider。

```text
MCP client
  ↓
server.py
  ↓
tools.py
  ↓
ProviderRegistry
  ↓
Brave / Tavily / Exa / Firecrawl / SearXNG / native fetch
```

---

## 安全边界

`web_fetch` 是高风险工具。Agent 读网页时，网页内容是不可信输入。

默认安全策略：

- 拒绝 `file://`、`data:` 等非 HTTP URL。
- 拒绝 `localhost`、`127.0.0.1`、`::1`。
- 拒绝私网 IP，例如 `10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`。
- 限制超时、下载大小和输出长度。
- 只接受文本类内容。
- HTML 转文本时移除 `script/style/noscript`。

这不是完美沙箱，但它挡住了最常见的 SSRF 风险。SSRF 指服务端请求伪造，也就是让工具替攻击者访问本机或内网资源。

---

## 安装和接入

开发模式：

```bash
uv sync --extra dev
uv run --extra dev pytest
uv run ai-websearch-mcp doctor
```

未来发布后可以直接：

```bash
uvx ai-websearch-mcp doctor
uvx ai-websearch-mcp serve
```

Claude Desktop 配置：

```json
{
  "mcpServers": {
    "ai-websearch": {
      "command": "uvx",
      "args": ["ai-websearch-mcp", "serve"],
      "env": {
        "BRAVE_SEARCH_API_KEY": "your-key"
      }
    }
  }
}
```

Hermes 已经有成熟的 `web_tools`，所以这个 MCP 服务不是为了替换 Hermes 内置实现，而是为了让 Hermes、Claude Desktop、Cursor、OpenClaw bridge 共用同一套 provider 契约。

OpenClaw 当前的 `web_search` 还是占位工具，且默认关闭。短期可以通过 MCP bridge 映射：

| OpenClaw | MCP |
| --- | --- |
| `web_search` | `web_search_tool` |
| `fetch_page` / `extract_article` | `web_fetch_tool` |
| 未来引用答案工具 | `web_answer_tool` |

---

## 测试方法

第一版测试不依赖真实 API key。

覆盖范围：

- 统一模型序列化。
- provider 自动选择。
- 配置文件与环境变量优先级。
- 缺 key、能力不支持、未知 provider 的结构化错误。
- URL 安全拦截。
- doctor 输出。

后续真实横评应该固定一组中英混合查询：

1. 官方文档查询，例如 “MCP Python SDK FastMCP stdio”。
2. 中文技术博客查询，例如 “Claude Code Agent Loop 源码解析”。
3. GitHub issue 查询。
4. 新闻/价格/政策类实时查询。
5. 论文或 arXiv 查询。

记录成功率、延迟、引用可用率、中文结果质量和成本。不要只看“有没有返回结果”，要看 Agent 是否能拿它继续完成任务。

---

## 最终建议

如果你在做个人 Agent，先用 Brave 或 Tavily。  
如果你重视技术文档召回，用 Exa。  
如果你要稳定抓正文，用 Firecrawl。  
如果你要隐私和自托管，用 SearXNG。  
如果你要“直接回答并带引用”，把 OpenAI、Anthropic、Perplexity、Linkup 放进 `web_answer`，不要放进 `web_search`。

真正的 WebSearch 工具不是 provider 清单。它应该让 Agent 在失败时知道怎么恢复，在换 provider 时不用改 prompt，在读网页时不会顺手打穿本机。

这就是 `ai-websearch-mcp` 第一版要解决的问题。

---

## 参考资料

- [Bing Search APIs retiring on August 11, 2025](https://learn.microsoft.com/en-us/lifecycle/announcements/bing-search-api-retirement)
- [Google Custom Search JSON API](https://developers.google.com/custom-search/v1/overview)
- [Brave Search API](https://brave.com/search/api/)
- [Exa API Pricing](https://exa.ai/pricing?tab=api)
- [Tavily Credits & Pricing](https://tavilyai.mintlify.app/documentation/api-credits)
- [Linkup Pricing](https://docs.linkup.so/pages/documentation/platform/pricing)
- [Perplexity API Pricing](https://docs.perplexity.ai/docs/getting-started/pricing)
- [OpenAI API Pricing](https://platform.openai.com/docs/pricing)
- [Anthropic Claude API Pricing](https://docs.anthropic.com/en/docs/about-claude/pricing)
