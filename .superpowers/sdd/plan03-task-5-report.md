# Plan 03 Task 5 Report — 消息中心页面与未读入口

## Status

DONE

## Implemented

- 新增独立页面 `/pages/social-messages/social-messages`，保持五个底部 Tab 不变。
- 消息中心采用单一倒序时间流，支持 20 条游标分页、首屏/加载更多重试、空状态、全部已读、好友申请接受/拒绝和离线只读展示。
- 本地路由解析只消费 `kind + targetType + targetId` 白名单字段；忽略注入 URL/path。当前未实现手牌分享详情，因此四类 `hand_share` 通知安全显示“内容已不可访问”，不虚构路由。
- 新增共享未读状态：玩家页显示 `1..99 / 99+` 数字徽标，底部玩家 Tab 只显示布尔红点；路由轮询不发网络请求。
- 未读刷新使用 sequence + mutation epoch，旧 refresh 不能覆盖 mark-one/mark-all 的权威计数；mark-all 后强制新刷新可看到事务后新通知。
- 第一页缓存 TTL 为 5 分钟，按当前 `playerId` 隔离，并重新白名单化为批准的 9 字段 DTO；网络失败时只读使用新鲜缓存。
- 页面列表、分页、mark-read 与好友申请操作均有 single-flight / generation / unload 防护。
- 玩家库搜索、类型筛选、玩家卡片、空状态、创建入口与 `sourceKind: 'library'` 保持不变；仅修改页头消息入口。

## TDD evidence

### RED

首次仅新增两份测试后运行：

```powershell
node --test tests/social-message-center.test.js tests/social-tab-unread.test.js
```

结果：11 项中 10 项失败、1 项通过。失败明确覆盖页面未注册、路由/未读模块缺失、消息入口仍为“即将开放”、玩家 Tab 无红点。

竞态增量 RED：

```powershell
node --test tests/social-message-center.test.js
```

结果：10 项中 2 项失败；暴露重复点击发送两次 mark-read，以及已处理好友申请被误标为不可访问。修复后转绿。

### GREEN

Focused verification:

```powershell
node --test tests/social-message-center.test.js tests/social-tab-unread.test.js tests/social-notifications.test.js
node tests/player-notes-navigation.test.js
```

结果：34/34 通过；player notes navigation 通过。

Relevant regression verification:

```powershell
$socialTests = Get-ChildItem tests -Filter 'social-*.test.js' | ForEach-Object { $_.FullName }
node --test $socialTests
node tests/player-notes-store.test.js
```

结果：175/175 social tests 通过；player notes store 通过。

Static verification:

```powershell
node --check pages/social-messages/social-messages.js
node --check utils/social-unread-state.js
node --check utils/social-notification-route.js
node --check pages/player-notes/player-notes.js
node --check custom-tab-bar/index.js
git diff --check
```

结果：全部退出码 0。

## Scope notes

- 未修改任何通知云函数 handler 或 DTO。
- 未新增第六个 Tab。
- 未实现或猜测手牌分享详情路由。
- 共享工作树中的 Plan04 文档不属于本任务，不会纳入 Task5 提交。
