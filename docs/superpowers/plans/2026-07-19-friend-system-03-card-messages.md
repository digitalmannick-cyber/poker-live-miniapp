# 玩家名片与消息中心 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现一张玩家名片定向分享给一位好友、预览后新建或整体覆盖，以及统一站内消息中心。

**Architecture:** 云端只保存五字段玩家名片快照和唯一接收人；导入仍调用现有玩家库写接口。消息只保存跳转线索，打开目标时必须重新鉴权。

**Tech Stack:** 原生小程序、`poker_social`、现有玩家库 `data-service`、Node.js 测试。

## Global Constraints

- 名片仅包含头像、名称、玩家类型、Leak 标签和完整 Note。
- 名片不包含 `alias`、玩家 ID、对战手牌、统计、系统时间和云文件内部字段。
- 一次只选择一张名片和一位有效好友。
- 未导入分享 7 天后失效；已导入副本永久属于接收方。
- 覆盖只替换五类字段，保留接收方玩家 ID和对战手牌关联。
- 消息存在不代表目标可访问，点击时必须重新鉴权。

---

### Task 1: 玩家名片快照与定向权限

**Files:**
- Create: `cloudfunctions/poker_social/lib/player-card.js`
- Create: `cloudfunctions/poker_social/lib/visibility.js`
- Modify: `cloudfunctions/poker_social/app.js`
- Modify: `services/social-api.js`
- Modify: `services/social-service.js`
- Test: `tests/social-player-card.test.js`

**Interfaces:**
- Produces actions: `share_player_card`、`get_player_card_share`、`withdraw_player_card_share`、`confirm_player_card_import`。
- Produces pure mapper: `toCardShareDto(share, { viewerId, avatarUrl })`。
- Snapshot DTO: `{ shareId, sender, card: { avatarUrl, name, type, leakTags, note }, expiresAt, imported }`。
- `share_player_card` 只接收 `playerNoteId + targetUserId + clientMutationId`；源玩家记录必须由服务端按当前 `ownerOpenId + privatePlayerId + playerNoteId` 读取，且属于未归档的 `sourceKind: library`。客户端不得上传或覆盖快照字段。
- 创建、读取与确认导入时接收双方必须仍是 accepted 好友；解除后未导入分享立即失权。已导入副本由接收方玩家库持久化，不依赖分享继续可读。
- 分享者只能撤回自己的分享；接收者只能读取和确认导入发给自己的分享。所有写 action 都必须幂等。

- [x] **Step 1: 写五字段白名单与唯一接收人测试**

```js
const snapshot = playerCard.buildSnapshot({
  _id: 'player_1', name: '老张', alias: ['张总'], avatarFileId: 'cloud://a',
  type: '激进', leakTags: ['河牌过度诈唬'], note: '完整记录', battleHandIds: ['h1'], updatedAt: 10
})
assert.deepEqual(Object.keys(snapshot).sort(), ['avatarAsset', 'leakTags', 'name', 'note', 'type'])
assert.equal(JSON.stringify(snapshot).includes('alias'), false)
assert.throws(() => playerCard.validateTargets(['su_a', 'su_b']), error => error.code === 'INVALID_CARD_TARGET')
```

- [x] **Step 2: 运行测试确认 RED**

Run: `node --test tests/social-player-card.test.js`

Expected: FAIL because player-card module is missing。

- [x] **Step 3: 实现服务端源记录读取和七天有效期**

```js
function buildSnapshot(note) {
  return {
    avatarAsset: String(note.avatarFileId || note.avatarUrl || ''),
    name: String(note.name || '').trim(),
    type: String(note.type || '未分类').trim(),
    leakTags: normalizeStringList(note.leakTags),
    note: String(note.note || '').trim()
  }
}

function canReadCardShare(viewerId, share, nowMs) {
  return share.status === 'active' && share.targetUserId === viewerId && (share.imported || Number(share.expiresAt) > nowMs)
}
```

`share_player_card` 只接受 `playerNoteId` 和 `targetUserId`，由云端按当前 `ownerOpenId + privatePlayerId` 精确读取源记录并构造快照；不接受客户端上传完整快照。`avatarAsset` 仅允许服务端已有 `avatarFileId` 或安全的 HTTPS 资源，响应转换为临时 `avatarUrl`，不返回云文件 ID、本地路径或 data URI。

- [x] **Step 4: 运行名片权限测试**

Run: `node --test tests/social-player-card.test.js tests/social-friendship.test.js`

