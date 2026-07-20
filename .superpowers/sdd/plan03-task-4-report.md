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

---

## Task 4 复审 Important 修复

### 修复内容

1. 通知 writer 现在统一强制 Task 5 canonical route target 合同：
   - `friend_request -> friendship`
   - `friend_accepted -> friend`
   - `selected_hand/comment/reply/like_aggregate -> hand_share`
   - `player_card -> player_card_share`
2. 已修正现有生产者：好友接受通知使用 `friend`，玩家名片通知使用 `player_card_share`；`targetId` 语义不变。
3. `social_notification_state` 增加内部单调 `version`。新增通知、mark-one 和 mark-all 每次影响 read/count 时均在原事务中递增版本。
4. `list_notifications` 在通知查询前后读取 state version：稳定时正常返回；检测到变化时只重试一次；连续两次变化时抛出 `NOTIFICATION_STATE_UNSTABLE`，绝不返回内部矛盾 DTO。
5. 稳定正常路径每页仍只执行一次通知列表查询；没有 UI 兼容旧 targetType。

### RED 证据

仅修改测试后运行：

```powershell
node --test tests/social-notifications.test.js
```

结果：11 通过、4 失败，失败准确覆盖：

- writer 未拒绝旧的 `social_user` / `player_card` targetType；
- query 与 state read 之间注入 mark-one 后只查询一次，复现 `read=false / unreadCount=0`；
- state 持续变化时没有安全失败；
- 生产 `friend_accepted` 仍返回 `social_user`。

### GREEN 证据

```powershell
node --test tests/social-notifications.test.js
```

结果：15/15 通过。

```powershell
node --test tests/social-notifications.test.js tests/social-friendship.test.js tests/social-player-card.test.js
```

结果：43/43 通过。

```powershell
$socialTests = Get-ChildItem tests -Filter 'social-*.test.js' | ForEach-Object { $_.FullName }
node --test $socialTests
```

结果：156/156 通过。

### 本轮改动文件

- `cloudfunctions/poker_social/lib/notification.js`
- `cloudfunctions/poker_social/lib/friendship.js`
- `cloudfunctions/poker_social/lib/player-card.js`
- `tests/social-notifications.test.js`
- `.superpowers/sdd/plan03-task-4-report.md`

本轮不新增集合或索引，也未修改任何页面、路由或 UI 文件。

---

## Task 4 历史通知 canonical target 兼容

### 修复内容

- 仅在通知 DTO 输出边界归一化两组已知历史 pair：
  - `friend_accepted + social_user -> friend`
  - `player_card + player_card -> player_card_share`
- canonical targetType 原样输出，`targetId` 语义不变。
- 其他 kind/targetType 不匹配、未知 kind、未知 targetType、原型属性名及空 targetId 均清空为 `{ targetType: '', targetId: '' }`，由 Task 5 按不可导航状态处理。
- writer 仍严格拒绝旧值；生产者与 UI 均不接受 legacy targetType。

### RED 证据

```powershell
node --test --test-name-pattern="legacy target pairs" tests/social-notifications.test.js
```

在修正测试导入后结果为 0 通过、1 失败：历史 `friend_accepted/social_user` 实际仍输出 `social_user`，期望为 `friend`。

### GREEN 证据

```powershell
node --test --test-name-pattern="legacy target pairs" tests/social-notifications.test.js
node --test tests/social-notifications.test.js
```

结果分别为 1/1 与 16/16 通过。

提交前完整验证：

- `node --test tests/social-notifications.test.js tests/social-friendship.test.js tests/social-player-card.test.js`：44/44 通过。
- 全部 `social-*.test.js`：157/157 通过。
- Task 4 列出的 6 个相关 JavaScript 文件均通过 `node --check`。
- `git diff --check` 退出码为 0。

### 本轮改动文件

- `cloudfunctions/poker_social/lib/notification.js`
- `tests/social-notifications.test.js`
- `.superpowers/sdd/plan03-task-4-report.md`

本轮仅改 DTO 归一化、测试与报告；未修改 UI、生产者写入合同、集合或索引。
