---
title: 我把博客换到了 yurisa.top
date: 2026-05-26 16:20:00
updated: 2026-05-26 16:20:00
tags:
  - 博客
  - Hexo
  - Cloudflare
  - 域名
categories:
  - 博客搭建
cover: /2026/05/26/cloudflare-short-domain-blog/04-pages-custom-domain-active.png
description: 记录一次把 Hexo 博客从 Cloudflare Pages 默认域名换到 yurisa.top 的过程，包括买域名、改 Nameserver、绑定 Pages、自定义 API 子域名，以及中间踩到的几个坑。
permalink: /2026/05/26/cloudflare-short-domain-blog/
top_img: false
article_version: 1.0.0
article_history:
  - version: 1.0.0
    date: 2026-05-26
    summary: 首次发布
---

这次折腾博客域名，起因其实很小：原来的地址太长了。

```text
https://yurisachan16-creator-github-io.pages.dev/
```

它能打开，也没有什么大问题，但每次想发给别人都觉得很别扭。一个个人博客顶着这么长的 `pages.dev` 地址，看起来像还没收拾完。

所以我想换成短一点的：

```text
https://yurisa.top/
```

评论、点赞、阅读量这些动态接口也顺手整理一下，放到：

```text
https://api.yurisa.top/api/v1
```

现在回头看，步骤不难，难的是几个概念很容易混在一起：买域名、实名、备案、DNS、Pages 自定义域名、Worker route，看起来都在“改网址”，其实每一步负责的东西不一样。

<!-- more -->

## 先说我选的路线

我这次不想把事情搞复杂。需求大概是这样：

- 国内尽量能访问
- 地址短一点
- 不想备案
- 后面还要加评论功能
- 域名可以买，但成本别太离谱

如果追求国内访问最稳，当然是国内服务器或者国内 CDN。但那基本就要备案，我这次不想走那条路。最后选的是省事版：

```text
阿里云买域名
  ↓
Cloudflare 接管 DNS
  ↓
Cloudflare Pages 托管静态博客
  ↓
Cloudflare Worker 提供评论/点赞/阅读量 API
```

这个方案不是“国内访问满分”的方案，只是比较省心。不买服务器，不备案，也不用自己维护一堆东西。对个人博客来说，我觉得够用了。

## 买域名时先卡在付款

一开始我想直接在 Cloudflare 买，看到 `yurisa.net` 一年 11.86 美元，价格还可以。结果到付款时卡住了。Cloudflare 那边主要支持 Visa、Mastercard、AmEx、Discover 和 PayPal，我手里只有国内银联卡，最后没买成。

后来我就换到国内平台买。这里又遇到一个容易让人紧张的点：国内买域名需要实名信息模板。

我一开始也差点把它和备案混在一起。其实不是一回事。实名只是域名注册要求，说明这个域名是谁持有的；备案是网站放在中国大陆服务器或大陆 CDN 时才会碰到的那套流程。域名在国内买，但博客继续放在 Cloudflare Pages，不等于马上要备案。

最后我买了 `yurisa.top`。`.top` 不算最经典的后缀，但便宜，名字也短。我的想法是先买一年，把整条链路跑通。真的用了很久，再考虑续费多年。

## 接到 Cloudflare，先改 Nameserver

域名买好以后，我去 Cloudflare 添加站点。这里选的是 `Connect a domain`。不是在 Cloudflare 重新买，也不是把域名转移过去。

Cloudflare 扫描 DNS 时显示 `Records we found: 0`。刚看到的时候会以为哪里没配好，其实新买的域名没有旧记录也很正常。

{% asset_img 01-cloudflare-dns-scan.png "Cloudflare 扫描 DNS 时没有发现已有记录" %}

真正要抄下来的是 Cloudflare 给的两个 Nameserver。我这次是：

```text
diana.ns.cloudflare.com
ram.ns.cloudflare.com
```

然后回到阿里云，把默认的：

```text
dns29.hichina.com
dns30.hichina.com
```

换成 Cloudflare 给的两个。

{% asset_img 02-aliyun-nameserver-edit.png "在阿里云把 DNS 服务器改成 Cloudflare Nameserver" %}

保存后，阿里云会提示 DNS 生效可能需要 24 到 48 小时。实际这次很快，几分钟内 Cloudflare 就识别到了。

{% asset_img 03-aliyun-nameserver-done.png "阿里云显示当前 DNS 服务器已经切到 Cloudflare" %}