Expected: PASS；覆盖非目标好友、解除好友、撤回、7 天过期和已导入副本。

- [x] **Step 5: 提交名片云端能力**

```powershell
git add cloudfunctions/poker_social/lib/player-card.js cloudfunctions/poker_social/lib/visibility.js cloudfunctions/poker_social/app.js services/social-api.js services/social-service.js tests/social-player-card.test.js
git commit -m "feat: add restricted player card sharing"
```

### Task 2: 名片分享入口与好友单选

**Files:**
- Modify: `pages/player-note-detail/player-note-detail.js`
- Modify: `pages/player-note-detail/player-note-detail.wxml`
- Modify: `pages/player-note-detail/player-note-detail.wxss`
- Test: `tests/social-player-card-share-ui.test.js`

**Interfaces:**
- Consumes: `socialService.listFriends()`、`socialService.sharePlayerCard({ playerNoteId, targetUserId, clientMutationId })`。
- Produces a single selected `targetUserId`。

- [ ] **Step 1: 写单选和预览字段失败测试**

```js
assert.match(detailWxml, /分享玩家名片/)
assert.match(detailWxml, /玩家类型/)
assert.match(detailWxml, /Leak/)
assert.match(detailWxml, /Note/)
assert.match(detailJs, /selectedCardFriendId/)
assert.doesNotMatch(detailJs, /selectedCardFriendIds/)
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `node --test tests/social-player-card-share-ui.test.js`

Expected: FAIL because card sharing UI is absent。

- [ ] **Step 3: 实现完整预览与单好友确认**

```js
const socialMutation = require('../../utils/social-mutation')

async confirmSharePlayerCard() {
  const targetUserId = this.data.selectedCardFriendId
  if (!targetUserId) {
    wx.showToast({ title: '请选择一位好友', icon: 'none' })
    return
  }
  await socialService.sharePlayerCard({
    playerNoteId: this.data.id,
    targetUserId,
    clientMutationId: socialMutation.createMutationId('share_player_card')
  })
  this.setData({ cardShareVisible: false, selectedCardFriendId: '' })
}
```

底部面板展示将被分享的五类内容，不默认选择好友，不提供“全部好友”或多选入口。

- [ ] **Step 4: 运行详情与分享 UI 回归**

Run:

```powershell
node --test tests/social-player-card-share-ui.test.js tests/social-friend-detail.test.js
if ($LASTEXITCODE) { exit $LASTEXITCODE }
node tests/player-notes-navigation.test.js
```

Expected: PASS。

- [ ] **Step 5: 提交分享入口**

```powershell
git add pages/player-note-detail tests/social-player-card-share-ui.test.js
git commit -m "feat: share one player card with one friend"
```

### Task 3: 新建或整体覆盖导入

**Files:**
- Create: `utils/player-card-import.js`
- Create: `pages/social-card-preview/social-card-preview.js`
- Create: `pages/social-card-preview/social-card-preview.wxml`
- Create: `pages/social-card-preview/social-card-preview.wxss`
- Create: `pages/social-card-preview/social-card-preview.json`
- Modify: `app.json`
- Modify: `services/social-service.js`
- Test: `tests/social-player-card-import.test.js`
- Test: `tests/social-player-card-preview-page.test.js`

**Interfaces:**
- Produces: `normalizePlayerName(name)`、`findDuplicateByName(notes, name)`、`buildCardOverwritePatch(card)`。
- Route: `/pages/social-card-preview/social-card-preview?shareId=<id>`。

- [ ] **Step 1: 写重复检测与覆盖保留测试**

```js
const existing = { _id: 'p1', name: ' 老 张 ', battleHandIds: ['h1'], alias: ['旧别名'], createdAt: 1 }
assert.equal(importer.findDuplicateByName([existing], '老张')._id, 'p1')
const patch = importer.buildCardOverwritePatch({ name: '老张', type: '激进', leakTags: ['x'], note: 'n', avatarUrl: 'u' })
assert.deepEqual(Object.keys(patch).sort(), ['avatarUrl', 'leakTags', 'name', 'note', 'type'])
assert.equal(Object.hasOwn(patch, 'battleHandIds'), false)
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `node --test tests/social-player-card-import.test.js tests/social-player-card-preview-page.test.js`

Expected: FAIL because importer and page are missing。

- [ ] **Step 3: 实现新建、覆盖与幂等确认**

