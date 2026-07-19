# Plan 03 Task 4 补充报告：Task 5 消费合同修复

## 结果

已修复 Task 5 启动前确认的 Task 4 通知消费合同缺口；未实现或修改消息中心 UI。

- `list_notifications` 现在返回分页结果同一读取快照中的权威 `unreadCount`。
- `mark_notification_read` 现在返回同一事务计算并持久化的权威 `unreadCount`；已读重放返回当前服务端计数，不做客户端减一推算。
- `accept_friend_request` / `reject_friend_request` 现在返回服务端 `actionState` 与同一事务内读取的权威 `unreadCount`。
- 通知条目 DTO 收紧为 Task 5 锁定的白名单，移除冗余 `target` 与 `latestAt`，保留 `targetType` / `targetId`。
- 接受/拒绝不会隐式把好友申请通知标为已读；返回值忠实反映事务后的现有通知 state。

## TDD 证据

### RED

首次仅修改 `tests/social-notifications.test.js` 后运行：

```powershell
node --test tests/social-notifications.test.js
```

结果：9 通过、3 失败。失败分别为：

- `list_notifications.unreadCount` 为 `undefined`；
- `mark_notification_read.unreadCount` 缺失；
- 好友接受响应 `actionState` 缺失。

随后增加精确 DTO keys 断言并单独运行：

```powershell
node --test --test-name-pattern="notification DTO" tests/social-notifications.test.js
```

结果：0 通过、1 失败；实际 DTO 多出 `target` 与 `latestAt`。

### GREEN

最小实现后运行：

```powershell
node --test tests/social-notifications.test.js
```

结果：12/12 通过。

```powershell
node --test tests/social-notifications.test.js tests/social-friendship.test.js tests/social-player-card.test.js
```

结果：40/40 通过。

```powershell
$socialTests = Get-ChildItem tests -Filter 'social-*.test.js' | ForEach-Object { $_.FullName }
node --test $socialTests
```

结果：153/153 通过。

## 改动文件

- `cloudfunctions/poker_social/lib/notification.js`
- `cloudfunctions/poker_social/lib/friendship.js`
- `tests/social-notifications.test.js`
- `.superpowers/sdd/plan03-task-4-report.md`

## 实现选择

- 未读计数统一从 `social_notification_state` 读取/归一化，不扫描通知集合。
- mark-one 在事务内从已有 state 计算 next count，并将同一个值同时写入 state 与响应。
- 好友申请 action 响应在既有幂等事务内读取 actor 的通知 state；同 mutation ID 并发/重放返回持久化的同一完整结果。
- 不改变 cursor、watermark、聚合窗口或生产者原子性实现。

## 索引与部署

本补丁不新增集合或索引。原 Task 4 的 CloudBase 控制台要求保持不变：需确保 `social_notifications(recipientId ASC, createdAt DESC, _id DESC)` 复合索引已配置。

## 校验

以下文件均通过 `node --check`：

- `cloudfunctions/poker_social/lib/notification.js`
- `cloudfunctions/poker_social/lib/repository.js`
- `cloudfunctions/poker_social/app.js`
- `cloudfunctions/poker_social/lib/friendship.js`
- `cloudfunctions/poker_social/lib/player-card.js`
- `services/social-service.js`

`git diff --check` 退出码为 0；仅有 Git 的 LF/CRLF 工作副本提示，无空白错误。

## 偏差

无 UI 改动。相对最初 blocker 摘要额外修复了 Task 5 brief 明确要求的通知 DTO 精确白名单；这是启动 Task 5 必需的同一上游合同，不是功能扩展。
