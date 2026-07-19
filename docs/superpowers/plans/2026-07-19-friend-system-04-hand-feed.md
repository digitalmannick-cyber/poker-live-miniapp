# 手牌动态与互动 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现云端 BB 化匿名手牌快照、三种发布范围、统一动态、评论回复、贴纸、点赞、撤回和完整发布验收。

**Architecture:** 客户端只提交源 `handId` 和范围；云端读取本人私有手牌并从允许字段白名单构造不可变快照。所有读取与互动复用单一可见性策略，消息与计数通过幂等事务维护。

**Tech Stack:** 原生小程序、独立 `poker_social` 云函数、现有手牌数据模型、Node.js 测试、微信开发者工具预览。

## Global Constraints

- 第一版分享手牌只显示 BB，不提供真实金额切换。
- Hero 固定显示 `Hero`；其他玩家按稳定座位顺序使用夜鸦、赤狐、黑猫、银狼、幻蝶、灰隼、绯蛇、白鲸。
- 快照不包含盈亏、买入、带走、资金曲线、地点、场次名、玩家库字段、AI 私人分析和未摊牌底牌。
- 范围只允许 `square`、`friends`、`selected`，一次只能选择一个。
- 广场允许所有已登录用户浏览、评论和点赞；好友范围实时依赖当前好友关系。
- 发布者不能删除他人评论；只能撤回整条分享。
- 第一版不实现自动内容检测或举报，但执行长度、贴纸 ID与频率校验。

---

### Task 1: BB 化匿名快照生成器

**Files:**
- Create: `cloudfunctions/poker_social/lib/hand-snapshot.js`
- Modify: `cloudfunctions/poker_social/lib/social-error.js`
- Test: `tests/social-hand-snapshot.test.js`
- Test: `tests/social-hand-snapshot-security.test.js`

**Interfaces:**
- Produces: `buildHandSnapshot({ hand, actions, session }) -> HandSnapshot`。
- Produces: `resolveBigBlind(hand, session)`、`toBb(value, bigBlind)`、`assignAliases(seats)`。

- [ ] **Step 1: 写 BB、匿名和白名单失败测试**

```js
const snapshot = handSnapshot.buildHandSnapshot({
  hand: {
    heroPosition: 'BTN', heroCardsInput: 'AsKs', currentProfit: 5000,
    pot: 5000, players: [{ seat: 'BTN', name: 'Hero' }, { seat: 'SB', name: '老张' }, { seat: 'BB', name: '李总' }],
    board: { flop: 'Ah9s4d', turn: 'Kc', river: '2h' }
  },
  actions: [
    { street: 'preflop', seat: 'BTN', actionType: 'raise', amount: 1200 },
    { street: 'preflop', seat: 'SB', actionType: 'call', amount: 1200 }
  ],
  session: { bigBlind: 400, venue: '澳门私人局', title: '深夜局' }
})
assert.equal(snapshot.hero.label, 'Hero')
assert.equal(snapshot.potBb, 12.5)
assert.deepEqual(snapshot.players.map(item => item.label), ['Hero', '夜鸦', '赤狐'])
const text = JSON.stringify(snapshot)
;['profit', 'currentProfit', 'venue', 'title', '老张', 'avatar', 'leakTags', 'note'].forEach(field => assert.equal(text.includes(field), false))
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `node --test tests/social-hand-snapshot.test.js tests/social-hand-snapshot-security.test.js`

Expected: FAIL because hand-snapshot module is missing。

- [ ] **Step 3: 实现从零构造的白名单快照**

```js
const ALIASES = ['夜鸦', '赤狐', '黑猫', '银狼', '幻蝶', '灰隼', '绯蛇', '白鲸']

function toBb(value, bigBlind) {
  if (!(Number(bigBlind) > 0)) throw socialError('BLIND_REQUIRED')
  return Number((Number(value || 0) / Number(bigBlind)).toFixed(2))
}

