知乎标题：我把个人博客换到了短域名，顺手记录一下 Cloudflare + 阿里云的踩坑过程

正文从下一行开始复制到知乎：

这次折腾博客域名，起因很简单：原来的地址太长了。

```text
https://yurisachan16-creator-github-io.pages.dev/
```

它能打开，也不影响用，但每次想发给别人都觉得别扭。一个个人博客顶着这么长的 `pages.dev` 地址，看起来像还没收拾完。

所以我想把主站换成：

```text
https://yurisa.top/
```

评论、点赞、阅读量这些动态接口也顺手整理一下，放到：

```text
https://api.yurisa.top/api/v1
```

这篇不是严格教程，更像一次复盘。里面有几个我一开始也容易混起来的点：买域名、实名、备案、DNS、Cloudflare Pages、自定义 API 子域名。它们看起来都在改网址，其实每一步管的东西不一样。

## 我最后选的方案

我这次的需求很普通：

- 国内尽量能访问
- 地址短一点
- 不想备案
- 后面还要加评论功能
- 域名可以买，但成本别太高

如果要国内访问最稳，通常会走国内服务器或者国内 CDN，但那基本绕不开备案。我这次想要的是省事，所以最后选了这条路线：

```text
阿里云买域名
  ↓
Cloudflare 接管 DNS
  ↓
Cloudflare Pages 托管静态博客
  ↓
Cloudflare Worker 提供评论/点赞/阅读量 API
```

这个方案不保证国内所有网络都稳定，但对个人博客来说足够轻。没有服务器要维护，也不用走备案流程。

## 买域名时先卡在付款

我一开始想直接在 Cloudflare 买域名。`yurisa.net` 一年大概 11.86 美元，价格还可以，但付款卡住了。Cloudflare 支持的卡主要是 Visa、Mastercard、AmEx、Discover，也可以走 PayPal。我手里只有国内银联卡，最后没买成。

后来我换到国内平台买。这里遇到第二个容易让人紧张的点：国内买域名需要实名信息模板。

我一开始也差点把它和备案混在一起。其实这两件事不是一回事。

实名是域名注册要求，说明这个域名是谁持有的。备案是网站放在中国大陆服务器或者大陆 CDN 时才会碰到的流程。域名在国内买，但博客继续放在 Cloudflare Pages，一般不等于要备案。

最后我买了 `yurisa.top`。`.top` 不是最经典的后缀，但便宜，名字也短。我的想法是先买一年，把整条链路跑通。如果之后真的长期用，再考虑续费多年。

## 接到 Cloudflare，先改 Nameserver

域名买好以后，我去 Cloudflare 添加站点。这里选的是 `Connect a domain`，不是在 Cloudflare 重新买，也不是把域名转移过去。

Cloudflare 扫描 DNS 时显示 `Records we found: 0`。刚看到的时候会以为哪里没配好，但新买的域名没有旧记录很正常。

【插图 1：Cloudflare 扫描 DNS 记录为空】
/Users/aitwo/项目/yurisachan16-creator.github.io/source/_posts/2026/2026-05-26-cloudflare-short-domain-blog/01-cloudflare-dns-scan.png

这一步真正要抄下来的是 Cloudflare 给的两个 Nameserver。我这次拿到的是：

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

【插图 2：在阿里云把 DNS 服务器改成 Cloudflare Nameserver】
/Users/aitwo/项目/yurisachan16-creator.github.io/source/_posts/2026/2026-05-26-cloudflare-short-domain-blog/02-aliyun-nameserver-edit.png

保存后，阿里云会提示 DNS 生效可能需要 24 到 48 小时。实际这次很快，几分钟内 Cloudflare 就识别到了。

【插图 3：阿里云显示当前 DNS 服务器已经切到 Cloudflare】
/Users/aitwo/项目/yurisachan16-creator.github.io/source/_posts/2026/2026-05-26-cloudflare-short-domain-blog/03-aliyun-nameserver-done.png

