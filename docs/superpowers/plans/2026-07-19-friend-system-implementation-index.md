# 好友系统实施计划总览

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按四个可独立验收的计划实现完整好友系统，并在全部计划通过后一次性发布。

**Architecture:** 私有牌局继续由 `poker_data` 与 `data-service` 管理；新增 `poker_social` 作为所有跨账号访问的唯一云端入口。玩家库扩展字段仍保存在当前账号的 `player_notes`，社交页面只消费白名单 DTO。

**Tech Stack:** 微信小程序原生 JS/WXML/WXSS、CloudBase、`wx-server-sdk ^3.0.1`、Node.js `node:test` 与 `node:assert/strict`。

## Global Constraints

- 不读取或推断微信通讯录好友。
- 客户端不得直接读写社交集合，不得接收 OpenID 或完整私有文档。
- 分享手牌只能由云端从原手牌生成白名单快照，金额统一 BB 化，非 Hero 玩家强制匿名。
- 好友资料和排行榜不得返回或展示盈亏、胜率、资金、地点和私人场次字段。
- 好友本地头像、备注名称、玩家类型、Leak、Note 和对战手牌仅当前用户可见和编辑。
- 玩家名片一次分享一张给一位指定好友，未导入 7 天失效。
- 第一版仅对广场评论、回复和公开昵称做服务端自动检测；不检测结构化牌谱、好友/指定好友评论、私有 Note/Leak、好友备注或内置贴纸。举报、屏蔽、聊天和微信订阅消息暂不实现，管理员保留评论软删除能力。
- 社交写入失败不得回滚或阻塞场次、手牌、玩家库和统计的核心写入。
- 不自动上传开发版；每份计划完成后先在真实工作区运行微信开发者工具预览。

---

## 执行顺序

1. [社交身份与好友关系实施计划](./2026-07-19-friend-system-01-social-foundation.md)
2. [好友资料与排行榜实施计划](./2026-07-19-friend-system-02-profile-ranking.md)
3. [玩家名片与消息中心实施计划](./2026-07-19-friend-system-03-card-messages.md)
4. [手牌动态与互动实施计划](./2026-07-19-friend-system-04-hand-feed.md)

后一份计划只能在前一份计划的全部自动化测试、真实工作区预览和任务级代码审阅通过后开始。四份计划全部完成前，不发布正式功能。

## 跨计划稳定接口

```js
// services/social-api.js
callSocialFunction(action, payload) -> Promise<Object>

// services/social-service.js
initializeSocialProfile(input) -> Promise<SocialProfile>
listFriends(options) -> Promise<{ items, nextCursor }>
getFriendDetail(friendUserId) -> Promise<FriendDetail>
listRanking(rangeKey) -> Promise<{ top10, myRank }>
listFeed(options) -> Promise<{ items, nextCursor }>
listMessages(options) -> Promise<{ items, unreadCount, nextCursor }>

// 所有写接口
payload.clientMutationId: string
```

`socialUserId` 是不可推导 OpenID 的随机标识。任何后续计划不得把现有 `playerId` 改造成公开社交 ID。

## 最终验收命令

```powershell
Get-ChildItem tests\social-*.test.js | ForEach-Object { node --test $_.FullName }
node tests\player-notes-store.test.js
node tests\player-notes-navigation.test.js
node tests\player-notes-cloud-boundary.test.js
node tests\friend-feed-demo.test.js
node tests\friend-hand-share-demo.test.js
node tests\friend-list-message-demo.test.js
git diff --check
```

预期：所有命令退出码为 `0`。随后在 `D:\TRAE\xuan\poker-live-miniapp` 运行微信开发者工具 `auto-preview`；预览成功不等同于上传开发版。

## 2026-07-20 集成交付状态

- 四份计划对应的本地功能、权限白名单、账号隔离、离线缓存和回归测试已经实现；原任务文件中的未勾选项属于历史执行清单，不再作为当前状态来源。
- 补充完成：首次社交资料初始化与公开资料同步、隐私与分享说明、已发布手牌范围修改及撤回、未导入名片撤回、好友详情最近可见分享、管理员评论处置与审计。
- 玩家名片微信系统分享卡片已移入可拓展功能；第一版以绑定指定好友的站内消息为唯一送达链路。
- 本验收代码版本的整项目串行回归为 `995/995`，`0` 失败；真实微信开发者工具 `auto-preview` 编译通过，预览包约 `1.80 MB`。
- 真实 CloudBase 已按部署清单完成收敛：20 个受管社交集合均为 `ADMINONLY`，31 个计划索引无缺失，`poker_social` 处于 `Active`，运行时、入口、资源配置、远端代码摘要与当前提交一致，且管理员白名单仅包含已确认账号。幂等复核返回 `Apply is already fully converged. No cloud resources were changed.`。
- 仍需由多个真实微信身份完成普通账号、管理员账号与第三账号的真机权限矩阵；该步骤不能由本地 mock、模拟器或无身份 CLI 调用替代。开发版上传继续保持显式授权后执行，不属于本次预览动作。