function buildHandSnapshot(input) {
  const bigBlind = resolveBigBlind(input.hand, input.session)
  const seats = normalizeSeats(input.hand, input.actions)
  const aliasBySeat = assignAliases(seats)
  return {
    version: 1,
    hero: buildHero(input.hand),
    players: buildAnonymousPlayers(seats, aliasBySeat, input.hand),
    board: buildBoard(input.hand.board),
    actions: buildBbActions(input.actions, aliasBySeat, bigBlind),
    potBb: toBb(resolvePot(input.hand, input.actions), bigBlind),
    showdown: buildExplicitShowdown(input.hand, aliasBySeat)
  }
}
```

禁止用 `Object.assign({}, hand)` 再删除字段。`buildExplicitShowdown` 只接受原记录明确的摊牌标记；推测或未摊牌底牌返回空数组。

- [ ] **Step 4: 运行快照测试**

Run: `node --test tests/social-hand-snapshot.test.js tests/social-hand-snapshot-security.test.js`

Expected: PASS；缺失大盲时返回 `BLIND_REQUIRED`，同一座位跨街代号稳定。

- [ ] **Step 5: 提交快照生成器**

```powershell
git add cloudfunctions/poker_social/lib/hand-snapshot.js cloudfunctions/poker_social/lib/social-error.js tests/social-hand-snapshot.test.js tests/social-hand-snapshot-security.test.js
git commit -m "feat: build privacy-safe bb hand snapshots"
```

### Task 2: 发布、改范围与撤回 API

**Files:**
- Create: `cloudfunctions/poker_social/lib/hand-share.js`
- Modify: `cloudfunctions/poker_social/lib/visibility.js`
- Modify: `cloudfunctions/poker_social/lib/notification.js`
- Modify: `cloudfunctions/poker_social/app.js`
- Modify: `services/social-api.js`
- Modify: `services/social-service.js`
- Test: `tests/social-hand-share-policy.test.js`

**Interfaces:**
- Produces actions: `preview_hand_share`、`publish_hand`、`update_hand_share_scope`、`withdraw_hand_share`、`withdraw_shares_by_source_hand`。
- Write payload: `{ handId, scope, targetUserIds, clientMutationId }`。

- [ ] **Step 1: 写三范围权限矩阵失败测试**

```js
const rows = [
  { label: 'publisher', viewerId: 'su_a', share: { publisherId: 'su_a', status: 'active', scope: 'selected', targetUserIds: [] }, friendship: null, expected: true },
  { label: 'square stranger', viewerId: 'su_c', share: { publisherId: 'su_a', status: 'active', scope: 'square', targetUserIds: [] }, friendship: null, expected: true },
  { label: 'friend scope stranger', viewerId: 'su_c', share: { publisherId: 'su_a', status: 'active', scope: 'friends', targetUserIds: [] }, friendship: null, expected: false },
  { label: 'selected friend', viewerId: 'su_b', share: { publisherId: 'su_a', status: 'active', scope: 'selected', targetUserIds: ['su_b'] }, friendship: { status: 'accepted' }, expected: true }
]
for (const row of rows) {
  assert.equal(visibility.canReadShare(row.viewerId, row.share, row.friendship), row.expected, row.label)
}
assert.throws(
  () => handShare.validatePublishInput({ scope: 'selected', targetUserIds: [] }),
  error => error.code === 'INVALID_SHARE_SCOPE'
)
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `node --test tests/social-hand-share-policy.test.js`

Expected: FAIL because hand-share module and actions are missing。

- [ ] **Step 3: 实现服务端源读取、范围事务和定向通知**

```js
function validatePublishInput(input) {
  const scope = String(input.scope || '')
  if (!['square', 'friends', 'selected'].includes(scope)) throw socialError('INVALID_SHARE_SCOPE')
  const targets = Array.from(new Set(input.targetUserIds || []))
  if (scope === 'selected' && (targets.length < 1 || targets.length > 50)) throw socialError('INVALID_SHARE_SCOPE')
  if (scope !== 'selected' && targets.length) throw socialError('INVALID_SHARE_SCOPE')
  return { scope, targetUserIds: targets }
}
```