这里最容易搞错的是：Nameserver 改完以后，解析记录主要就去 Cloudflare 改了。阿里云还负责域名本身的注册和续费，但 `A`、`CNAME` 这些记录不要再跑回阿里云解析里加。不然你会以为自己加了记录，实际访问时根本不走那里。

## 主站绑定到 Cloudflare Pages

Cloudflare 接管 DNS 以后，`yurisa.top` 还不会自动显示博客。它只是开始归 Cloudflare 管，还不知道要指向哪个 Pages 项目。

我的博客在 Cloudflare Pages 上，所以还要进入：

```text
Workers & Pages
  → 你的 Pages 项目
  → Custom domains
  → Set up a custom domain
```

然后填入：

```text
yurisa.top
```

等状态从 `Initializing` 变成 `Active`，并且右边显示 `SSL enabled`，主站绑定才算完成。

【插图 4：Cloudflare Pages 自定义域名变成 Active】
/Users/aitwo/项目/yurisachan16-creator.github.io/source/_posts/2026/2026-05-26-cloudflare-short-domain-blog/04-pages-custom-domain-active.png

到这一步，打开 `https://yurisa.top/` 就能看到博客。

## 别忘了 api 子域名

我这次还有评论、点赞、阅读量 API。它们不在 Pages 上，而是在 Cloudflare Worker 上。原来的 Worker 地址是：

```text
https://yurisachan-blog-api.yurisachan16.workers.dev
```

我希望前端以后只访问：

```text
https://api.yurisa.top/api/v1
```

这里我差点漏掉 DNS。Worker 里配 route 还不够，Cloudflare DNS 里也要有 `api` 这条记录。最后我加的是：

```text
Type: CNAME
Name: api
Target: yurisachan-blog-api.yurisachan16.workers.dev
Proxy status: Proxied
TTL: Auto
```

【插图 5：给 api.yurisa.top 添加 CNAME 记录】
/Users/aitwo/项目/yurisachan16-creator.github.io/source/_posts/2026/2026-05-26-cloudflare-short-domain-blog/05-api-dns-record.png

保存后测一下：

```bash
curl https://api.yurisa.top/api/v1/posts/test/metrics
```

能返回类似这样的 JSON，就说明 API 子域名通了：

```json
{"views":0,"likes":0,"comments":0,"likedByMe":false}
```

## 本地配置也要跟着改

域名在 Cloudflare 里配完，只是线上入口通了。博客项目里的正式地址也要改，不然页面能打开，但 canonical、旧站跳转、前端 API 地址可能还是旧域名。

我这边主要改了三类地方：

- 站点主地址改成 `https://yurisa.top`
- 动态 API 地址改成 `https://api.yurisa.top/api/v1`
- 旧 GitHub Pages 地址跳转到新主站

这些改完以后再部署，主站和 API 才算真正切到新域名。

## 这次最容易踩的几个点

第一，国内平台买域名需要实名，但实名不是备案。只要网站不放中国大陆服务器或者大陆 CDN，免备案路线仍然成立。

第二，Cloudflare 接管 DNS 以后，解析记录就去 Cloudflare 改。阿里云那边主要保留注册和续费。

第三，主站能打开，不代表 API 一定能打开。`yurisa.top` 和 `api.yurisa.top` 是两件事，后者要单独配 DNS 和 Worker。

第四，Cloudflare 的状态要看清楚。Pages 自定义域名要变成 `Active`，SSL 要启用，DNS 记录也要确认是橙色云代理。

第五，不要只看浏览器首页。至少测一次主站，再测一次 API 返回。

这次最后形成的结构是：

```text
https://yurisa.top/
  → Cloudflare Pages 博客

https://api.yurisa.top/api/v1
  → Cloudflare Worker 动态接口

https://yurisachan16-creator.github.io/
  → 跳转到 https://yurisa.top/
```

折腾完以后，博客地址终于短了一截。后面做评论功能时，也不用继续顶着一串很长的 `pages.dev` 和 `workers.dev` 地址了。
