# 手牌动态与互动 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现云端 BB 化匿名手牌快照、三种发布范围、统一动态、评论回复、贴纸、点赞、撤回和完整发布验收。

**Architecture:** 客户端只提交 action 所需 ID、服务端 `previewHash`、范围参数和写操作 mutation ID；云端读取本人私有手牌并从允许字段白名单构造不可变快照。所有读取与互动复用单一可见性策略；唯一 active、rolling 限流、input fingerprint 与 selected 通知意图均在服务端事务边界维护。

**Tech Stack:** 原生小程序、独立 `poker_social` 云函数、现有手牌数据模型、Node.js 测试、微信开发者工具预览。

## Global Constraints

- 第一版分享手牌只显示 BB，不提供真实金额切换。
- Hero 固定显示 `Hero`；其他玩家按稳定数值座位顺序使用夜鸦、赤狐、黑猫、银狼、幻蝶、灰隼、绿蛇、白鲸。
- 快照不包含盈亏、买入、带走、资金曲线、地点、场次名、玩家库字段、AI 私人分析和未摊牌底牌。
- 范围只允许 `square`、`friends`、`selected`，一次只能选择一个。
- 广场允许所有已登录用户浏览、评论和点赞；好友范围实时依赖当前好友关系。
- 发布者不能删除他人评论；只能撤回整条分享。
- 第一版不实现自动内容检测或举报，但执行长度、贴纸 ID与频率校验。

---

### Task 1: BB 化匿名快照生成器

**Files:**
- Create: `cloudfunctions/poker_social/lib/hand-snapshot.js`
- Modify: `cloudfunctions/poker_social/app.js`
- Test: `tests/social-hand-snapshot.test.js`
- Test: `tests/social-hand-snapshot-security.test.js`

**Interfaces:**
- Produces: `buildHandSnapshot({ hand, actions, session }) -> HandSnapshotV1`。
- Produces: `resolveBigBlind(hand, session)`、`toBb(value, bigBlind)`、`assignAliases(seats)`。
- Inputs use the real persisted `hands`、`hand_actions`、`sessions` and `playerSnapshots` shapes; no `hand.players` or text-action fallback exists。

**Approved contract:**

- Construct `HandSnapshotV1` from zero. Never clone a database row and delete fields, and never pass unknown nested values through.
- Allowed sources are exact: hand `_id/sessionId/updatedAt/stakeLevel/bigBlind/playerCount/heroSeat/heroPosition/heroCardsInput/board.flop/board.turn/board.river/effectiveStack/potSize/allInPot/opponentCards/opponentCardsSource/villainPosition/playerSnapshots`; actions `_id/updatedAt/street/actorSeat/actorLabel/actionType/amount/sequence`; session `_id/bigBlind`; snapshot `slot/position/stack/initialStack/cards`. “Allowed to read” never means pass through.
- `hero`、`players`、`board`、`actions`、`showdown` always exist; `players` excludes Hero. Public optional numeric fields are only `effectiveStackBb`、`potBb`、`allInPotBb`、seat `stackBb` and action `amountBb`.

```js
{
  version: 1,
  hero: { label: 'Hero', seat: 6, position: 'BTN', cards: ['As', 'Ks'], stackBb: 100 },
  players: [{ seat: 1, position: 'SB', label: '夜鸦', stackBb: 80 }],
  board: { flop: [], turn: [], river: [] },
  actions: [{ street: 'preflop', actor: 'Hero', type: 'raise', amountBb: 3 }],
  effectiveStackBb: 100,
  potBb: 12.5,
  allInPotBb: 0,
  showdown: [{ actor: '夜鸦', cards: ['Qh', 'Qs'] }]
}
```
- The only action source is ordered `hand_actions` with `{ street, actorSeat, actorLabel, actionType, amount, sequence }`. Missing actions returns `HAND_ACTIONS_REQUIRED`; unknown street/action/seat returns `INVALID_HAND_SNAPSHOT`. Do not read `potAfter` or reconstruct per-action pots.
- Big blind resolution is strictly `session.bigBlind` then `hand.bigBlind` then the right side of a strict numeric `smallBlind / bigBlind` `stakeLevel`. Missing/invalid blind returns `BLIND_REQUIRED`. `toBb` accepts only finite non-negative values, rounds to at most two decimals and normalizes negative zero.
- Hero has exactly two canonical `[2-9TJQKA][shdc]` cards. Board is empty or legal 3/1/1 in street order. Illegal, skipped or duplicate cards fail closed.
- For full-ledger rows, map `playerSnapshots[].slot` through the exact `ACTIVE_SLOTS` tables for 6/8/9 handed play, require a complete unique slot set, and cross-check hero/action seat and normalized position. For legacy quick-record rows without snapshots, require `playerCount` 2–9 and construct only legal seats seen in Hero/actions; never invent inactive players or stacks.