`publish_hand` 通过当前 OpenID 与 `playerId` 读取源手牌、行动和场次，调用 Task 1 生成快照。`friends` 读取时实时校验关系，不固化好友数组。改为 `square` 时要求 payload `publicShareConfirmed: true`。撤回使用软状态并使评论、点赞入口同时失效。

- [ ] **Step 4: 运行范围和幂等测试**

Run: `node --test tests/social-hand-share-policy.test.js tests/social-hand-snapshot.test.js tests/social-notifications.test.js`

Expected: PASS；伪造 publisher、源快照和非好友 target 均被拒绝。

- [ ] **Step 5: 提交分享 API**

```powershell
git add cloudfunctions/poker_social/lib/hand-share.js cloudfunctions/poker_social/lib/visibility.js cloudfunctions/poker_social/lib/notification.js cloudfunctions/poker_social/app.js services/social-api.js services/social-service.js tests/social-hand-share-policy.test.js
git commit -m "feat: publish social hands to three scopes"
```

### Task 3: 发布确认页面

**Files:**
- Create: `pages/social-hand-publish/social-hand-publish.js`
- Create: `pages/social-hand-publish/social-hand-publish.wxml`
- Create: `pages/social-hand-publish/social-hand-publish.wxss`
- Create: `pages/social-hand-publish/social-hand-publish.json`
- Modify: `pages/hand-detail/hand-detail.js`
- Modify: `pages/hand-detail/hand-detail.wxml`
- Modify: `pages/hand-detail/hand-detail.wxss`
- Modify: `app.json`
- Test: `tests/social-hand-publish-page.test.js`
- Test: `tests/hand-detail-export-entry.test.js`

**Interfaces:**
- Consumes: `previewHandShare(handId)` and `publishHand(input)`。
- Route: `/pages/social-hand-publish/social-hand-publish?handId=<encodedId>`。

- [ ] **Step 1: 写入口、三范围和公开确认失败测试**

```js
assert.match(handDetailWxml, /发布手牌/)
assert.match(publishWxml, /广场/)
assert.match(publishWxml, /全部好友/)
assert.match(publishWxml, /指定好友/)
assert.match(publishWxml, /统一转换为 BB/)
assert.match(publishJs, /publicShareConfirmed/)
assert.doesNotMatch(publishWxml, /显示金额|真实金额/)
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `node --test tests/social-hand-publish-page.test.js`

Expected: FAIL because publish page is missing。

- [ ] **Step 3: 实现服务端预览和互斥范围选择**

```js
async confirmPublish() {
  if (this.data.scope === 'selected' && !this.data.selectedFriendIds.length) {
    wx.showToast({ title: '请至少选择一位好友', icon: 'none' })
    return
  }
  if (this.data.scope === 'square' && !this.data.publicShareConfirmed) {
    const result = await showPublicConfirmModal()
    if (!result.confirm) return
    this.setData({ publicShareConfirmed: true })
  }
  await socialService.publishHand({
    handId: this.data.handId,
    scope: this.data.scope,
    targetUserIds: this.data.scope === 'selected' ? this.data.selectedFriendIds : [],
    publicShareConfirmed: this.data.publicShareConfirmed,
    clientMutationId: this.data.mutationId
  })
}
```

默认范围读取本人社交设置，初始为 `friends`。预览展示的所有数值来自云端快照 DTO；客户端不自行 BB 换算或匿名化。

- [ ] **Step 4: 运行发布与手牌详情回归**

Run: `node --test tests/social-hand-publish-page.test.js tests/hand-detail-export-entry.test.js tests/social-hand-share-policy.test.js`

Expected: PASS。

- [ ] **Step 5: 提交发布页面**

```powershell
git add pages/social-hand-publish pages/hand-detail app.json tests/social-hand-publish-page.test.js tests/hand-detail-export-entry.test.js
git commit -m "feat: add privacy-first hand publishing page"
```

### Task 4: 统一动态与手牌详情

**Files:**
- Create: `pages/social-hand-detail/social-hand-detail.js`
- Create: `pages/social-hand-detail/social-hand-detail.wxml`
- Create: `pages/social-hand-detail/social-hand-detail.wxss`
- Create: `pages/social-hand-detail/social-hand-detail.json`
- Modify: `components/friend-hub/friend-hub.js`
- Modify: `components/friend-hub/friend-hub.wxml`
- Modify: `components/friend-hub/friend-hub.wxss`
- Modify: `cloudfunctions/poker_social/lib/hand-share.js`
- Modify: `cloudfunctions/poker_social/app.js`
- Modify: `app.json`
- Test: `tests/social-feed.test.js`
- Test: `tests/social-hand-detail-page.test.js`

**Interfaces:**
- Produces actions: `list_feed({ cursor, limit: 20 })` and `get_hand_share({ shareId })`。
- Feed item includes `scopeLabel`, snapshot summary, `likedByMe`, `likeCount`, `commentCount`。

- [ ] **Step 1: 写混排、范围标签和小图标失败测试**

```js
assert.match(feedWxml, /广场/)
assert.match(feedWxml, /全部好友/)
assert.match(feedWxml, /指定好友/)
assert.match(feedWxml, /like-icon/)
assert.match(feedWxml, /comment-icon/)
assert.doesNotMatch(feedWxml, /action-button.*点赞[\s\S]*action-button.*评论/)
assert.match(feedWxss, /min-width:\s*72rpx|min-height:\s*72rpx/)
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `node --test tests/social-feed.test.js tests/social-hand-detail-page.test.js`

