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

## Independent review fixes

Status: DONE

- 错误分类收紧：仅明确权限/目标失效码显示“内容已不可访问”；`SOCIAL_ERROR`、`NOTIFICATION_STATE_UNSTABLE` 与未知服务错误均显示“好友功能暂时不可用”。
- 账号身份统一检查显式登出；消息页请求同时捕获发起账号与 generation。隐藏、卸载或账号切换会使旧列表、load-more、写操作、缓存写入、toast 与页面回写全部失效。
- 切换账号开始刷新时立即清空旧账号页面数据，避免新请求等待期间展示上一账号消息。玩家页与 custom tab 同步在登出时清空 shared unread accountKey。
- 首页缓存改为精确结构 `{ accountId, items, nextCursor, unreadCount, savedAt }`，按账号校验、5 分钟过期、拒绝未来时间/非有限值/错误字段/登出/无账号，并对 storage 读写异常 fail closed。离线第一页应用缓存内权威未读数且保持只读；load-more 不续期缓存。
- 好友申请操作严格要求 `friend_request + friendship + 非空 targetId + pending`。接受/拒绝仅采用服务端合法终态和权威未读数，不再本地猜 actionState，也不再本地修改 read。
- mark-one、mark-all 与好友申请在失败重试链复用 mutation ID，只有服务端成功且响应合同完整时才清理。
- 首屏刷新显式清除 loading-more 状态并淘汰旧 success/failure；初次 `onLoad -> onShow` 不重复请求，隐藏后返回会刷新第一页。

Review RED evidence:

```powershell
node --test tests/social-message-center.test.js
```

结果：17 项中 7 项失败，分别复现错误误分类、缓存结构/隔离、账号切换陈旧回写、好友申请校验、mutation ID 重试和 load-more 刷新问题。

Review GREEN evidence:

```powershell
node --test tests/social-message-center.test.js tests/social-tab-unread.test.js tests/social-notifications.test.js tests/social-player-hub.test.js
$socialTests = Get-ChildItem tests -Filter 'social-*.test.js' | ForEach-Object { $_.FullName }
node --test $socialTests
node tests/player-notes-navigation.test.js
node tests/player-notes-store.test.js
```

结果：focused 49/49；全部 social 182/182；player navigation/store 通过；social player hub 8/8。

## Real handler cursor compatibility

Status: DONE

- 对齐通知 handler 的真实末页合同：`nextCursor` 可为 opaque string 或 `null`。
- 客户端在统一响应边界把 `null` 规范化为 `''`；number、object 与缺失的 `undefined` 继续按服务端合同错误 fail closed。
- 首屏不足 20 条可正常完成；多页列表在末页正常结束，不产生 `moreError`。
- 首页缓存只接收规范化后的 string，因此末页仍保存 `nextCursor: ''`，缓存结构合同不变。

Cursor RED evidence:

```powershell
node --test tests/social-message-center.test.js
```

结果：18 项中 3 项失败，分别复现首屏末页、陈旧刷新替换和末页缓存无法完成；非法游标类型保持拒绝。

Cursor GREEN evidence:

```powershell
node --test tests/social-message-center.test.js tests/social-tab-unread.test.js tests/social-notifications.test.js tests/social-player-hub.test.js
$socialTests = Get-ChildItem tests -Filter 'social-*.test.js' | ForEach-Object { $_.FullName }
node --test $socialTests
node tests/player-notes-navigation.test.js
node tests/player-notes-store.test.js
```

结果：focused 50/50；全部 social 183/183；player navigation/store 通过；social player hub 8/8。