```js
const ACTIVE_SLOTS = {
  6: ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'],
  8: ['BTN', 'SB', 'BB', 'UTG', 'UTG1', 'MP', 'HJ', 'CO'],
  9: ['BTN', 'SB', 'BB', 'UTG', 'UTG1', 'MP', 'LJ', 'HJ', 'CO']
}
```
- Non-Hero aliases are exactly `夜鸦、赤狐、黑猫、银狼、幻蝶、灰隼、绿蛇、白鲸`, assigned by numeric seat ascending and reused across streets.
- Showdown requires structured `actionType === 'show'`. Resolve each showing seat to its same-seat snapshot cards; legacy `opponentCards` is allowed only for one uniquely mapped non-Hero show actor. Muck, river call, free text and guessed cards are never evidence.
- Source construction may read only the approved hand/action/session/snapshot fields. Recursive output scans must reject at least `ownerOpenId/_openid/privatePlayerId/sessionId/sourceHandId/playerId/playerNoteId/playerName/linkedFriendUserId/avatarFileId/avatarUrl/venue/title/notes/note/mindJourney/leakTags/tags/battleHandIds/profit/currentProfit/resultBB/allInEv/allInEvProfit/allInEvAdjustedProfit/buyIn/cashOut/voiceNote/voiceExtract/aiReview/ledgerState/streetInputs/streetSummary`, both as keys and canary values.
- Add public fixed messages for `BLIND_REQUIRED`、`INVALID_HAND_SNAPSHOT` and `HAND_ACTIONS_REQUIRED`; these codes must not collapse to `SOCIAL_ERROR`.

- [ ] **Step 1: Write real-schema, BB, seat, cards, showdown and recursive-canary tests**

Cover 6/8/9 `ACTIVE_SLOTS`, legacy quick-record, every allowed BB field, strict blind parsing, invalid numbers, unknown actions, invalid seats, missing actions, card count/order/duplicates, multi-show and every prohibited key/value. Tests must use real persisted field names, not invented `players` arrays.

- [ ] **Step 2: Run the Task 1 gate and confirm RED**

```powershell
node --test tests/social-hand-snapshot.test.js tests/social-hand-snapshot-security.test.js
```

Expected: FAIL for missing `hand-snapshot` behavior, not fixture/import mistakes.

- [ ] **Step 3: Implement exact whitelist DTO, BB conversion and deterministic seat mapping**

Implement the smallest pure builder that satisfies the approved contract. Do not add repository reads, client payload support, text parsing or result fields to the snapshot module.

- [ ] **Step 4: Implement strict cards/actions/showdown validation and public typed errors**

Keep every invalid/ambiguous source path fail closed. Public messages are fixed and contain no hand ID, owner/player or raw exception content.

- [ ] **Step 5: Run focused, social/hand regressions and static checks**

```powershell
node --test tests/social-hand-snapshot.test.js tests/social-hand-snapshot-security.test.js
if ($LASTEXITCODE) { exit $LASTEXITCODE }
$socialTests = Get-ChildItem tests -Filter 'social-*.test.js' | ForEach-Object { $_.FullName }
node --test $socialTests
node --check cloudfunctions/poker_social/lib/hand-snapshot.js
node --check cloudfunctions/poker_social/app.js
git diff --check <task-base>..<task-head>
```

Expected: all commands exit `0`; any pre-existing baseline failure is listed explicitly.

- [ ] **Step 6: Submit Task 1 for specification review, then code review, then commit**

```powershell
git add cloudfunctions/poker_social/lib/hand-snapshot.js cloudfunctions/poker_social/app.js tests/social-hand-snapshot.test.js tests/social-hand-snapshot-security.test.js
git commit -m "feat: build privacy-safe bb hand snapshots"
```

### Task 2: 发布、改范围与撤回 API