Expected: FAIL because feed and detail are absent。

- [ ] **Step 3: 实现单一时间流和白名单详情 DTO**

```js
async loadFeed(reset) {
  const cursor = reset ? null : this.data.feedCursor
  const page = await socialService.listFeed({ cursor, limit: 20 })
  this.setData({
    feedItems: reset ? page.items : this.data.feedItems.concat(page.items),
    feedCursor: page.nextCursor || null
  })
}
```

服务端查询广场候选和当前好友范围候选后统一按 `(createdAt, _id)` 倒序分页，再对每条调用 `canReadShare`。页面不提供“好友动态/广场动态”二级切换，只用范围标签说明。

- [ ] **Step 4: 运行动态、详情与 Demo 回归**

Run:

```powershell
node --test tests/social-feed.test.js tests/social-hand-detail-page.test.js tests/social-hand-share-policy.test.js
if ($LASTEXITCODE) { exit $LASTEXITCODE }
node tests/friend-feed-demo.test.js
```

Expected: PASS。

- [ ] **Step 5: 提交动态和详情**

```powershell
git add pages/social-hand-detail components/friend-hub cloudfunctions/poker_social/lib/hand-share.js cloudfunctions/poker_social/app.js app.json tests/social-feed.test.js tests/social-hand-detail-page.test.js
git commit -m "feat: add unified social hand feed"
```

### Task 5: 评论、回复、贴纸与点赞

**Files:**
- Create: `cloudfunctions/poker_social/lib/interaction.js`
- Create: `cloudfunctions/poker_social/lib/poker-stickers.js`
- Create: `utils/poker-stickers.js`
- Modify: `cloudfunctions/poker_social/lib/notification.js`
- Modify: `cloudfunctions/poker_social/app.js`
- Modify: `services/social-api.js`
- Modify: `services/social-service.js`
- Modify: `pages/social-hand-detail/social-hand-detail.js`
- Modify: `pages/social-hand-detail/social-hand-detail.wxml`
- Modify: `pages/social-hand-detail/social-hand-detail.wxss`
- Modify: `components/friend-hub/friend-hub.js`
- Test: `tests/social-comments.test.js`
- Test: `tests/social-likes.test.js`
- Test: `tests/social-interaction-ui.test.js`