这里我觉得最容易搞错的是：改完 Nameserver 之后，解析就主要去 Cloudflare 改了。阿里云还负责域名本身的注册和续费，但 `A`、`CNAME` 这些记录就不要再跑回阿里云解析里加。不然会出现一种很迷惑的情况：你明明加了记录，但访问时根本不走那里。

## 主站绑定到 Pages

Cloudflare 接管 DNS 以后，`yurisa.top` 还不会自动显示博客。它只是开始归 Cloudflare 管了，还不知道要指向哪个 Pages 项目。

我的博客是 Cloudflare Pages 项目，项目名是：

```text
yurisachan16-creator-github-io
```

所以还要进入：

```text
Workers & Pages
  → yurisachan16-creator-github-io
  → Custom domains
  → Set up a custom domain
```

填入：

```text
yurisa.top
```

等状态从 `Initializing` 变成 `Active`，并且右边显示 `SSL enabled`，主站绑定才算完成。

{% asset_img 04-pages-custom-domain-active.png "Cloudflare Pages 自定义域名变成 Active" %}

到这里，打开 `https://yurisa.top/` 就能看到博客了。

## 别忘了 api 子域名

我这次还有评论、点赞、阅读量 API。它们不在 Pages 上，而是在 Cloudflare Worker 上。原来的 Worker 地址是：

```text
https://yurisachan-blog-api.yurisachan16.workers.dev
```

我想让前端以后只访问：

```text
https://api.yurisa.top/api/v1
```

这里我差点漏掉 DNS。Worker 里写 route 还不够，Cloudflare DNS 里也要有 `api` 这条记录。最后我加的是：

```text
Type: CNAME
Name: api
Target: yurisachan-blog-api.yurisachan16.workers.dev
Proxy status: Proxied
TTL: Auto
```

{% asset_img 05-api-dns-record.png "给 api.yurisa.top 添加 CNAME 记录" %}

保存后测一下：

```bash
curl https://api.yurisa.top/api/v1/posts/test/metrics
```

返回：

```json
{"views":0,"likes":0,"comments":0,"likedByMe":false}
```

能返回这段 JSON，就说明 `api.yurisa.top` 已经走通了。

## 本地配置也要跟着改

域名在 Cloudflare 里配完，只是线上入口通了。本地代码里还有旧地址，不改的话，页面能打开，但站点生成的 canonical、API 地址、旧站跳转可能还是旧的。

这次我主要改了几处。

`_config.yml`：

```yaml
url: https://yurisa.top
```

`_config.butterfly.yml`：

```html
<meta name="dynamic-api-base" content="https://api.yurisa.top/api/v1">
```

`worker/wrangler.toml`：

```toml
routes = [
  { pattern = "api.yurisa.top/*", zone_name = "yurisa.top" },
]

[vars]
CORS_ORIGIN = "https://yurisa.top"
```

旧 GitHub Pages 地址也改成跳转到新主站：

```text
https://yurisachan16-creator.github.io/
  → https://yurisa.top/
```

这些改完后推到 `main`，GitHub Actions 会自动部署 Cloudflare Pages 和 Worker。

## 还顺手修了一个旧的构建报错

改域名的时候，我又跑了一遍构建，发现一个旧问题：`npm run build` 虽然最后能成功，但日志里会报 Butterfly 的 Stylus 错误：

```text
Failed to @extend ".fontawesomeIcon"
```

这个和域名没关系，是 Butterfly 标题美化那块的样式问题。文章页单独渲染时，局部 Stylus 文件里找不到全局的 `.fontawesomeIcon`，于是就报了。

我先把标题美化关掉了：

```yaml
beautify:
  enable: false
  field: site
```

这个功能只是给标题前面加小图标，对博客主体没什么影响。后来又补了一个 `theme-overrides`，让主题里的 `post.styl` 单独渲染时也能找到 `.fontawesomeIcon`。这样本地和 CI 构建都不会再刷那串错误。

## 我最后怎么确认它真的好了

最后不是只在浏览器里看首页。我还跑了这些：

```bash
npm run test:unit
npm run worker:typecheck
npm run build
```

确认的结果大概是：

- 单元测试 47 个通过
- Worker typecheck 通过
- Hexo 正常生成 64 个文件，没有文章页渲染错误
- Cloudflare Pages 部署成功
- Cloudflare Worker 部署成功
- `https://yurisa.top/` 返回 200
- `https://api.yurisa.top/api/v1/posts/test/metrics` 返回 JSON

到这里，短域名和 API 子域名都算接好了。