```js
const socialMutation = require('../../utils/social-mutation')

async importAsNew() {
  const mutationId = this.data.importMutationId || socialMutation.createMutationId('import_player_card')
  this.setData({ importMutationId: mutationId })
  const created = await dataService.createPlayerNote(importer.buildCardOverwritePatch(this.data.share.card))
  await socialService.confirmPlayerCardImport({ shareId: this.data.share.shareId, playerNoteId: created._id, clientMutationId: mutationId })
  this.setData({ imported: true })
}

async overwriteExisting() {
  const target = this.data.duplicate
  await dataService.updatePlayerNote(target._id, importer.buildCardOverwritePatch(this.data.share.card))
  await socialService.confirmPlayerCardImport({ shareId: this.data.share.shareId, playerNoteId: target._id, clientMutationId: this.data.importMutationId })
  this.setData({ imported: true })
}
```

覆盖确认文案明确列出“替换头像、名称、玩家类型、Leak、Note；保留对战手牌”。不提供逐字段勾选。

- [ ] **Step 4: 运行导入与玩家库测试**

Run:

```powershell
node --test tests/social-player-card-import.test.js tests/social-player-card-preview-page.test.js
if ($LASTEXITCODE) { exit $LASTEXITCODE }
node tests/player-notes-store.test.js
```

Expected: PASS；网络重试使用同一 mutation ID，不创建第二份玩家记录。

- [ ] **Step 5: 提交导入页面**

```powershell
git add utils/player-card-import.js pages/social-card-preview app.json services/social-service.js tests/social-player-card-import.test.js tests/social-player-card-preview-page.test.js
git commit -m "feat: import shared player cards safely"
```

### Task 4: 通知模型与聚合

**Files:**
- Create: `cloudfunctions/poker_social/lib/notification.js`
- Modify: `cloudfunctions/poker_social/app.js`
- Modify: `cloudfunctions/poker_social/lib/friendship.js`
- Modify: `cloudfunctions/poker_social/lib/player-card.js`
- Modify: `services/social-api.js`
- Modify: `services/social-service.js`
- Test: `tests/social-notifications.test.js`

**Interfaces:**
- Produces actions: `list_notifications`、`mark_notification_read`、`mark_all_notifications_read`、`get_unread_count`。
- Notification kinds: `friend_request`、`friend_accepted`、`selected_hand`、`comment`、`reply`、`like_aggregate`、`player_card`。

- [ ] **Step 1: 写游标、聚合与重鉴权测试**

```js
const key = notification.getLikeAggregateKey('recipient_1', 'share_1', 600_000)
assert.equal(key, notification.getLikeAggregateKey('recipient_1', 'share_1', 601_000))
const page = notification.toNotificationPage(rows, { limit: 20 })
assert.equal(page.items.length, 20)
assert.ok(page.nextCursor.createdAt)
assert.equal(Object.hasOwn(page.items[0], 'ownerOpenId'), false)
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `node --test tests/social-notifications.test.js`

Expected: FAIL because notification module is missing。

- [ ] **Step 3: 实现消息写入和十分钟点赞聚合**

```js
function getLikeAggregateKey(recipientId, shareId, nowMs) {
  const bucket = Math.floor(nowMs / (10 * 60 * 1000))
  return ['like', recipientId, shareId, bucket].join('_')
}

function toNotificationDto(row) {
  return {
    notificationId: row._id, kind: row.kind, actor: row.actorSnapshot,
    targetType: row.targetType, targetId: row.targetId,
    aggregateCount: Number(row.aggregateCount) || 1,
    read: !!row.read, createdAt: row.createdAt
  }
}
```

好友申请、接受和玩家名片分享在同一业务事务后写消息。通知 DTO 不携带访问令牌或权限结果，目标页面打开时调用目标读取 action。

- [ ] **Step 4: 运行消息和前序业务测试**

Run: `node --test tests/social-notifications.test.js tests/social-friendship.test.js tests/social-player-card.test.js`

Expected: PASS。

- [ ] **Step 5: 提交通知模型**

```powershell
git add cloudfunctions/poker_social/lib/notification.js cloudfunctions/poker_social/app.js cloudfunctions/poker_social/lib/friendship.js cloudfunctions/poker_social/lib/player-card.js services/social-api.js services/social-service.js tests/social-notifications.test.js
git commit -m "feat: add social notification model"
```

### Task 5: 消息中心页面与未读入口

**Files:**
- Create: `pages/social-messages/social-messages.js`
- Create: `pages/social-messages/social-messages.wxml`
- Create: `pages/social-messages/social-messages.wxss`
- Create: `pages/social-messages/social-messages.json`
- Modify: `app.json`
- Modify: `pages/player-notes/player-notes.js`
- Modify: `pages/player-notes/player-notes.wxml`
- Modify: `custom-tab-bar/index.js`
- Modify: `custom-tab-bar/index.wxml`
- Modify: `utils/tab-bar.js`
- Test: `tests/social-message-center.test.js`
- Test: `tests/social-tab-unread.test.js`

**Interfaces:**
- Consumes: notification actions from Task 4 and friendship actions from Plan 01。
- Produces: message-center route, numeric header badge and boolean player-tab red dot。

- [ ] **Step 1: 写消息页面与红点失败测试**

```js
assert.ok(appConfig.pages.includes('pages/social-messages/social-messages'))
assert.match(messageWxml, /全部已读/)
assert.match(messageJs, /acceptFriendRequest/)
assert.match(messageJs, /rejectFriendRequest/)
assert.match(messageJs, /内容已不可访问/)
assert.match(tabWxml, /socialUnread/)
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `node --test tests/social-message-center.test.js tests/social-tab-unread.test.js`