**Interfaces:**
- Produces actions: `list_comments`、`create_comment`、`delete_comment`、`set_like`。
- Comment input: `{ shareId, parentCommentId, kind: 'text' | 'sticker', text, stickerId, clientMutationId }`。
- Both sticker modules export the exact same immutable `POKER_STICKER_IDS` array; the test compares them to prevent client/server drift。

- [ ] **Step 1: 写一层回复、删除规则和一人一赞失败测试**

```js
assert.throws(() => interaction.validateComment({ kind: 'text', text: 'x'.repeat(301) }), error => error.code === 'COMMENT_TOO_LONG')
assert.throws(() => interaction.validateReply(replyToReply), error => error.code === 'COMMENT_REPLY_DEPTH')
assert.equal(interaction.canDeleteComment('author', { authorId: 'author' }), true)
assert.equal(interaction.canDeleteComment('publisher', { authorId: 'other' }), false)
assert.equal(interaction.getLikeId('sh1', 'su1'), interaction.getLikeId('sh1', 'su1'))
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `node --test tests/social-comments.test.js tests/social-likes.test.js tests/social-interaction-ui.test.js`

Expected: FAIL because interaction module and UI are missing。

- [ ] **Step 3: 实现扁平评论、贴纸白名单与点赞事务**

```js
function validateComment(input) {
  if (input.kind === 'sticker') {
    if (!POKER_STICKER_IDS.includes(input.stickerId)) throw socialError('INVALID_STICKER')
    return { kind: 'sticker', stickerId: input.stickerId, text: '' }
  }
  const text = String(input.text || '').trim()
  if (!text || Array.from(text).length > 300) throw socialError('COMMENT_TOO_LONG')
  return { kind: 'text', text, stickerId: '' }
}
```

写评论、回复和点赞前再次调用 `canReadShare`。自己的评论软删除后 DTO 返回 `deleted: true` 和“该评论已删除”，回复继续展示。发布者页面不渲染删除他人评论入口。点赞激活图标红色并使用轻量缩放动效，reduced-motion 下关闭。

- [ ] **Step 4: 运行互动和消息测试**

Run: `node --test tests/social-comments.test.js tests/social-likes.test.js tests/social-interaction-ui.test.js tests/social-notifications.test.js tests/social-feed.test.js`

Expected: PASS。

- [ ] **Step 5: 提交互动能力**

```powershell
git add cloudfunctions/poker_social/lib/interaction.js cloudfunctions/poker_social/lib/notification.js cloudfunctions/poker_social/lib/poker-stickers.js cloudfunctions/poker_social/app.js utils/poker-stickers.js services/social-api.js services/social-service.js pages/social-hand-detail components/friend-hub tests/social-comments.test.js tests/social-likes.test.js tests/social-interaction-ui.test.js
git commit -m "feat: add social hand comments and likes"
```

### Task 6: 源手牌删除、账号清除与只读缓存

**Files:**
- Modify: `services/data-service.js`
- Modify: `services/social-service.js`
- Modify: `cloudfunctions/poker_social/lib/hand-share.js`
- Modify: `cloudfunctions/poker_social/app.js`
- Create: `utils/social-cache.js`
- Test: `tests/social-delete-cascade.test.js`
- Test: `tests/social-offline-cache.test.js`

**Interfaces:**
- Produces cloud actions: `withdraw_shares_by_source_hand`、`clear_my_social_data`。
- Produces services: `withdrawSharesBySourceHand(handId)`、`clearMySocialData(clientMutationId)`、`socialCache.get/set/remove(namespace)`。

- [ ] **Step 1: 写删除联动与离线只读测试**

```js
test('core hand deletion succeeds even if social withdrawal fails', async () => {
  socialApi.withdrawSharesBySourceHand = async () => { throw new Error('offline') }
  assert.equal(await dataService.deleteHand('hand_1'), true)
})

test('cached feed is read-only', () => {
  const cached = socialCache.get('feed')
  assert.equal(cached.readOnly, true)
  assert.equal(cached.items.length, 1)
})
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `node --test tests/social-delete-cascade.test.js tests/social-offline-cache.test.js`