**Files:**
- Create: `cloudfunctions/poker_social/lib/hand-share.js`
- Modify: `cloudfunctions/poker_social/lib/visibility.js`
- Modify: `cloudfunctions/poker_social/lib/idempotency.js`
- Modify: `cloudfunctions/poker_social/lib/notification.js`
- Modify: `cloudfunctions/poker_social/lib/repository.js`
- Modify: `cloudfunctions/poker_social/app.js`
- Modify: `cloudfunctions/poker_social/database-indexes.md`
- Modify: `services/social-api.js`
- Modify: `services/social-service.js`
- Modify: `tests/helpers/social-fixture.js`
- Test: `tests/social-hand-share-policy.test.js`
- Test: `tests/social-notifications.test.js`

**Interfaces:**
- Produces actions: `preview_hand_share`、`publish_hand`、`update_hand_share_scope`、`withdraw_hand_share`、`withdraw_shares_by_source_hand`。
- `preview_hand_share({ handId }) -> { previewHash, snapshot, defaultShareScope }` is read-only and needs no mutation ID。
- `publish_hand({ handId, previewHash, scope, targetUserIds, publicShareConfirmed, clientMutationId }) -> { shareId, status: 'active', scope }`。
- Scope update, withdraw and source-hand withdraw accept only their identifier, normalized scope fields where applicable, and `clientMutationId`; clients never submit a snapshot, hand/session/actions, playerId or BB values。

**Approved contract:**

- `loadOwnedHandBundle` resolves the current `social_users` by OpenID, then point-reads `hands` and `sessions` and queries `hand_actions` under the exact same `ownerOpenId + privatePlayerId + handId`, ordered by `sequence ASC, _id ASC`; cross-owner/player/missing ownership returns `FORBIDDEN` without existence disclosure.
- Preview and publish call the same bundle loader and Task 1 builder. SHA-256 stable serialization of `{ version: 1, handId, handUpdatedAt: Number(hand.updatedAt) || 0, actionRevision: actions.map(a => [a._id, a.sequence, a.updatedAt || 0]), snapshot }`. Publish must supply the server preview hash, rebuild everything, and return `HAND_PREVIEW_STALE` with zero writes on any difference.
- Scope is exactly `square | friends | selected`. `square` and `friends` require an empty target array; square requires explicit public confirmation. Friends publish requires at least one accepted friend. Selected accepts a deduplicated 1–50 string IDs and point-reads every deterministic friendship again inside the write transaction; any invalid target aborts the whole write.
- Extend `runIdempotent` with an optional SHA-256 of stable serialization over `{ action, handId, shareId, previewHash, scope, targetUserIds: sortedUniqueTargets, publicShareConfirmed: scope === 'square' && confirmed }`. Same actor/action/mutation/fingerprint restores; a different action or fingerprint returns `MUTATION_CONFLICT` before callback. Existing callers without fingerprints retain their behavior.
- Enforce one active share with `social_hand_share_slots`, ID `shs_ + sha256(JSON.stringify([publisherId, handId]))`. The transaction repairs stale pointers, increments generation, creates a new random share ID and stores an immutable snapshot. Withdraw soft-deletes and clears the slot only if it still points to that share. Republish never reuses a share ID; scope update never changes snapshot, creation time or ID.
- Enforce a rolling `(nowMs - 3_600_000, nowMs]` maximum of 20 successful creates with deterministic rate ID `rl_ + sha256(JSON.stringify([publisherId, 'publish_hand']))` and a sorted `publishedAt` array capped at 20. Drop timestamps on the left boundary; the 20th succeeds and 21st fails `RATE_LIMITED`. Only a newly committed share appends. Restore, preview, failures, scope changes and withdrawals do not count. Rate/share/slot/outbox commit together.
- Selected notifications use the existing canonical `selected_hand + hand_share` writer through a single transaction outbox, never 50 notification/state pairs in the publish transaction. Publish and newly added selected targets write one outbox with ID `no_ + sha256(JSON.stringify(['selected_hand', shareId, sortedNewTargetIds]))`, minimal publisher display snapshot, sorted targets, delivery/skipped state and no OpenID/playerId/handId/full snapshot. Post-commit delivery uses one idempotent transaction per target and stable `sourceEventId = selected_hand:${shareId}:${targetUserId}`.
- Initial publish/update and mutation restore drain at most 10 targets. `list_notifications` and `get_unread_count` compensate at most 5 recipient outboxes with 10 targets each. Delivery rechecks active share, current selected membership and accepted friendship; invalid targets are skipped, removal/re-add never duplicates, and publisher is never a target.
- Add `social_hand_shares`、`social_hand_share_slots`、`social_rate_limits`、`social_notification_outbox` to repository constants, deployment/account-clear scope and denied client permissions. Production cannot fall back to full scans. Declare and shape-test:

```text
social_hand_shares: status ASC, scope ASC, createdAt DESC, _id DESC
social_hand_shares: publisherId ASC, status ASC, createdAt DESC, _id DESC
social_hand_shares: targetUserIds ARRAY, status ASC, createdAt DESC, _id DESC
social_hand_share_slots: point-read only by deterministic _id
social_rate_limits: point-read only by deterministic _id
social_notification_outbox: status ASC, targetUserIds ARRAY, createdAt ASC, _id ASC
```
- Use one `canReadShare(viewerId, share, friendship)` for detail/feed/interaction policy: publisher reads active own shares; square is public to initialized users; friends/selected additionally require a current accepted friendship and selected membership. Withdrawn, unauthorized and source-deleted reads return `CONTENT_UNAVAILABLE`.
- Visibility never replaces source existence. Detail and future interaction must point-read the share's exact private source tuple first. Task 2 data/index design must support Task 4's four-stream `(createdAt DESC, _id DESC)` keyset merge and authoritative source filtering without offset or private DTO fields.
- Task 1–3 do not implement feed/cache, but their DTOs must support a later first-page-only five-minute cache keyed by public `socialUserId`, shown only on network failure with `readOnly: true`; no OpenID, private player/source field, raw hand/session/action row or writable permission result may be cached.
- Add fixed public messages and preserve `error.code` end-to-end for `HAND_PREVIEW_STALE`、`HAND_ALREADY_SHARED`、`INVALID_SHARE_SCOPE`、`RATE_LIMITED`、`CONTENT_UNAVAILABLE`, plus all Task 1 codes. Public errors expose no source identifiers or raw database details.

- [ ] **Step 1: Write ownership, preview hash, scope, slot, limiter, fingerprint, outbox, visibility and leak tests**

Include 1/50/51 selected boundaries, transaction-time friendship changes, stale preview zero writes, concurrent unique-active publish, stale slot repair, generation/republish, exact rolling boundaries and concurrent 20/21, rollback, mutation conflicts, 50-target single-outbox, partial delivery compensation, relationship removal skip, repository/index shape and recursive public-response scans.

- [ ] **Step 2: Run the Task 2 gate and confirm RED**

```powershell
node --test tests/social-hand-share-policy.test.js tests/social-hand-snapshot.test.js tests/social-hand-snapshot-security.test.js tests/social-notifications.test.js
```

Expected: FAIL for missing hand-share contracts, not fixture/import mistakes.

- [ ] **Step 3: Implement authoritative bundle loading, preview hash and typed routes/services**

Do not accept client playerId/snapshot fields. Preview and publish must share the exact loader/builder/hash functions, and every typed error must survive the app/service boundary.

- [ ] **Step 4: Implement scope validation, fingerprint idempotency, active slot and rolling limiter**

All selected relationship checks and share/slot/rate/outbox mutations belong to the same business transaction. Do not implement query-then-insert uniqueness or an out-of-transaction limiter.

- [ ] **Step 5: Implement deterministic outbox delivery, visibility/source checks and repository/index declarations**

Inject the single existing `notificationWriter` from `app.js`. Keep delivery bounded and compensatable; never write a 50-recipient notification batch inside the publish transaction.

- [ ] **Step 6: Run focused, complete social regressions and static checks**

```powershell
node --test tests/social-hand-share-policy.test.js tests/social-hand-snapshot.test.js tests/social-hand-snapshot-security.test.js tests/social-notifications.test.js
if ($LASTEXITCODE) { exit $LASTEXITCODE }
$socialTests = Get-ChildItem tests -Filter 'social-*.test.js' | ForEach-Object { $_.FullName }
node --test $socialTests
node --check cloudfunctions/poker_social/lib/hand-share.js
node --check cloudfunctions/poker_social/lib/idempotency.js
node --check cloudfunctions/poker_social/lib/notification.js
node --check cloudfunctions/poker_social/lib/repository.js
node --check cloudfunctions/poker_social/app.js
node --check services/social-api.js
node --check services/social-service.js
git diff --check <task-base>..<task-head>
```

