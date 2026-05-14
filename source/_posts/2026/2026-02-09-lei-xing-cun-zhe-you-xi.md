---
title: 类幸存者游戏：从玩法循环到数值设计的实战总结
date: 2026-02-09 02:51:48
updated: 2026-02-09 02:51:48
tags: [ survivor-like, 数值设计, 游戏策划 ]
categories: 游戏开发
keywords: survivor-like, 数值曲线, 怪物刷新
description: 本文拆解类幸存者游戏的玩法循环，分享数值与关卡节奏调优经验
cover: /2026/02/09/lei-xing-cun-zhe-you-xi/cover.jpg
permalink: /2026/02/09/lei-xing-cun-zhe-you-xi/
article_version: 1.0.0
article_history:
  - version: 1.0.0
    date: 2026-02-09
    summary: 首次发布
---

这个 demo 我花了 2 个月完成，目标是验证类幸存者游戏的玩法循环与数值节奏。
过程里也补齐了 Unity 2D 与 QFramework 的实际使用经验。

<!-- more -->

## 玩法循环与体验节奏

核心体验来自“移动—击杀—掉落—升级—扩容”的短反馈循环。
我把资源掉落、升级节奏和场面密度作为三条主线并行调优。

## 数值与关卡调优

数值曲线采用前期快、后期缓的节奏，保证上手快且中后期仍有压强。
怪物刷新以时间波次为主，并通过精英与掉落奖励做节奏换挡。

## 试玩与截图

{% asset_img gameplay-1.png "战斗界面截图" class="full-width" %}
{% asset_img gameplay-2.png "升级面板截图" class="full-width" %}

## 试玩与源码说明

试玩与源码链接统一整理在文末参考资料，便于追踪与更新。

## 参考资料

1. [Vampire Survivor-like 源码仓库](https://github.com/yurisachan16-creator/Vampire-Survivor-like)
2. [Vampire Survivor-like 在线试玩](https://yurisachan16-creator.itch.io/vampire-survivor-like)