Expected: FAIL because cascade and cache are missing。

- [ ] **Step 3: 实现尽力撤回、清除顺序与五分钟缓存**

```js
async function deleteHand(handId) {
  const deleted = await deleteHandFromPokerData(handId)
  if (deleted) {
    socialService.withdrawSharesBySourceHand(handId).catch(error => logCloudBackgroundFailure('withdraw social hand failed', error))
  }
  return deleted
}

function set(namespace, data) {
  wx.setStorageSync('socialCache:' + namespace, { savedAt: Date.now(), data })
}
```

`clearAllData` 必须先 `await clearMySocialData()`；失败时不显示“全部清除完成”，而是提示重试。动态、好友、排行榜、消息仅缓存第一页 5 分钟；缓存对象统一加 `readOnly: true`，离线时禁用所有写按钮。

- [ ] **Step 4: 运行删除、缓存和核心数据回归**

Run:

```powershell
node --test tests/social-delete-cascade.test.js tests/social-offline-cache.test.js tests/ai-reminder-cloud-write-flow.test.js
if ($LASTEXITCODE) { exit $LASTEXITCODE }
node tests/store-create-hand-reviewed-status.test.js
```

Expected: PASS。

- [ ] **Step 5: 提交一致性处理**

```powershell
git add services/data-service.js services/social-service.js cloudfunctions/poker_social/lib/hand-share.js cloudfunctions/poker_social/app.js utils/social-cache.js tests/social-delete-cascade.test.js tests/social-offline-cache.test.js
git commit -m "feat: cascade social withdrawals safely"
```

### Task 7: 频率限制、索引与安全总验收

**Files:**
- Create: `cloudfunctions/poker_social/lib/validation.js`
- Create: `cloudfunctions/poker_social/database-indexes.md`
- Modify: `cloudfunctions/poker_social/app.js`
- Create: `tests/social-rate-limit.test.js`
- Create: `tests/social-security-matrix.test.js`
- Create: `tests/social-sensitive-field-scan.test.js`

**Interfaces:**
- Produces: `enforceRateLimit({ actorId, action, nowMs, repository })`。
- Limits: friend request 20/day, hand share 20/hour, comment 10/minute, like toggle 30/minute, player card 20/day。

- [ ] **Step 1: 写频率限制和全权限矩阵测试**