Expected: all commands exit `0`; responses contain no OpenID, private player/source fields, original amounts or profit/EV.

- [ ] **Step 7: Submit Task 2 for specification review, then code review, then commit**

```powershell
git add cloudfunctions/poker_social/lib/hand-share.js cloudfunctions/poker_social/lib/visibility.js cloudfunctions/poker_social/lib/idempotency.js cloudfunctions/poker_social/lib/notification.js cloudfunctions/poker_social/lib/repository.js cloudfunctions/poker_social/app.js cloudfunctions/poker_social/database-indexes.md services/social-api.js services/social-service.js tests/helpers/social-fixture.js tests/social-hand-share-policy.test.js tests/social-notifications.test.js
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

**Approved contract:**

- Hand detail passes only an encoded `handId`. `onLoad` immediately calls the server preview action; the page never loads a local hand, accepts a snapshot in route parameters, converts BB or anonymizes players.
- Render only the returned `HandSnapshotV1` and retain its `previewHash`. Publish sends the same hash. `HAND_PREVIEW_STALE` clears the hash, reloads preview and requires a new user confirmation; it must not auto-publish the new snapshot.
- Initialize the mutually exclusive scope from `defaultShareScope`, falling back to `friends` only when the server value is absent/invalid.
- Selected uses a paginated, deduplicated friend picker and enforces 1–50 IDs. Leaving selected immediately clears selections. Friends/square always submit `targetUserIds: []`.
- Every transition into square requires a fresh public confirmation at publish time. Cancel does not set confirmation. Changing hand, refreshing preview, leaving the page or switching away invalidates it.
- Only one publish call may be in flight. A failed retry with unchanged hand/hash/scope/targets reuses the same mutation ID; any such input change creates a new mutation ID.
- Page decisions use `error.code`, never message text. Stale triggers re-preview; validation errors remain actionable; unavailable/network errors do not fabricate success.
- Unload, hand change and preview retry invalidate old preview/publish completions. Stale requests cannot call `setData` or navigate. Success navigation uses only server `shareId`.
- WXML states clearly that values are uniformly BB, offers exactly `广场 / 全部好友 / 指定好友`, includes the public-sharing warning, and contains no real-money/profit/EV toggle or output.

- [ ] **Step 1: Write route, server-preview, scope, confirmation, mutation and stale-lifecycle tests**

Tests must prove the page consumes only `handId`, all rendered poker data comes from snapshot DTO, selected pagination/1–50 behavior, non-selected empty targets, public confirmation invalidation, previewHash submission, stale re-preview, double-tap single flight, mutation reuse/change and unload/hand-change stale suppression.

- [ ] **Step 2: Run the Task 3 gate and confirm RED**

```powershell
node --test tests/social-hand-publish-page.test.js tests/hand-detail-export-entry.test.js tests/social-hand-share-policy.test.js
```

Expected: FAIL because the page/entry and approved lifecycle behavior are missing.

- [ ] **Step 3: Implement the hand-detail entry and server-owned preview state**

Register the route exactly once. Do not send a local hand, snapshot, playerId, amount or private metadata through navigation or service payloads.

- [ ] **Step 4: Implement mutually exclusive scopes, selected pagination and fresh square confirmation**

All scope transitions normalize outgoing payloads. Selected 1–50 validation occurs before publish; public confirmation is never reused across a changed preview/hand/page lifetime.

- [ ] **Step 5: Implement previewHash, stable mutation retry and async invalidation**

Use request sequence/unload guards for preview and publish. A stale hash always returns to preview/confirmation; no client-side continuation is permitted.

- [ ] **Step 6: Run focused, social regressions and static checks**

```powershell
node --test tests/social-hand-publish-page.test.js tests/hand-detail-export-entry.test.js tests/social-hand-share-policy.test.js
if ($LASTEXITCODE) { exit $LASTEXITCODE }
$socialTests = Get-ChildItem tests -Filter 'social-*.test.js' | ForEach-Object { $_.FullName }
node --test $socialTests
node --check pages/social-hand-publish/social-hand-publish.js
node --check pages/hand-detail/hand-detail.js
git diff --check <task-base>..<task-head>
```

Expected: all commands exit `0`; templates contain no real-money, profit or EV controls and no private source fields.

- [ ] **Step 7: Submit Task 3 for specification review, then code review, then commit**

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
