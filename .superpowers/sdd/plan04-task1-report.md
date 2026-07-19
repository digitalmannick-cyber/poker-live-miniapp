# Plan 04 Task 1 报告：BB 化匿名手牌快照

## 结论

Task 1 本地实现与自动化门禁完成。实现从真实 `hands`、`hand_actions`、`sessions`、`playerSnapshots` 字段白名单从零构造 `HandSnapshotV1`，不读取仓储、不读取 `hand.players`，也不解析 `streetInputs`、`streetSummary` 或其它文本 action fallback。

## 真实 Schema 核对

- full-ledger 保存的 `playerSnapshots[].slot` 使用 `ACTIVE_SLOTS` 物理座位键；`position` 是按钮旋转后的展示位置，持久值 `UTG+1` 在公开快照中规范化为 `UTG1`。
- `hand_actions` 使用 `street/actorSeat/actorLabel/actionType/amount/sequence`；真实街道值为 `Pre/Flop/Turn/River`，`actorSeat` 是 `ACTIVE_SLOTS` 的一基下标。
- `cloudfunctions/poker_data/index.js` 保留 `playerSnapshots` 及其它 full-ledger 字段。`services/cloud-repo.js` 的本地 `buildHandDoc` 未显式列出 `playerSnapshots/playerCount`，但本任务纯 builder 不读取仓储，调用方必须传入已经权威读取的 hand、actions、session。

## RED 证据

首次命令：

```powershell
node --test tests/social-hand-snapshot.test.js tests/social-hand-snapshot-security.test.js
```

结果：退出码 `1`，两个测试文件均因 `MODULE_NOT_FOUND: cloudfunctions/poker_social/lib/hand-snapshot` 失败。这是预期的缺失模块 RED，不是 fixture 或导入路径错误。

自审后又补充两个 fail-closed 门禁并先观察 RED：

```powershell
node --test tests/social-hand-snapshot-security.test.js
```

结果：退出码 `1`，`requires complete unique full-ledger slots and matching Hero seat position` 与 `rejects malformed persisted board and playerSnapshots containers` 按预期失败；根因分别为尚未校验 table-size 精确 position 集合，以及尚未拒绝错误容器类型。随后只增加对应最小校验。

## GREEN 证据

### Task 1 focused

```powershell
node --test tests/social-hand-snapshot.test.js tests/social-hand-snapshot-security.test.js
```

结果：`16/16` 通过，`0` 失败。

### 全部 social 回归

```powershell
$socialTests = Get-ChildItem tests -Filter 'social-*.test.js' | Sort-Object Name | ForEach-Object FullName
node --test $socialTests
```

结果：`204/204` 通过，`0` 失败。

### 相关 hand 回归

```powershell
$handTests = Get-ChildItem tests -Filter '*.test.js' |
  Where-Object { $_.Name -match 'hand|ledger|agent-export|store-full-entry' } |
  Sort-Object Name |
  ForEach-Object FullName
node --test $handTests
```

结果：`57/57` 通过，`0` 失败。范围包含 full-ledger 输入、牌局导出、回放、AI 建议、Agent export、迁移与手牌录入回归。

## 实现边界

- `resolveBigBlind` 严格按 `session.bigBlind -> hand.bigBlind -> stakeLevel` 解析，非法或缺失返回 `BLIND_REQUIRED`。
- `toBb` 仅接受有限、非负数值，最多保留两位小数并消除负零。
- full-ledger 只接受 6/8/9 人完整唯一 slot/position 集；legacy quick 只构造 Hero 与结构化 actions 实际出现的合法座位。
- Hero、board、showdown 卡牌使用严格 canonical 格式并进行街序、数量及全局重复校验。
- showdown 只认可 `actionType === 'show'`；full-ledger 从同座位 snapshot cards 取牌，legacy 只允许一个唯一非 Hero show actor 使用 `opponentCards`。
- 输出从零构造；递归门禁覆盖 OpenID、playerId、玩家库字段、头像、场地、Note、盈亏、EV、语音、AI、ledger/text summary 等禁用键和值。
- `app.js` 为 `BLIND_REQUIRED`、`INVALID_HAND_SNAPSHOT`、`HAND_ACTIONS_REQUIRED` 提供固定公开消息，内部错误文本不会返回客户端。

## Commit

本报告与实现将包含在同一提交：`feat: build privacy-safe bb hand snapshots`。最终提交哈希以 Git 提交记录为准。

## Concerns / 后续注意

- 本任务按合同保持纯函数，不负责仓储读取或权限判断；后续 publish/preview 任务必须在授权读取完成后把三类权威记录显式传入 builder。
- 本地 `services/cloud-repo.js` 与云端 `poker_data` 对 full-ledger 字段保留范围存在历史差异。当前 CloudBase 权威路径和真实保存 payload 满足 Task 1，但未来若复用本地 repo 构造分享源，必须先统一持久字段，不能在 snapshot builder 内补文本或客户端 fallback。
- 本任务未接入公开发布 action，也未新增客户端 payload 支持；这些属于后续 Plan 04 tasks。