Expected: FAIL because message center is missing。

- [ ] **Step 3: 实现消息跳转和安全失效状态**

```js
async openMessage(event) {
  const item = event.currentTarget.dataset.item
  await socialService.markNotificationRead(item.notificationId)
  try {
    const url = resolveNotificationRoute(item)
    await navigateTo(url)
  } catch (error) {
    if (['CONTENT_UNAVAILABLE', 'FRIENDSHIP_REQUIRED', 'FORBIDDEN'].includes(error.code)) {
      this.setData({ unavailableVisible: true })
      return
    }
    throw error
  }
}
```

消息列表每页 20 条，未读数显示上限 `99+`；全部已读成功后立即清零页面徽标和底部玩家 Tab 红点。好友申请消息内直接提供接受/拒绝。

- [ ] **Step 4: 运行消息、导航与 Tab 回归**

Run:

```powershell
node --test tests/social-message-center.test.js tests/social-tab-unread.test.js tests/social-notifications.test.js
if ($LASTEXITCODE) { exit $LASTEXITCODE }
node tests/player-notes-navigation.test.js
```

Expected: PASS。

- [ ] **Step 5: 提交消息页面**

```powershell
git add pages/social-messages app.json pages/player-notes custom-tab-bar utils/tab-bar.js tests/social-message-center.test.js tests/social-tab-unread.test.js
git commit -m "feat: add in-app social message center"
```

### Task 6: 第三计划验收

**Files:**
- Create: `tests/social-card-message-security.test.js`

**Interfaces:**
- Verifies Tasks 1-5 and previous friendship/player-note boundaries。

- [ ] **Step 1: 写名片敏感字段扫描**

```js
const cardDto = playerCard.toCardShareDto({
  _id: 'pcs_1', targetUserId: 'su_target', expiresAt: Date.now() + 1000,
  snapshot: { avatarAsset: 'server-only', name: '老张', type: '激进', leakTags: ['x'], note: 'n' }
}, { viewerId: 'su_target', avatarUrl: 'https://temp/avatar' })
const text = JSON.stringify(cardDto)
;['alias', 'battleHandIds', 'linkedHandIds', 'playerNoteId', 'ownerOpenId', '_openid', 'createdAt', 'updatedAt', 'avatarFileId'].forEach(field => {
  assert.equal(text.includes(field), false, field + ' leaked')
})
```

- [ ] **Step 2: 运行第三计划测试集**

Run: `node --test tests/social-player-card.test.js tests/social-player-card-share-ui.test.js tests/social-player-card-import.test.js tests/social-player-card-preview-page.test.js tests/social-notifications.test.js tests/social-message-center.test.js tests/social-tab-unread.test.js tests/social-card-message-security.test.js`

Expected: PASS。

- [ ] **Step 3: 运行玩家库回归**

Run: `node tests/player-notes-store.test.js; node tests/player-notes-navigation.test.js; node tests/player-notes-cloud-boundary.test.js`

Expected: all exit `0`。

- [ ] **Step 4: 真实工作区预览**

Run: 使用 `skills/wechat-miniapp-auto-preview/SKILL.md` 预览名片单好友分享、预览、新建、整体覆盖、消息接受/拒绝和失效状态。

Expected: 玩家库已有对战手牌在覆盖后保持；不上传开发版。

- [ ] **Step 5: 提交验收测试**

```powershell
git add tests/social-card-message-security.test.js
git commit -m "test: secure player card and message flows"
```