```js
const limits = validation.RATE_LIMITS
assert.deepEqual(limits.comment, { count: 10, windowMs: 60_000 })
assert.deepEqual(limits.like, { count: 30, windowMs: 60_000 })
function buildFullVisibilityMatrix(config) {
  const accepted = { status: 'accepted' }
  const removed = { status: 'removed' }
  return config.statuses.flatMap(status => config.scopes.flatMap(scope => config.users.map(user => {
    const viewerId = user === 'publisher' ? 'su_a' : user === 'friend' ? 'su_b' : user === 'selectedFriend' ? 'su_c' : user === 'removedFriend' ? 'su_d' : 'su_e'
    const friendship = user === 'friend' || user === 'selectedFriend' ? accepted : user === 'removedFriend' ? removed : null
    const share = { publisherId: 'su_a', status, scope, targetUserIds: ['su_c'] }
    const expected = status === 'active' && (
      user === 'publisher' || scope === 'square' ||
      scope === 'friends' && friendship === accepted ||
      scope === 'selected' && friendship === accepted && viewerId === 'su_c'
    )
    return { name: [status, scope, user].join(':'), execute: () => visibility.canReadShare(viewerId, share, friendship), expected }
  })))
}

const scenarios = buildFullVisibilityMatrix({
  users: ['publisher', 'friend', 'selectedFriend', 'stranger', 'removedFriend'],
  scopes: ['square', 'friends', 'selected'],
  statuses: ['active', 'withdrawn']
})
for (const scenario of scenarios) {
  assert.equal(await scenario.execute(), scenario.expected, scenario.name)
}
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `node --test tests/social-rate-limit.test.js tests/social-security-matrix.test.js tests/social-sensitive-field-scan.test.js`

Expected: FAIL because validation and complete fixtures are missing。

- [ ] **Step 3: 实现限制并记录数据库索引**

```js
const RATE_LIMITS = Object.freeze({
  friendRequest: { count: 20, windowMs: 86_400_000 },
  handShare: { count: 20, windowMs: 3_600_000 },
  comment: { count: 10, windowMs: 60_000 },
  like: { count: 30, windowMs: 60_000 },
  playerCard: { count: 20, windowMs: 86_400_000 }
})
```

`database-indexes.md` 精确列出：`social_hand_shares(status, createdAt)`、`social_comments(shareId, status, createdAt)`、`social_notifications(recipientId, read, createdAt)`、`social_daily_stats(socialUserId, dateKey)`、`social_friendships(userA, status)`、`social_friendships(userB, status)`。所有社交集合客户端权限为拒绝读写。

- [ ] **Step 4: 运行全部社交和既有回归测试**

Run:

```powershell
Get-ChildItem tests\social-*.test.js | ForEach-Object { node --test $_.FullName; if ($LASTEXITCODE) { exit $LASTEXITCODE } }
node tests\player-notes-store.test.js
node tests\player-notes-navigation.test.js
node tests\player-notes-cloud-boundary.test.js
node tests\friend-feed-demo.test.js
node tests\friend-hand-share-demo.test.js
node tests\friend-list-message-demo.test.js
git diff --check
```

Expected: all commands exit `0`；响应扫描不出现 OpenID、盈亏、地点、私人 Note 或源手牌 ID。

- [ ] **Step 5: 提交安全验收**

```powershell
git add cloudfunctions/poker_social/lib/validation.js cloudfunctions/poker_social/database-indexes.md cloudfunctions/poker_social/app.js tests/social-rate-limit.test.js tests/social-security-matrix.test.js tests/social-sensitive-field-scan.test.js
git commit -m "test: enforce social security and rate limits"
```

### Task 8: 真实账号验收与发布候选

**Files:**
- Modify: `config/release-notes.js` only when the user explicitly authorizes a development-version upload or release。
- Modify: version source only when the user explicitly authorizes a development-version upload or release。

**Interfaces:**
- Verifies the entire friend-system design; creates no new business API。

- [ ] **Step 1: 部署测试环境集合与索引**

```text
创建 social_users、social_invites、social_friendships、social_daily_stats、social_hand_shares、social_comments、social_likes、social_player_card_shares、social_notifications、social_mutations 集合；按 database-indexes.md 建索引；客户端权限全部设为拒绝读写；部署 poker_social 测试函数。
```

- [ ] **Step 2: 三账号权限验收**

```text
账号 A 与 B 建立好友，C 保持非好友。A 分别发布广场、全部好友、指定 B 三手牌：B 可读取三条，C 只能读取广场；A 解除 B 后，B 刷新立即只能读取广场。验证旧评论点赞仍存储但好友范围不可继续互动。
```

- [ ] **Step 3: 隐私与名片验收**

```text
抓取好友详情、排行榜、动态、手牌详情和名片响应；确认无 OpenID、盈亏、地点、场次名、真实对手和玩家库私人字段。覆盖同名玩家后，接收方原玩家 ID与 battleHandIds 保持不变。
```

- [ ] **Step 4: 真实工作区 auto-preview 与合规复核**

Run: 使用 `skills/wechat-miniapp-auto-preview/SKILL.md` 对真实工作区执行预览，逐页核对四份 HTML Demo 的关键布局。

Expected: 编译和设备预览成功；公开广场发布前完成当期微信平台社区内容合规复核。若平台要求内容检测或举报能力，停止发布并把相关可拓展功能提升为发布前置任务。

- [ ] **Step 5: 等待用户明确发布授权**

```text
报告测试、预览、权限矩阵与合规复核结果。未获得“上传开发版”或“发布”明确指令前，不修改版本号、不更新发布公告、不执行 upload。
```
