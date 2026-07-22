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
- 第一版对广场文字评论、回复和公开昵称做服务端自动检测，并执行长度、贴纸 ID 与频率校验；不建设用户举报队列，管理员保留评论软删除能力。

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

- [x] **Step 1: Write real-schema, BB, seat, cards, showdown and recursive-canary tests**

Cover 6/8/9 `ACTIVE_SLOTS`, legacy quick-record, every allowed BB field, strict blind parsing, invalid numbers, unknown actions, invalid seats, missing actions, card count/order/duplicates, multi-show and every prohibited key/value. Tests must use real persisted field names, not invented `players` arrays.

- [x] **Step 2: Run the Task 1 gate and confirm RED**

```powershell
node --test tests/social-hand-snapshot.test.js tests/social-hand-snapshot-security.test.js
```

Expected: FAIL for missing `hand-snapshot` behavior, not fixture/import mistakes.

- [x] **Step 3: Implement exact whitelist DTO, BB conversion and deterministic seat mapping**

Implement the smallest pure builder that satisfies the approved contract. Do not add repository reads, client payload support, text parsing or result fields to the snapshot module.

- [x] **Step 4: Implement strict cards/actions/showdown validation and public typed errors**

Keep every invalid/ambiguous source path fail closed. Public messages are fixed and contain no hand ID, owner/player or raw exception content.

- [x] **Step 5: Run focused, social/hand regressions and static checks**

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

- [x] **Step 6: Submit Task 1 for specification review, then code review, then commit**

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
- Modify: `cloudfunctions/poker_data/index.js`
- Modify: `services/cloud-repo.js`
- Modify: `services/social-api.js`
- Modify: `services/social-service.js`
- Modify: `tests/helpers/social-fixture.js`
- Test: `tests/poker-data-hand-action-revision.test.js`
- Test: `tests/cloud-repo-hand-action-revision.test.js`
- Test: `tests/social-hand-share-policy.test.js`
- Test: `tests/social-notifications.test.js`

**Interfaces:**
- Produces actions: `preview_hand_share`、`publish_hand`、`update_hand_share_scope`、`withdraw_hand_share`、`withdraw_shares_by_source_hand`。
- `preview_hand_share({ handId }) -> { previewHash, snapshot, defaultShareScope }` is read-only and needs no mutation ID。
- `publish_hand({ handId, previewHash, scope, targetUserIds, publicShareConfirmed, clientMutationId }) -> { shareId, status: 'active', scope }`。
- Scope update, withdraw and source-hand withdraw accept only their identifier, normalized scope fields where applicable, and `clientMutationId`; clients never submit a snapshot, hand/session/actions, playerId or BB values。

**Approved contract:**

- Do **not** copy-on-write hands or action collections. `cloudfunctions/poker_data/index.js` must route every current and future action-set writer through one two-phase in-place protocol. The mini-program `services/cloud-repo.js` must not perform hand/action create, update or delete writes because CloudBase transactions are server-only; those exported write methods fail closed before touching the database, and all production writes route through `cloud-data-api -> poker_data`. A server writer creates a non-empty revision token, first persists `hand.actionRevisionPending = token`, then removes/replaces that hand's action rows with every row carrying `action.actionRevision = token`, and only after every action write succeeds commits the hand with `hand.actionRevision = token` and removes `actionRevisionPending`. The final commit also advances `hand.updatedAt` and the internal monotonic `hand.handVersion`; clients cannot submit any revision protocol field.
- The protocol is mandatory for `create_hand`、`update_hand`、`upsert_hand`、`replaceHandActionsCloud`、`services/cloud-repo.js` `createHand/updateHand/replaceActions`, and any sync/import path that can write `hand_actions`. New action writers must call the shared protocol instead of directly mutating action rows. Hand-only updates may preserve the committed revision, but must never clear a pending revision they do not own.
- A failure after pending is set remains fail-closed: readers reject while `actionRevisionPending` is non-empty, no partial action set may be previewed/published, and the failed mutation is not recorded as successfully idempotent. The server derives the pending token deterministically from the owner/player/hand identity plus the canonical mutation identity and canonical action-set input. Only a retry that derives the same token may resume: it removes any partial rows, rewrites the complete set with that token and commits it. A different mutation must not steal, replace or clear the pending token. Repair is writer-driven and idempotent; there is no background best-effort that clears pending without rebuilding the full action set.
- `loadOwnedHandBundle` resolves current `social_users` by OpenID, then point-reads hand/session and queries `hand_actions` outside any transaction under exact `ownerOpenId + privatePlayerId + handId`, ordered `sequence ASC, _id ASC`. It point-reads the same hand/session again after the query. Both hand reads and both session reads must preserve ownership and the evidence fields below; any pending revision, mismatch, cross-owner/player/missing row or inconsistent read fails closed without existence disclosure.
- For revisioned hands, `hand.actionRevision` must be non-empty, `actionRevisionPending` must be absent, and every returned action must carry exactly the committed revision. Mixed/missing row revisions are unavailable, never repaired by the reader. For legacy hands where both committed and pending revision are absent, the hand/session double point-read encloses the action query; all future writers setting pending before their first action mutation makes a concurrent new writer observable. Legacy rows may be shared without a migration write only when both enclosing reads are stable.
- Preview and publish use the same Task 1 builder and canonical evidence object. SHA-256 stable serialization covers exactly `{ version: 1, handId, sessionId, sessionUpdatedAt: Number(session.updatedAt) || 0, bigBlind, handUpdatedAt: Number(hand.updatedAt) || 0, handVersion: Math.max(0, Math.floor(Number(hand.handVersion) || 0)), committedActionRevision: hand.actionRevision || '', rowActionRevision: actions.map(a => [String(a._id), Number(a.sequence), Number(a.updatedAt) || 0, a.actionRevision || '']), snapshot }`; actions are ordered `sequence ASC, _id ASC`, object keys are recursively stable and array order is preserved. `handVersion` is private CAS evidence only and never enters public DTOs.
- `preview_hand_share` returns the hash/snapshot only after the enclosing consistency checks. `publish_hand` may query/build the same candidate bundle before entering its business transaction, but the transaction itself may use only deterministic `get/set/remove`: it point-reads the exact hand and session and verifies ownership, no pending revision, `sessionId/session.updatedAt/bigBlind`、`hand.updatedAt/actionRevision` and the candidate evidence. Any mismatch returns `HAND_PREVIEW_STALE` with zero share/slot/rate/outbox/mutation writes. No `where/find/orderBy/limit` is permitted inside a production transaction.
- Scope is exactly `square | friends | selected`. `square` and `friends` require an empty target array; square requires explicit public confirmation. Friends publish requires at least one accepted friend. Selected accepts a deduplicated 1–50 string IDs and point-reads every deterministic friendship again inside the write transaction; any invalid target aborts the whole write.
- Extend `runIdempotent` with an optional SHA-256 of stable serialization over `{ action, handId, shareId, previewHash, scope, targetUserIds: sortedUniqueTargets, publicShareConfirmed: scope === 'square' && confirmed }`. Same actor/action/mutation/fingerprint restores; a different action or fingerprint returns `MUTATION_CONFLICT` before callback. Existing callers without fingerprints retain their behavior.
- Treat `poker_data` mutation receipts as a durable write-ahead recovery journal with monotonic `pending -> applied(result) -> completed` states. Before the first irreversible business write, the receipt must persist enough canonical target/before/after/result evidence to distinguish not-started, partially-applied and applied work. Once the business write may have succeeded, audit/checkpoint/journal-finalization failures and recovery point-read failures must keep the same mutation in a recoverable state; they must not release the claim and reinterpret the request as a new mutation. Recovery for session, hand, hand-action and player-note writers/deletes must restore the first authoritative result without repeating version, timestamp, bankroll, audit or delete side effects.
- Fence every journal write by the claim `attemptId`, and keep server-only mutation markers out of every client/import payload and public DTO. An expired receipt with no recovery evidence may be taken over by a new attempt; once recovery evidence exists, lease expiry alone must not allocate another attempt or start a second handler because the old invocation may still resume. If point evidence cannot prove that the planned write was applied, return a fixed retryable unresolved state and preserve the journal instead of guessing. A future operational repair may resume such work only after it can prove the old invocation cannot still write.
- The mini-program mutation outbox is account-scoped and FIFO. Every foreground request and startup drain captures the initiating account epoch and must refuse to merge an old-account response into the current account after a switch. A drain re-reads each queued record by `clientMutationId` before dispatch so a canonical ID returned by an earlier create is used by dependent update/delete records even when storage reads return deep clones. Pending writes are never silently evicted; storage-capacity failure must fail closed and preserve the backup/retry path.
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
hand_actions: ownerOpenId ASC, playerId ASC, handId ASC, sequence ASC, _id ASC
```
- Split the repository surface by capability. The normal database store may expose the exact indexed action/friend/outbox queries required by this task; the transaction store/fake exposes only deterministic `get/set/remove`. A test must make transaction `find/where/orderBy/limit` unavailable so an implementation that passes the permissive in-memory fixture cannot ship.
- Use one `canReadShare(viewerId, share, friendship)` for detail/feed/interaction policy: publisher reads active own shares; square is public to initialized users; friends/selected additionally require a current accepted friendship and selected membership. Withdrawn, unauthorized and source-deleted reads return `CONTENT_UNAVAILABLE`.
- Visibility never replaces source existence. Detail and future interaction must point-read the share's exact private source tuple first. Task 2 data/index design must support Task 4's four-stream `(createdAt DESC, _id DESC)` keyset merge and authoritative source filtering without offset or private DTO fields.
- Task 1–3 do not implement feed/cache, but their DTOs must support a later first-page-only five-minute cache keyed by public `socialUserId`, shown only on network failure with `readOnly: true`; no OpenID, private player/source field, raw hand/session/action row or writable permission result may be cached.
- Add fixed public messages and preserve `error.code` end-to-end for `HAND_SOURCE_UPDATING`、`HAND_PREVIEW_STALE`、`HAND_ALREADY_SHARED`、`INVALID_SHARE_SCOPE`、`RATE_LIMITED`、`CONTENT_UNAVAILABLE`, plus all Task 1 codes. Pending/mixed revision returns `HAND_SOURCE_UPDATING` for the owner preview path and remains `CONTENT_UNAVAILABLE` on public read paths; public errors expose no source identifiers or raw database details.

- [ ] **Step 1: Write two-phase writer, ownership, preview evidence, transaction-shape, scope, slot, limiter, outbox, visibility and leak tests**

`tests/poker-data-hand-action-revision.test.js` and `tests/cloud-repo-hand-action-revision.test.js` must inject a failure after pending and after a partial row set, assert the hand remains pending and unreadable, retry from the canonical input, then assert one committed revision shared by the hand and every row with no pending marker. Cover create/update/upsert, cloud sync/import action writes, metadata-only hand updates preserving revision, and rejection of client-supplied revision fields.

`tests/social-hand-share-policy.test.js` must cover revisioned stable reads, mixed/missing row revision rejection, legacy no-revision double-read success, hand/session change on either side of the action query, pending before/during/after query, sessionId/session.updatedAt/bigBlind/hand.updatedAt/committed/row revision hash changes, and publish-time point-read evidence mismatch with zero writes. Its production transaction fake exposes only `get/set/remove` and throws if code attempts `find/where/orderBy/limit`.

Also include 1/50/51 selected boundaries, transaction-time friendship changes, concurrent unique-active publish, stale slot repair, generation/republish, exact rolling boundaries and concurrent 20/21, rollback, mutation conflicts, 50-target single-outbox, partial delivery compensation, relationship removal skip, repository/index shape and recursive public-response scans.

- [ ] **Step 2: Run the Task 2 gate and confirm RED**

```powershell
node --test tests/poker-data-hand-action-revision.test.js tests/cloud-repo-hand-action-revision.test.js tests/social-hand-share-policy.test.js tests/social-hand-snapshot.test.js tests/social-hand-snapshot-security.test.js tests/social-notifications.test.js
```

Expected: FAIL for missing two-phase action revision and hand-share contracts, not fixture/import mistakes.

- [ ] **Step 3: Implement the server two-phase action revision protocol and seal client writers**

Modify `cloudfunctions/poker_data/index.js` and `services/cloud-repo.js` first. Keep actions in `hand_actions`; on the server set pending before the first removal/write, stamp every new row, commit the hand only after the complete set succeeds, and preserve pending on failure. Route every current action writer and sync/import path through the server protocol. A retry must rebuild the complete set before clearing pending; never clear pending merely because a timeout elapsed. In the mini-program repository, remove transaction and Node-only hashing dependencies, reject every hand/action write before database access, and route production callers through `poker_data`.

- [ ] **Step 4: Implement authoritative bundle loading, preview evidence and typed routes/services**

Do not accept client playerId/snapshot/revision fields. Preview and publish share the exact loader/builder/evidence/hash functions. Query actions only outside a transaction, enclose it with hand/session point reads, and make the publish business transaction revalidate exact evidence with point reads only. Every typed error must survive the app/service boundary.

- [ ] **Step 5: Implement scope validation, fingerprint idempotency, active slot and rolling limiter**

All selected relationship checks and share/slot/rate/outbox mutations belong to the same business transaction. Do not implement query-then-insert uniqueness or an out-of-transaction limiter.

- [ ] **Step 6: Implement deterministic outbox delivery, visibility/source checks and repository/index declarations**

Inject the single existing `notificationWriter` from `app.js`. Keep delivery bounded and compensatable; never write a 50-recipient notification batch inside the publish transaction. Separate normal query-capable repository APIs from the `get/set/remove`-only transaction surface and add the exact `hand_actions` index declaration.

- [ ] **Step 7: Run focused private-writer, complete social regressions and static checks**

```powershell
node --test tests/poker-data-hand-action-revision.test.js tests/cloud-repo-hand-action-revision.test.js tests/social-hand-share-policy.test.js tests/social-hand-snapshot.test.js tests/social-hand-snapshot-security.test.js tests/social-notifications.test.js
if ($LASTEXITCODE) { exit $LASTEXITCODE }
$socialTests = Get-ChildItem tests -Filter 'social-*.test.js' | ForEach-Object { $_.FullName }
node --test $socialTests
node --check cloudfunctions/poker_data/index.js
node --check cloudfunctions/poker_social/lib/hand-share.js
node --check cloudfunctions/poker_social/lib/idempotency.js
node --check cloudfunctions/poker_social/lib/notification.js
node --check cloudfunctions/poker_social/lib/repository.js
node --check cloudfunctions/poker_social/app.js
node --check services/cloud-repo.js
node --check services/social-api.js
node --check services/social-service.js
git diff --check <task-base>..<task-head>
```

Expected: all commands exit `0`; failed partial writes remain pending until a successful retry repair; production transaction tests execute with only `get/set/remove`; responses contain no OpenID, private player/source fields, original amounts or profit/EV.

- [ ] **Step 8: Submit Task 2 for specification review, then code review, then commit**

```powershell
git add cloudfunctions/poker_data/index.js services/cloud-repo.js cloudfunctions/poker_social/lib/hand-share.js cloudfunctions/poker_social/lib/visibility.js cloudfunctions/poker_social/lib/idempotency.js cloudfunctions/poker_social/lib/notification.js cloudfunctions/poker_social/lib/repository.js cloudfunctions/poker_social/app.js cloudfunctions/poker_social/database-indexes.md services/social-api.js services/social-service.js tests/helpers/social-fixture.js tests/poker-data-hand-action-revision.test.js tests/cloud-repo-hand-action-revision.test.js tests/social-hand-share-policy.test.js tests/social-notifications.test.js
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
- Unload, hand change and preview retry invalidate old preview/publish completions. Stale requests cannot call `setData` or navigate. Until Task 4 registers the share-detail route, Task 3 shows an in-page success state keyed only by the server `shareId`; once that route exists, success navigation may use only that server `shareId`.
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

#### 1. 本 Task 的交付边界

本 Task 只交付两项用户能力：

1. `玩家 > 动态` 是一个统一时间流，同时混排广场、全部好友、指定好友和本人发布的可读手牌；页面不再提供“广场动态 / 好友动态”二级切换，只用范围标签解释每条内容来自哪里。
2. 点击动态或 `hand_share` 消息进入手牌分享详情；详情每次从服务端重新读取分享、源手牌和当前关系后再决定是否展示。

Task 4 不实现点赞、评论、回复、贴纸或删除评论写操作；这些仍属于 Task 5。Task 4 可以显示由服务端返回的 `likedByMe`、`likeCount`、`commentCount`，点赞/评论小图标当前只进入详情，不在卡片上直接发起写操作。

##### 1.1 准确文件范围

创建：

- `cloudfunctions/poker_social/lib/hand-feed.js`
- `pages/social-hand-detail/social-hand-detail.js`
- `pages/social-hand-detail/social-hand-detail.json`
- `pages/social-hand-detail/social-hand-detail.wxml`
- `pages/social-hand-detail/social-hand-detail.wxss`
- `utils/social-cache.js`
- `tests/social-feed.test.js`
- `tests/social-hand-detail-page.test.js`
- `tests/social-feed-cache.test.js`

修改：

- `cloudfunctions/poker_social/lib/visibility.js`
- `cloudfunctions/poker_social/lib/repository.js`
- `cloudfunctions/poker_social/lib/hand-share.js`
- `cloudfunctions/poker_social/app.js`
- `cloudfunctions/poker_social/database-indexes.md`
- `services/social-api.js`
- `services/social-service.js`
- `components/friend-hub/friend-hub.js`
- `components/friend-hub/friend-hub.wxml`
- `components/friend-hub/friend-hub.wxss`
- `pages/player-notes/player-notes.js`
- `pages/player-notes/player-notes.wxml`
- `utils/social-notification-route.js`
- `app.json`
- `tests/social-message-center.test.js`
- `tests/social-cloud-routing.test.js`

`pages/player-notes` 只负责把当前已确认的公开 `socialUserId` 传给 `friend-hub`、承接打开详情事件，不改变玩家库筛选、列表、创建或详情流程。`hand-share.js` 只复用已批准的 share 读取/DTO 辅助，不得改写 Task 1–3 的发布、范围、slot、限流、快照和 outbox 语义。

#### 2. 公共接口与严格输入

##### 2.1 云 action

```js
list_feed({ cursor?: string, limit?: number })
  -> { items: FeedItemV1[], nextCursor: string | null }

get_hand_share({ shareId: string })
  -> HandShareDetailV1
```

- viewer 只来自当前云函数身份解析；客户端提交的 `viewerId`、`publisherId`、`friendIds`、`source`、`likedByMe` 或计数全部忽略并应由输入测试证明无效。
- `limit` 默认 20，允许整数 `1..50`；其他值返回 `INVALID_PAGINATION`，不得静默变成无限查询。
- `shareId` 必须是非空、长度受限的规范字符串；无权、撤回、不存在或源失效均返回同一个 `CONTENT_UNAVAILABLE`，不泄露目标曾经存在。
- 两个 action 都要求已初始化 social profile。`square` 是“所有已初始化用户可读”，不是匿名公网接口。

##### 2.2 客户端 service

```js
socialService.listFeed({ cursor: '', limit: 20 })
socialService.getHandShare(shareId)
```

`social-api.js` 继续原样保留服务端 typed `error.code`。`app.js` 的公开错误映射必须包含 `CONTENT_UNAVAILABLE` 与 `INVALID_PAGINATION`，不得压成 `SOCIAL_ERROR`。

#### 3. 单一可见性与源存在性

##### 3.1 唯一范围判断

`cloudfunctions/poker_social/lib/visibility.js` 新增并只导出一套 hand-share 范围策略：

```js
function canReadShare(viewerId, share, friendship) {
  if (!share || share.status !== 'active') return false
  if (viewerId === share.publisherId) return true
  if (share.scope === 'square') return true
  if (!friendship || friendship.status !== 'accepted') return false
  if (share.scope === 'friends') return true
  return share.scope === 'selected' &&
    Array.isArray(share.targetUserIds) &&
    share.targetUserIds.includes(viewerId)
}
```

Feed、详情以及 Task 5 的互动必须调用这个函数；不得分别维护“列表版权限”“详情版权限”或在查询条件命中后直接认为可读。发布者只可读取自己的 `active` 分享；撤回后的 owner 管理使用独立 owner action，不放宽 `canReadShare`。

##### 3.2 每条候选都做 source tuple 权威点读

分享内部 source 以 Task 2 已落库的 `{ ownerOpenId, privatePlayerId, handId }` 为当前规范；读取兼容旧 `{ ownerOpenId, playerId, handId }`，但两字段同时存在且规范化后不一致时必须失败关闭。每条去重后的候选在输出前必须：

1. 用 `source.handId` 对 `hands` 做 document point-read；禁止 `where + in` 批量替代，禁止读 slot、缓存或快照来推断源仍存在。
2. 精确比较 `hand._id === source.handId`、`hand.ownerOpenId === source.ownerOpenId`、规范化后的 `hand.playerId === (source.privatePlayerId || source.playerId)`；任一缺失、不一致或冲突即过滤。
3. 对非本人、非 square 分享点读确定性 friendship doc，随后调用唯一 `canReadShare`。候选来自好友 ID 查询不等于授权；关系可能在候选查询后被解除。

源点读使用固定小并发池，`SOURCE_READ_CONCURRENCY = 8`，不是 `Promise.all` 无上限爆发。Feed 中的 orphan 静默过滤并继续补页；详情中的 orphan 返回 `CONTENT_UNAVAILABLE`。允许的唯一瞬时竞态是：feed 完成点读后源才被删除，此时卡片可能短暂出现，但打开详情必须重新点读并失败关闭。

#### 4. 四路候选与无 offset 的 k-way keyset

##### 4.1 全局顺序和 opaque cursor

唯一排序键为 `(createdAt DESC, _id DESC)`。公共 cursor 是严格 base64url 编码的：

```js
{ v: 1, createdAt: <finite positive integer>, id: <non-empty shareId> }
```

客户端不得解析它。解码器必须拒绝非 base64url、超长、版本不符、多余/缺失键、非法时间和非法 ID，并返回 `INVALID_PAGINATION`。游标边界固定为：

```text
createdAt < cursor.createdAt
OR (createdAt == cursor.createdAt AND _id < cursor.id)
```

`nextCursor` 只编码本页最后一条实际返回记录的 tuple；没有实际返回项或所有流耗尽时返回 `null`。不得返回 offset、每流内部位置、friend ID、source ID 或其他私有状态。

##### 4.2 四类候选流

每次请求都建立以下流，并把相同公共 keyset 边界传给每个流：

1. `square`：`status='active' && scope='square'`。
2. `self`：`publisherId=viewerId && status='active'`，覆盖本人三种 scope。
3. `friends`：枚举当前 viewer 的 accepted 好友公开 ID，按数据库 `in` 上限切成 publisher chunks；每个 chunk 是一个按同一 tuple 排序的候选流，查询 `publisherId IN chunk && status='active'`。它可与 square/selected 重叠，最终按 share ID 去重。
4. `selected`：`status='active' && targetUserIds ARRAY_CONTAINS viewerId`。查询命中仍必须经 source、friendship 和 `canReadShare` 复核。

这里的 `self` 不能省略：用户没有好友时仍应看到自己的 friends/selected 分享，且自己的 square 分享与 square 流重叠时只能出现一次。

##### 4.3 好友 ID 枚举与 chunk 限制

- 不得复用 `repository.listAcceptedFriendships(...offset...)`；它是现有好友列表的 offset API，不符合 feed 合同。
- `repository.js` 新增 feed 专用的双边 adjacency keyset 读取：分别使用 `userA`、`userB` 的 accepted 复合索引，以 `(acceptedAt DESC, _id ASC)` 游标分页，服务端合并并提取另一端 `socialUserId`。
- 该过程只扫描当前 viewer 的索引邻接表，不允许 collection-wide scan、`skip` 或先读全库再 filter。为保证 feed 完整性，不能任意截断好友数；若将来单用户好友规模需要跨越该模型，应另行引入 fan-out inbox，不能在本 Task 悄悄只取“前 N 个好友”。
- `FRIEND_ID_QUERY_CHUNK_SIZE` 必须是 repository 的显式常量，并且不超过当前 CloudBase `in` 操作的已验证上限；测试依赖注入更小上限（如 2）证明 1、边界、边界+1 均不漏项。实现不得把未经验证的上限散落成 magic number。
- accepted adjacency 的两侧结果按 friend ID 去重；同一个 friend chunk 只查询一次。

##### 4.4 selected ARRAY 约束

- 延续 Task 2 的写约束：`targetUserIds` 是排序前去重后的 1–50 个公开 social user ID；非 selected 必须为空数组。
- 查询必须使用 `targetUserIds ARRAY` 索引的 contains 语义，不允许读取所有 active selected 文档后 `Array.includes`。
- 一次请求只查询 viewer 自己这一个 scalar membership，不把 viewer 包成超限 `in` 数组。50 是单文档写入上限，不是读取时扩大的批量参数。

##### 4.5 k-way 执行规则

`hand-feed.js` 维护每个流的有序 head，反复弹出最大 tuple：

1. 以 `(createdAt, _id)` 比较选出全局最新候选。
2. 先按 share ID 去重；重复项仍推进对应流。
3. 对唯一候选执行 source point-read、实时 friendship point-read、`canReadShare`。
4. 通过后构造 DTO；失败则丢弃，并继续推进，不得让不可读项占用 `limit`。
5. 某流批次耗尽但数据库仍有后续时，用该流最后消费 tuple 继续 keyset 拉取。
6. 直到实际返回 `limit` 条或所有流权威耗尽。

禁止：把四个固定大小数组 `concat().sort().slice(limit)`、offset/skip、全集合扫描、仅过滤第一批后返回不足页、以客户端去重掩盖服务端重复、用 `createdAt` 单键分页。分页期间插入比 cursor 更新的新分享不会进入后续旧游标页；同时间戳依靠 `_id` 不重不漏。

#### 5. 点赞状态与计数来源

- `likeCount`、`commentCount` 只来自 `social_hand_shares` 主文档上的非负安全整数；Task 2 初始化为 0，Task 5 必须在点赞/评论明细写事务中同步增减。Feed/详情不得 scan `social_likes` 或 `social_comments` 计算总数。
- DTO 构造器只接受 `0..Number.MAX_SAFE_INTEGER` 的整数；持久化异常值 fail closed 为 0 并记录服务端诊断，不透传 NaN、负数、小数或字符串。
- `likedByMe` 只来自 `social_likes` 的确定性文档 point-read：`getLikeId(shareId, viewerId)`；其 ID 固定为 `lk_ + sha256(JSON.stringify([shareId, viewerId]))`。该 helper 由 `hand-feed.js` 导出，Task 5 必须直接复用而不能再定义第二种 like ID。仅 `active === true` 为 true，缺失为 false；不得相信 share 内数组、客户端状态或 count 推断。
- Task 4 在 repository 常量与部署索引文档中先登记 `social_likes`、`social_comments`；like 仅按确定性 `_id` 点读，无额外索引。Task 5 再增加评论列表索引与写事务。
- 点赞点读同样使用固定并发池，最多对本页实际可读项执行；不可读/orphan 候选不需要 liked point-read。

#### 6. 递归白名单 DTO

数据库 share 文档、`publisherSnapshot`、`handSnapshot` 都不得直接 return 或浅拷贝。服务端从零构造以下对象，客户端再次按精确键白名单接收；未知键使响应判为服务合同错误，不能“删几个敏感字段后继续显示”。

##### 6.1 `FeedItemV1`

```js
{
  shareId: 'sh_xxx',
  publisher: {
    socialUserId: 'su_xxx',
    nickname: '老王',
    avatarUrl: 'https://signed-display-url',
    avatarText: '王'
  },
  scope: 'square',
  scopeLabel: '广场',
  summary: {
    heroCards: ['As', 'Ks'],
    board: { flop: ['Ah', '9s', '4d'], turn: ['Kc'], river: ['2h'] },
    potBb: 12.5,
    effectiveStackBb: 100,
    actionCount: 8,
    playerCount: 6
  },
  likedByMe: false,
  likeCount: 0,
  commentCount: 0,
  createdAt: 0
}
```

固定标签：`square -> 广场`、`friends -> 全部好友`、`selected -> 指定好友`。`summary` 只能从已批准的不可变 `HandSnapshotV1` 白名单字段二次构造；数字缺失用 `null`，数组缺失用空数组，不回读源手牌补值。

##### 6.2 `HandShareDetailV1`

```js
{
  shareId,
  publisher: { socialUserId, nickname, avatarUrl, avatarText },
  scope,
  scopeLabel,
  handSnapshot: HandSnapshotV1,
  likedByMe,
  likeCount,
  commentCount,
  createdAt,
  isMine
}
```

`HandSnapshotV1` 必须复用 Task 1 批准的 exact recursive copier/validator：只允许 `version/hero/players/board/actions/effectiveStackBb/potBb/allInPotBb/showdown` 及其已批准子键。详情不得返回 `source`、`targetUserIds`、status、slot、notification、原玩家姓名、真实金额或自由文本。

服务端和客户端测试都要递归注入 canary，至少覆盖：`ownerOpenId`、`_openid`、`privatePlayerId`、`playerId`、`handId/sourceHandId`、`sessionId`、`targetUserIds`、`avatarFileId`、`playerName`、`note`、`leakTags`、`profit/currentProfit`、`buyIn/cashOut`、`venue`、`voiceExtract`、`aiReview`。任何层级均不得出现在 action 响应、页面 data 或本地缓存。

#### 7. 详情必须重新鉴权并失败关闭

`get_hand_share` 的固定顺序：

1. 解析当前 actor/social user；
2. point-read `social_hand_shares/<shareId>`；
3. point-read并精确核对 private source tuple；
4. 必要时 point-read确定性 friendship；
5. 调用唯一 `canReadShare`；
6. point-read当前 viewer 的 deterministic like；
7. 从零构造 `HandShareDetailV1`。

步骤 2–5 任一失败均只返回 `CONTENT_UNAVAILABLE`。通知存在、feed 曾展示、缓存仍新鲜、发布时曾是好友，都不能绕过当前鉴权。好友解除、分享改范围、selected 移除接收人、撤回、源手牌删除和账号清除后，下一次详情读取立即失败关闭。

#### 8. 客户端统一动态状态机

##### 8.1 `friend-hub` 页面行为

- 保留顶部 `动态 / 好友 / 排行榜`；动态内部不再增加广场/好友筛选。
- `activeSection === 'feed'` 且组件已有当前 `socialUserId` 时自动加载第一页 20 条；切回动态只复用当前成功数据，显式下拉刷新才重置 cursor。
- 卡片展示发布者、范围标签、手牌摘要和时间。点赞/评论使用两个约 16px（`32rpx`）小图标，不使用大号文字按钮；可点击热区至少 `72rpx × 72rpx`。
- 点击卡片、点赞图标或评论图标都触发 `openhand`，由 `pages/player-notes` 导航到 `/pages/social-hand-detail/social-hand-detail?shareId=...`。图标事件必须阻止冒泡，避免双导航。
- 第一页 loading/error/empty、加载更多 spinner/retry、offline banner 均为独立状态；加载更多失败保留已有列表。
- append 按 `shareId` 去重，保持服务端原顺序，不在客户端重新按时间排序。

##### 8.2 stale suppression 与 singleflight

- `_feedFirstFlight` 和 `_feedMoreFlight` 分开 singleflight；同一阶段重复触发必须返回同一个 Promise，不重复请求。
- 每次 reset、账号变化、detached 都递增 `_feedGeneration`。任何响应、cache write、`setData`、toast、导航前均核对 `generation + socialUserId + attached`。
- load-more 捕获发起时的 cursor；响应回来时 cursor 或 generation 已变化则丢弃。
- detach、账号切换或 social profile 失效时清空 flight 引用和页面数据；旧账号请求不得写入新账号缓存或 UI。

#### 9. 五分钟、账号隔离、首屏只读缓存

`utils/social-cache.js` 在本 Task 先实现 feed namespace，Task 6 再扩展其他社交页面。缓存合同固定为：

```js
key = 'socialFeedFirstPage:' + encodeURIComponent(socialUserId)
value = {
  socialUserId,
  items: FeedItemV1[],
  nextCursor: string,
  savedAt: <client epoch ms>
}
```

- 只缓存成功的第一页，TTL 恰为 5 分钟；分页结果、detail、private source、好友 ID、OpenID、本地 playerId 都不缓存。
- 读取时要求 envelope exact keys、`cached.socialUserId === current socialUserId`、`savedAt > 0 && savedAt <= now && now-savedAt <= 300000`、每条 DTO exact recursive whitelist。未来时间、过期、畸形、跨账号或未知键全部拒绝。
- 仅 `NETWORK_ERROR/CLOUD_UNAVAILABLE` 可回退缓存；权限、`CONTENT_UNAVAILABLE`、服务合同错误不得回退旧内容。
- 缓存回退时设置 `offline: true`、清空 `nextCursor`、禁用详情导航以及所有现在/未来的写入口；它是只读展示，不是授权依据。
- 存储 get/set/remove 异常均不得使页面崩溃。退出账号、切换账号、clear social data 时移除对应 key。
- 当前 `socialUserId` 必须来自本次已确认的 social profile/session 状态。冷启动离线且无法确认当前 social user 时不猜“上次账号”，不显示任何 feed cache；这是防跨账号泄漏的失败关闭行为。

`pages/player-notes` 在进入好友区时用 singleflight 调用 `getMySocialProfile()`，只把响应中的公开 `socialUserId` 写入页面 data，并通过 `<friend-hub social-user-id="{{socialUserId}}">` 传入组件。请求要绑定当前本地登录会话 generation；账号变化、退出或页面卸载后的旧 profile 响应不得恢复旧 ID。组件的 `socialUserId` observer 在 ID 变化时先 invalidate 旧 feed，再为新 ID 加载；空 ID 只显示社交功能不可用状态，不读取任意缓存。

#### 10. 消息中心 hand_share 路由启用顺序

Task 4 在同一个提交中先完成并注册：

```json
"pages/social-hand-detail/social-hand-detail"
```

然后才修改 `utils/social-notification-route.js`，把以下现有 canonical 组合路由到详情：

```text
selected_hand + hand_share
comment + hand_share
reply + hand_share
like_aggregate + hand_share
```

目标固定为：

```js
{
  type: 'navigate',
  url: '/pages/social-hand-detail/social-hand-detail?shareId=' + encodeURIComponent(targetId)
}
```

不得读取通知中的自由 `url/path`。空 target、未知 kind/type 仍 unavailable。点击消息只负责导航；详情 action 自己重新鉴权，失败显示“内容已不可访问”。路由测试必须同时读取 `app.json`，只有页面已注册时才允许 hand_share resolve 为 navigate；禁止先启用路由后再等后续 Task 补页面。

#### 11. Repository 与索引合同

##### 11.1 Repository 新增能力

`repository.js` 增加以下明确能力（命名可保持等义，但测试必须锁定语义）：

```js
listSquareShareCandidates({ cursor, limit })
listSelfShareCandidates(viewerId, { cursor, limit })
listFriendShareCandidates(publisherIds, { cursor, limit })
listSelectedShareCandidates(viewerId, { cursor, limit })
listAcceptedFriendshipsBySideKeyset(viewerId, side, { cursor, limit })
getSourceHandById(handId)
getHandShareById(shareId)
getLikeById(likeId)
```

所有 candidate 方法返回严格按 `(createdAt DESC, _id DESC)` 排序的原始内部文档，不做 DTO。`side` 只允许 `userA|userB`。repository 生产实现没有 `skip`、没有“command 不可用就全表读取”的 fallback；缺 keyset/array/in command 时应抛部署错误并失败关闭。

##### 11.2 必须声明并 shape-test 的索引

```text
social_hand_shares: status ASC, scope ASC, createdAt DESC, _id DESC
social_hand_shares: publisherId ASC, status ASC, createdAt DESC, _id DESC
social_hand_shares: targetUserIds ARRAY, status ASC, createdAt DESC, _id DESC
social_friendships: userA ASC, status ASC, acceptedAt DESC, _id ASC
social_friendships: userB ASC, status ASC, acceptedAt DESC, _id ASC
social_likes: point-read only by deterministic _id
hands: point-read only by source.handId, followed by exact owner/player tuple comparison
```

所有社交集合继续拒绝客户端直接读写。测试不只匹配文档文字，还应 fake CloudBase query builder，断言每个 where/orderBy/limit、array contains、`in` chunk 和 keyset tie-break 条件真实执行；出现缺索引错误时不得降级全扫描。

#### 12. RED 测试矩阵

##### 12.1 服务端 feed：`tests/social-feed.test.js`

1. 四类流都能单独贡献结果；self 在零好友时可见。
2. 同一 share 同时命中 square/self/friends/selected 时只返回一次。
3. 不同流同 createdAt 按 `_id DESC` 全局稳定；跨页不重不漏。
4. cursor 非法、多余键、版本错、超长、offset 形态均 `INVALID_PAGINATION`。
5. 分页期间插入更新记录不会污染旧 cursor 后续页。
6. 第一批含 withdrawn、解除好友、selected 已移除、orphan source 时继续拉取直至实际 20 条或全耗尽。
7. 每条 source 都发生 hand doc point-read并校验 `_id+ownerOpenId+playerId`；无 `where/in` source batching。
8. source 点读并发峰值不超过 8。
9. friends ID 两侧 adjacency keyset 合并、去重，无 skip；注入 chunk=2 后覆盖 1/2/3/5 个好友且无遗漏。
10. selected 使用 ARRAY contains 索引；1/50 target 文档可读，非成员不可读，畸形 51 target 文档也不因命中绕过实时策略。
11. `canReadShare` 是 feed/detail 共用的同一函数引用；查询命中不替代策略。
12. likeCount/commentCount 只读 share 主文档；likedByMe 只做 deterministic point-read，禁止明细 scan。
13. page 完整耗尽返回 null；过滤后 0 项返回 null，不制造不可推进 cursor。
14. Feed DTO exact keys、数值安全、avatar 已签发，递归 canary 全部消失。
15. fake production repository 缺 command/index 能力时 fail closed，未调用 collection-wide fallback。

##### 12.2 详情与路由：`tests/social-hand-detail-page.test.js`、`tests/social-message-center.test.js`

1. publisher、square 已初始化陌生人、accepted friend、selected member 的正向矩阵。
2. stranger 读 friends/selected、removed friend、selected 非成员、withdrawn、missing share 全部同一 `CONTENT_UNAVAILABLE`。
3. source missing、owner mismatch、player mismatch 全部 `CONTENT_UNAVAILABLE`。
4. feed/cache/notification 曾可见后解除好友、改范围、移除 selected、撤回或删源，详情重新请求并失败。
5. `HandShareDetailV1` 和 HandSnapshotV1 递归 exact whitelist，不含 source/targets/private canary。
6. page 只消费 `shareId`，不从 query 接受 snapshot/publisher/权限；loading/error/unavailable/ready 状态完整。
7. `app.json` 注册详情后四种 hand_share 通知才 resolve navigate；未知/空 target 仍 unavailable，通知自由 path 无效。

##### 12.3 UI 与缓存：`tests/social-feed-cache.test.js` 及 feed UI 断言

1. friend-hub 只有一个动态 panel，不出现“广场动态/好友动态”切换。
2. 三种 scopeLabel 都有渲染；点赞/评论是小图标，热区至少 72rpx，不是两个大文字按钮。
3. 首次固定 20；first/more 各自 singleflight；append 以 shareId 去重且不重排。
4. reset、detach、账号切换、cursor 改变会丢弃旧响应、旧 toast、旧导航和旧 cache write。
5. cache 仅第一页、exact envelope/DTO、TTL 边界 `300000` 可读、`300001` 过期、未来时间拒绝。
6. A/B socialUserId 隔离；A 缓存不能在 B 或未知账号展示。
7. 仅网络错误回退，回退后 offline/readOnly、无 next cursor、详情与写入口禁用。
8. storage get/set/remove 抛错不崩溃；clear/logout 移除当前 public socialUserId cache。
9. 缓存序列化递归扫描不含 OpenID、playerId、sourceHandId、targets 或其他 canary。
10. 玩家库原列表、筛选、创建、详情与好友列表/排行榜既有测试全部继续通过。

##### 12.4 RED 与回归命令

先写上述测试并确认因 Task 4 能力缺失而 RED，不接受语法错误或 fixture 损坏作为 RED。实现后至少运行：

```powershell
node --test tests/social-feed.test.js tests/social-hand-detail-page.test.js tests/social-feed-cache.test.js tests/social-message-center.test.js tests/social-cloud-routing.test.js
if ($LASTEXITCODE) { exit $LASTEXITCODE }
node --test tests/social-*.test.js
if ($LASTEXITCODE) { exit $LASTEXITCODE }
node tests/friend-feed-demo.test.js
if ($LASTEXITCODE) { exit $LASTEXITCODE }
node --check cloudfunctions/poker_social/lib/hand-feed.js
node --check cloudfunctions/poker_social/lib/visibility.js
node --check cloudfunctions/poker_social/lib/repository.js
node --check cloudfunctions/poker_social/app.js
node --check services/social-service.js
node --check components/friend-hub/friend-hub.js
node --check pages/social-hand-detail/social-hand-detail.js
```

同时运行 `git diff --check`，并确认真实 diff 只落在第 1.1 节文件范围内。


- [ ] **Step 1: 先写并确认 RED**
  - 按“RED 测试矩阵”覆盖四路 feed、keyset/chunk/refill、source/relationship gate、DTO/canary、详情二次鉴权、缓存/UI/路由。
  - RED 必须因 Task 4 能力缺失，而不是语法错误、fixture 损坏或错误 mock。

- [ ] **Step 2: 实现服务端 feed/detail**
  - 实现 `hand-feed.js`、唯一 visibility、repository query shape、actions、typed errors 与索引声明。
  - 禁止 offset/skip、全表 fallback、客户端合并或任何 source batch 查询。

- [ ] **Step 3: 实现客户端统一动态、详情与缓存**
  - 完成 service/page/component、first/more singleflight、stale suppression、五分钟账号隔离只读 fallback。
  - 保持玩家库现有列表、筛选、创建、详情和视觉样式不变。

- [ ] **Step 4: 注册详情后启用 hand_share 消息路由**
  - 先更新 `app.json`，再启用四种 canonical route；详情仍重新鉴权。

- [ ] **Step 5: 执行验证**
```powershell
node --test tests/social-feed.test.js tests/social-hand-detail-page.test.js tests/social-feed-cache.test.js tests/social-message-center.test.js tests/social-cloud-routing.test.js
if ($LASTEXITCODE) { exit $LASTEXITCODE }
node --test tests/social-*.test.js
if ($LASTEXITCODE) { exit $LASTEXITCODE }
node tests/friend-feed-demo.test.js
if ($LASTEXITCODE) { exit $LASTEXITCODE }
node --check cloudfunctions/poker_social/lib/hand-feed.js
node --check cloudfunctions/poker_social/lib/visibility.js
node --check cloudfunctions/poker_social/lib/repository.js
node --check cloudfunctions/poker_social/app.js
node --check services/social-service.js
node --check components/friend-hub/friend-hub.js
node --check pages/social-hand-detail/social-hand-detail.js
git diff --check
```

- [ ] **Step 6: Commit**
```bash
git add cloudfunctions/poker_social pages/social-hand-detail utils/social-cache.js services/social-api.js services/social-service.js components/friend-hub pages/player-notes utils/social-notification-route.js app.json tests/social-feed.test.js tests/social-hand-detail-page.test.js tests/social-feed-cache.test.js tests/social-message-center.test.js tests/social-cloud-routing.test.js
git commit -m "feat: add unified social hand feed"
```

### Task 5: 评论、回复、贴纸与点赞

**Files:**
- Create: `cloudfunctions/poker_social/lib/interaction.js`
- Create: `cloudfunctions/poker_social/lib/poker-stickers.js`
- Create: `cloudfunctions/poker_social/lib/validation.js`
- Create: `utils/poker-stickers.js`
- Create: `tests/social-comments.test.js`
- Create: `tests/social-likes.test.js`
- Create: `tests/social-interaction-ui.test.js`
- Modify: `cloudfunctions/poker_social/lib/hand-feed.js`
- Modify: `cloudfunctions/poker_social/lib/repository.js`
- Modify: `cloudfunctions/poker_social/lib/notification.js`
- Modify: `cloudfunctions/poker_social/database-indexes.md`
- Modify: `cloudfunctions/poker_social/app.js`
- Modify: `services/social-api.js`
- Modify: `services/social-service.js`
- Modify: `pages/social-hand-detail/social-hand-detail.js`
- Modify: `pages/social-hand-detail/social-hand-detail.wxml`
- Modify: `pages/social-hand-detail/social-hand-detail.wxss`
- Modify: `components/friend-hub/friend-hub.js`
- Modify: `tests/social-notifications.test.js`
- Modify: `tests/social-feed.test.js`
- Modify: `tests/social-hand-share-policy.test.js`

##### 执行合同

##### Actions 与公开 DTO

```text
list_comments({ shareId, cursor, limit: 20 })
  -> { items: CommentDto[], nextCursor: string | null }

create_comment({ shareId, parentCommentId, kind, text, stickerId, clientMutationId })
  -> { comment: CommentDto, commentCount }

delete_comment({ commentId, clientMutationId })
  -> { comment: CommentDto(deleted=true), commentCount }

set_like({ shareId, liked: boolean, clientMutationId })
  -> { shareId, likedByMe, likeCount }
```

`CommentDto` exact whitelist：

```js
{
  commentId,
  shareId,
  parentCommentId, // 顶层为 ''；回复只指向顶层 commentId
  author: { socialUserId, nickname, avatarUrl, avatarText },
  kind: 'text' | 'sticker',
  text,
  stickerId,
  deleted,
  createdAt
}
```

禁止返回 `authorId` 以外的私有身份映射、OpenID、source tuple、mutation、权限结果、原始 profile/player-note 字段。删除占位固定为 `deleted=true, kind='text', text='该评论已删除', stickerId=''`；作者公开快照仍按产品 UI 需要保留，账号清除时改为匿名公开快照。

##### 可见性与源存在性

- `list_comments/create_comment/delete_comment/set_like` 首先读取当前 actor social user，再点读 share。
- 除评论作者删除自己的既有评论外，所有读写都必须先通过 Task 2 的 `canReadShare`，并点读 share 的精确 `source.ownerOpenId + source.playerId + source.handId`；任一失败统一 `CONTENT_UNAVAILABLE`。
- 删除自己的评论仍要求 share 存在且 actor 是作者；若 share 已撤回/源已删除，允许作者执行隐私性清理删除，但响应只返回删除后的 comment DTO，不返回 share 内容。
- Task 4 detail 与 Task 5 interaction 必须共享同一 `requireReadableLiveShare` helper，禁止各 handler 自己拼权限条件。

##### 评论与一层回复

- `kind='text'`：`text.trim()` 后按 `Array.from(text).length` 为 1–300；`stickerId=''`。
- `kind='sticker'`：`stickerId` 必须属于 client/server 完全相同且 immutable 的 `POKER_STICKER_IDS`；`text=''`。未知 kind、混合 text+sticker、空内容均 fail closed。
- 顶层评论 `parentCommentId=''`。回复必须点读 parent，要求 parent 属于同一 share、`parentCommentId=''` 且 `deleted=false`。禁止回复回复，也禁止新回复已删除父评论；已有回复在父评论被删后继续显示。
- `list_comments` 是单一扁平 keyset 流，按 `(createdAt DESC, _id DESC)`，客户端按 `parentCommentId` 展示一层缩进；父评论不保证与跨页回复同时出现，回复 DTO 自带公开 author 和 parentCommentId，不得为补父评论泄漏私有数据。`nextCursor` 取最后一条实际返回记录，无更多时为 `null`；不用 offset/skip。
- 删除只允许 `actorId === comment.authorId`。分享发布者**不能删除其他人的评论**；唯一内容管理动作是撤回整个分享。客户端只为本人的评论渲染删除入口，服务端仍是权威门禁。
- 删除为软删除，保留 commentId/parent 关系和既有回复；顶层或回复删除都不物理级联。
- `commentCount` 定义为当前 share 下 `deleted=false` 的顶层和回复总数。创建成功 +1，首次删除成功 -1；幂等 restore 和重复删除不重复变化。

##### 点赞事务

- like 文档 ID 固定为 `lk_ + sha256(JSON.stringify([shareId, actorId]))`，字段只含私有 `shareId/actorId/active/createdAt/updatedAt`。
- `set_like(liked=true|false)` 表示 desired state：同状态为成功 no-op；状态变化与 share.likeCount 在一个事务提交，计数永不小于 0。
- 同 mutation + 同 fingerprint restore 不重复改变 count/rate/notification；同 mutation 改 share 或 liked 返回 `MUTATION_CONFLICT`。
- 只有 `false/不存在 -> true` 是新的点赞事件；`true -> false` 不发通知；取消后再次点赞可以改变 like state，但 10 分钟通知 writer 仍按“同一 share、同一 distinct actor、同一未读窗口”去重。

##### 通知

- 顶层评论：通知 share.publisherId，actor 是评论者；本人评论自己的分享不通知。`kind='comment'`，`sourceEventId='comment:' + commentId`。
- 回复：通知 parent.authorId；回复自己不通知。`kind='reply'`，`sourceEventId='reply:' + commentId`。不额外同时通知发布者，避免一条回复产生两个语义重复通知。
- 新点赞：通知 share.publisherId；本人点赞自己的分享不通知。调用现有 `notificationWriter.writeLikeAggregate`，不得新建第二套聚合表/窗口。
- 10 分钟窗口语义沿用现有实现：`at < windowStartedAt + 600000` 且通知尚未有效已读时聚合；distinct actor membership 使用 `social_notification_actors`；同 actor 不重复增加 aggregateCount。窗口边界、已读后新通知、并发不同 actor 都复用 Plan 03 测试 oracle。
- 评论/回复记录、share count、interaction rate、通知或点赞聚合写入同一业务事务。任何一步失败全回滚。

##### 频率与幂等

- 评论和回复共享同一 limiter key `comment`：rolling `(now-60000, now]` 最多 10 个**成功新建**；删除不计。
- 点赞 desired-state 调用共享 limiter key `like`：rolling `(now-60000, now]` 最多 30 次**成功状态变化**；相同状态 no-op、幂等 restore、验证失败不计。
- limiter 使用 `social_rate_limits` 确定性点读文档，并与 mutation/interaction/share count/notification 在同一事务。阈值集中到 `validation.js`，但 handShare 限流仍由 Task 2 专属逻辑负责。

##### 测试门禁

```powershell
node --test tests/social-comments.test.js tests/social-likes.test.js tests/social-interaction-ui.test.js tests/social-notifications.test.js tests/social-feed.test.js tests/social-hand-share-policy.test.js
```

必须覆盖：

1. square/friends/selected、解除好友、withdrawn、源删除的 read/create/delete/like 矩阵。
2. 回复顶层成功；回复回复、跨 share parent、已删除 parent 失败；父删除后已有回复继续显示。
3. 作者可删自己；发布者不能删他评；UI 不显示越权入口；撤回分享后所有人不可继续互动。
4. text 1/300/301 Unicode 边界，emoji，sticker 双端数组 exact equality，未知/混合输入失败。
5. 评论/回复/点赞 notification recipient/self suppression/sourceEvent；10 分钟边界、已读后新窗口、distinct actor 并发聚合。
6. like desired-state no-op、并发 set、计数不负、rollback、mutation fingerprint conflict。
7. comment 10/11、like 30/31、rolling 左边界、幂等 restore/失败不计数。
8. CommentDto/interaction response 递归 forbidden-key 和 canary 扫描。

- [ ] **Step 1: 写并确认 interaction RED**
  - 覆盖 handler 级 source/visibility、扁平 keyset comments、回复深度、作者删除、DTO/canary、贴纸双端一致。
  - 覆盖 desired-state like、count 原子性、通知 recipient/聚合、comment 10/11 与 like 30/31；失败和幂等 restore 不计数。

- [ ] **Step 2: 实现评论、回复、贴纸与点赞事务**
  - 所有 interaction 复用 Task 4 `requireReadableLiveShare` 和 `getLikeId`；禁止第二套权限或 like ID。
  - mutation、rate、comment/like、share count、notification 在同一事务，任一步失败回滚。

- [ ] **Step 3: 实现详情互动 UI**
  - 文字、Emoji、内置扑克贴纸；只为本人评论显示删除入口。
  - 发布者不能删除他人评论，只能撤回整条分享。

- [ ] **Step 4: 执行验证**
```powershell
node --test tests/social-comments.test.js tests/social-likes.test.js tests/social-interaction-ui.test.js tests/social-notifications.test.js tests/social-feed.test.js tests/social-hand-share-policy.test.js
if ($LASTEXITCODE) { exit $LASTEXITCODE }
git diff --check
```

- [ ] **Step 5: Commit**
```bash
git add cloudfunctions/poker_social services/social-api.js services/social-service.js pages/social-hand-detail components/friend-hub utils/poker-stickers.js tests/social-comments.test.js tests/social-likes.test.js tests/social-interaction-ui.test.js tests/social-notifications.test.js tests/social-feed.test.js tests/social-hand-share-policy.test.js
git commit -m "feat: add social hand interactions"
```
### Task 6: 源手牌删除、账号清除与只读缓存

**Files:**
- Modify: `services/data-service.js`
- Modify: `services/cloud-data-api.js`
- Modify: `services/cloud-repo.js`
- Modify: `services/social-api.js`
- Modify: `services/social-service.js`
- Modify: `cloudfunctions/poker_data/index.js`
- Modify: `cloudfunctions/poker_social/lib/hand-share.js`
- Modify: `cloudfunctions/poker_social/lib/repository.js`
- Modify: `cloudfunctions/poker_social/app.js`
- Modify: `utils/social-cache.js`
- Modify: `components/friend-hub/friend-hub.js`
- Modify: `pages/player-notes/player-notes.js`
- Modify: `pages/profile/profile.js`
- Create: `tests/social-delete-cascade.test.js`
- Create: `tests/social-offline-cache.test.js`
- Modify: `tests/social-message-center.test.js`
- Modify: `tests/social-feed.test.js`
- Modify: `tests/player-card-import-receipt-cloud.test.js`
- Modify: `tests/social-friend-player-note-data-service.test.js`

##### 执行合同

##### 源手牌删除

1. 核心删除流程保持权威：只有核心 hand 及 actions 删除成功后才触发 `withdrawSharesBySourceHand(handId, deterministicMutationId)`。
2. 社交撤回是 best-effort：失败只记录固定脱敏日志，不回滚核心删除、不向用户声称社交撤回成功，也不排队伪造本地成功。
3. mutation ID 必须从当前账号命名空间 + handId + 本次核心删除 operation ID 稳定派生；同一删除重试复用，不能每次随机创建重复撤回事务。
4. Task 2 的 handler 只撤回当前 owner/privatePlayerId 精确 source hand 的 active shares，清对应 slot，并保持旧评论/点赞附着于旧 share，不迁移到未来 generation。
5. 即使撤回失败，Task 4 feed 批量 source filter 和 detail/Task 5 interaction 点读 source gate 也必须让 orphan 立即不可见/不可互动。
6. `delete_session` 返回的每个 `handId` 都属于同一核心删除 operation；必须逐手调用同一个 post-delete best-effort helper，并以 `core clientMutationId + handId` 稳定派生各自撤回 mutation ID。前台成功与 outbox 响应丢失后重放成功都必须走该 helper，不能只接页面前台路径。

##### 账号清除严格顺序

客户端顺序固定：

```text
1. await clearMySocialData(clientMutationId)
2. 仅在步骤 1 返回 completed=true 后，清除私有云端 poker 数据
3. 私有云端成功后清本地 store、账号态和所有当前账号 cache namespace
4. 任一步失败显示明确“未全部清除，可重试”，绝不显示完成
```

- 不允许先 `store.clearAllData()`；不允许吞掉 social/cloud clear 错误后返回成功。
- `clear_my_social_data` 必须可重入。部分批次失败后同 mutation 或新 retry 能继续，只有以下效果全部完成才返回 `{ completed: true }`：
  - social user 标记 deleted、stats 隐藏、邀请撤销；
  - 所有 friendships 转 removed；
  - 发送的 hand/card share 撤回，收到但未导入 card share 失效；
  - authored comments 软删并匿名 author snapshot，既有 replies 保留；
  - actor likes 失活并权威修正 share likeCount；
  - 当前用户作为 recipient 的 notifications/state/heads/actors 清理；其他用户通知中的 actor snapshot 匿名化；
  - 当前用户相关 pending outbox target 标为 skipped；
  - 当前用户 rate-limit 和 mutation 文档删除或失效；
  - daily stats 删除。
- `player_card_import_receipts` 属于私有 poker-data 清除阶段，不在 `poker_social` 中伪装删除；步骤 2 必须包含它。
- `clear_my_social_data` 使用 social user 文档上的私有 checkpoint，而不是会在清除过程中被删除的通用 `social_mutations` receipt。每次调用最多处理固定批量并返回 exact `{ completed, remainingStage, socialUserId }`；`socialUserId` 仅为当前自己的公开 ID，供最终定向清缓存。客户端用同一 `clientMutationId` 有界续调直到 `completed=true`。各 stage 只查询仍待处理的记录，处理后不再命中；不得向客户端返回 collection cursor、OpenID 或其他内部 ID。
- checkpoint 对同一账号可重入：同 mutation 和新的 retry 都从当前 stage 继续；完成后重复调用稳定返回 completed。checkpoint 只保留阶段、脱敏 mutation hash 和时间，不保留明文 mutation ID。
- 私有 `poker_data` 清除必须由 server-authoritative action 执行，覆盖 sessions/hands/actions/bankroll/player_notes/player_card_import_receipts/profile/settings。`sync_operations/audit_logs` 作为 server-only 操作完整性证据保留，但必须在清除完成时去除可直接关联用户的业务 payload；不得由客户端逐集合直写删除。
- `pages/profile` 只有在 social、private cloud、本地 store/account/cache 全部成功后才提示“已重置”；任一步失败必须显示“未全部清除，可重试”并保留可重试入口。

##### 缓存唯一所有者与账号隔离

- 一个 surface 只能有一个缓存实现和一个 key。不得给消息中心再套 `utils/social-cache.js`：现有 `socialNotificationsFirstPage:<accountId>`、精确 envelope、TTL、unreadCount 和 lifecycle 防护保持不变。
- Task 4 feed 使用唯一 `socialFeedFirstPage:<socialUserId>`。Task 6 必须审计页面后只为当前尚无缓存的好友首屏和排行榜各 range 补上唯一实现：`socialFriendsFirstPage:<accountKey>`、`socialRankingFirstPage:<accountKey>:<range>`；不能共用裸 `feed/friends/ranking` namespace，也不能在页面和 utility 各写一份。若 Task 4 已先实现 feed cache，Task 6 只做回归与清除注册，不得重建。
- `utils/social-cache.js` 只提供 schema/TTL/storage-safe helper 和 prefix registry，不拥有页面状态、不推导权限、不复制消息 unread。调用方必须传 `{ namespace, accountKey, schemaVersion, data }`。
- Task 6 新增的好友/排行榜缓存 exact envelope：`{ accountId, schemaVersion, savedAt, data }`；消息与 Task 4 feed 保留各自已批准的唯一 exact envelope，不迁移或重建；accountId 必须与当前登录账号完全相等，savedAt 为有限非未来值且 TTL ≤5 分钟。坏结构、storage 异常、logout、空账号 fail closed。
- 只缓存第一页面向公众的 DTO 和服务端 cursor/count；不缓存后续页、OpenID/privatePlayerId/sourceHandId/raw hand/session/action、权限布尔结果或临时云文件内部 ID。
- 仅 `NETWORK_ERROR/CLOUD_UNAVAILABLE` 可回退缓存，并强制 `readOnly=true`、清 cursor、禁用 comment/like/publish/scope/withdraw/friend action/mark read。权限或内容失效错误不得回退缓存。
- account switch/logout/`clear_my_social_data` 成功后按 registry 清当前账号全部 social key；旧异步回调不得 cache/setData/toast。
- registry 清除必须按捕获的当前 `accountKey/socialUserId` 定向删除；不得通过扫前缀删除其他仍可能登录账号的缓存。现有消息与 feed envelope 不迁移，只登记各自 key builder/clear hook。

##### 真实部署清单同步

Task 6 任何新增批查都必须同时修改 `database-indexes.json`、`database-indexes.md` 与 `tests/social-database-deployment-contract.test.js`。只写 Markdown 不算完成；缺索引时 repository 必须失败关闭，不得退回全表扫描或 offset。

##### 测试门禁

```powershell
node --test tests/social-delete-cascade.test.js tests/social-offline-cache.test.js tests/social-message-center.test.js tests/social-feed.test.js tests/social-comments.test.js tests/social-likes.test.js
node --test tests/player-card-import-receipt-cloud.test.js tests/social-friend-player-note-data-service.test.js
node tests/store-create-hand-reviewed-status.test.js
node tests/player-notes-store.test.js
```

必须覆盖：核心删除成功而 social 撤回失败；orphan 不进入 feed/detail/interaction；删除重试同 mutation；clear social 失败时 core/local/cache 均未清；social 成功但 private clear 失败显示 partial/retry；重试最终完成；全 collection 清除/匿名化；消息/feed cache 不重复、账号切换/登出/未来时间/坏结构/storage 异常/旧回调/只读写入口矩阵。

- [ ] **Step 1: 写并确认删除、清除、缓存 RED**
  - 覆盖核心删除成功但 social 撤回失败、deterministic retry、orphan feed/detail/interaction 失败关闭。
  - 覆盖 social-first clear 的失败/部分完成/重试、全 collection 清除或匿名化、private receipt 清除。
  - 覆盖 message/feed 不重复、friends/ranking 唯一 key、账号切换/登出/未来时间/storage 异常/旧回调和只读写入口。

- [ ] **Step 2: 接入源删除生命周期**
  - 只调用 Task 2 `withdraw_shares_by_source_hand`；best-effort 失败只写脱敏日志，不回滚核心删除。

- [ ] **Step 3: 重写账号清除严格顺序**
  - 必须 `await social completed → private cloud → local/account/cache`；任一步失败不得声称完成。

- [ ] **Step 4: 扩展唯一 social cache registry**
  - Task 4 feed 与现有 message 只注册清除，不重建；仅为尚无缓存的 friends/ranking 增加账号隔离首屏只读缓存。

- [ ] **Step 5: 执行验证**
```powershell
node --test tests/social-delete-cascade.test.js tests/social-offline-cache.test.js tests/social-message-center.test.js tests/social-feed.test.js tests/social-comments.test.js tests/social-likes.test.js
if ($LASTEXITCODE) { exit $LASTEXITCODE }
node --test tests/player-card-import-receipt-cloud.test.js tests/social-friend-player-note-data-service.test.js
if ($LASTEXITCODE) { exit $LASTEXITCODE }
node tests/store-create-hand-reviewed-status.test.js
node tests/player-notes-store.test.js
git diff --check
```

- [ ] **Step 6: Commit**
```bash
git add services/data-service.js services/cloud-data-api.js services/cloud-repo.js services/social-api.js services/social-service.js cloudfunctions/poker_data/index.js cloudfunctions/poker_social utils/social-cache.js components/friend-hub/friend-hub.js pages/player-notes/player-notes.js tests/social-delete-cascade.test.js tests/social-offline-cache.test.js tests/social-message-center.test.js tests/social-feed.test.js tests/player-card-import-receipt-cloud.test.js tests/social-friend-player-note-data-service.test.js
git commit -m "feat: harden social deletion and offline cache"
```
### Task 7: 频率限制、索引与安全总验收

**Files:**
- Modify: `cloudfunctions/poker_social/lib/validation.js`
- Modify: `cloudfunctions/poker_social/lib/repository.js`
- Modify: `cloudfunctions/poker_social/database-indexes.md`
- Modify: `cloudfunctions/poker_social/app.js`
- Create: `tests/social-rate-limit.test.js`
- Create: `tests/social-security-matrix.test.js`
- Create: `tests/social-sensitive-field-scan.test.js`
- Modify: `tests/social-hand-share-policy.test.js`
- Modify: `tests/social-comments.test.js`
- Modify: `tests/social-likes.test.js`
- Modify: `tests/social-notifications.test.js`
- Modify: `tests/social-profile-ranking-security.test.js`
- Modify: `tests/social-foundation-security.test.js`
- Modify: `tests/social-card-message-security.test.js`

##### 执行合同

##### 限频责任

- `validation.js` 在 Task 5 前创建或由 Task 5 创建，Task 7 只能 Modify/验收。
- `RATE_LIMITS` 可包含 handShare 元数据以便统一展示，但 `publish_hand` **只能调用 Task 2 的专属原子 limiter**；Task 7 不再包一层 `enforceRateLimit`，测试必须断言一次成功 publish 只追加一个 timestamp。
- friendRequest/playerCard 限制接入各自现有 `runIdempotent` transaction；comment/like 已在 Task 5 transaction；所有 limiter 只计成功新 mutation/state transition，restore/失败不计。
- 精确窗口：friendRequest/playerCard rolling 24h 各 20，comment rolling 60s 10，like state transition rolling 60s 30，handShare rolling 60min 20。左边界 `<= now-window` 清除。

##### `database-indexes.md` 必须 Modify 并列完整集合

至少包含以下真实查询索引；point-read collection 明确写“deterministic `_id`, no additional index”：

```text
social_users: ownerOpenId ASC
social_invites: inviterId ASC, createdAt DESC, _id DESC
social_friendships: userA ASC, status ASC, acceptedAt DESC, _id ASC
social_friendships: userB ASC, status ASC, acceptedAt DESC, _id ASC
social_daily_stats: socialUserId ASC, dateKey ASC
social_player_card_shares: senderUserId ASC, status ASC, createdAt DESC, _id DESC
social_player_card_shares: targetUserId ASC, status ASC, createdAt DESC, _id DESC

social_hand_shares: status ASC, scope ASC, createdAt DESC, _id DESC
social_hand_shares: publisherId ASC, status ASC, createdAt DESC, _id DESC
social_hand_shares: targetUserIds ARRAY, status ASC, createdAt DESC, _id DESC
social_hand_share_slots: deterministic _id
social_rate_limits: deterministic _id
social_notification_outbox: status ASC, targetUserIds ARRAY, createdAt ASC, _id ASC
social_notification_outbox: publisherId ASC, status ASC, createdAt ASC, _id ASC

social_comments: shareId ASC, createdAt DESC, _id DESC
social_comments: authorId ASC, createdAt DESC, _id DESC
social_likes: deterministic share+actor _id
social_likes: actorId ASC, updatedAt DESC, _id DESC

social_notifications: recipientId ASC, createdAt DESC, _id DESC
social_notifications: actorSnapshot.socialUserId ASC, createdAt ASC, _id ASC
social_notification_state: deterministic _id
social_notification_heads: deterministic _id
social_notification_heads: recipientId ASC, latestAt ASC, _id ASC
social_notification_actors: deterministic _id
social_notification_actors: actorId ASC, createdAt ASC, _id ASC
social_notification_actors: notificationId ASC, createdAt ASC, _id ASC
social_mutations: actorId ASC, createdAt ASC, _id ASC
```

勘误：通知持久化 schema 的真实字段是 `actorSnapshot.socialUserId`；早期文本中的 `actor.socialUserId` 仅表示同一公开 actor 快照语义，不是可部署字段名。manifest、repository 与查询验收统一使用 `actorSnapshot.socialUserId`。

私有 `player_card_import_receipts` 还必须声明 `ownerOpenId ASC, playerId ASC, _id ASC`，供账号清除按 owner/player 分页删除；不能只依赖单 share 的 deterministic point read。

- 若 CloudBase ARRAY + 其他字段复合索引语法与控制台不一致，部署时必须记录实际等价索引并用真实 query explain/成功响应验证，不能在生产退回全表扫描或 offset。
- repository shape tests 必须逐一匹配 where/orderBy/limit；缺索引必须作为部署失败，不 catch 后全表扫描。
- 所有上述 social collection，以及私有 `player_card_import_receipts`，客户端权限均显式拒绝 read/write。测试必须直接模拟/调用客户端读写并期待 permission denied；不能只 grep 文档。

##### 安全矩阵

- 可见性矩阵覆盖 active/withdrawn/source-missing × square/friends/selected × publisher/friend/selectedFriend/stranger/removedFriend。
- 对每个矩阵行同时验证 feed/detail/listComments/createComment/reply/deleteOwn/setLike；不得只测纯 `canReadShare`。
- forbidden scan 覆盖 profile/friends/ranking/feed/detail/comments/notifications/card DTO、cache envelope、error response，递归检查 key 和 canary value。

##### 测试门禁

```powershell
node --test tests/social-rate-limit.test.js tests/social-security-matrix.test.js tests/social-sensitive-field-scan.test.js tests/social-hand-share-policy.test.js tests/social-comments.test.js tests/social-likes.test.js tests/social-notifications.test.js
$socialTests = Get-ChildItem tests -Filter 'social-*.test.js' | ForEach-Object { $_.FullName }
node --test $socialTests
node tests/player-notes-store.test.js
node tests/player-notes-navigation.test.js
node tests/player-notes-cloud-boundary.test.js
node tests/friend-feed-demo.test.js
node tests/friend-hand-share-demo.test.js
node tests/friend-list-message-demo.test.js
git diff --check
```

必须新增断言：publish 第 20/21 条且每次成功只记一次；Task 7 没有第二个 handShare limiter 调用；所有索引查询 shape；客户端逐 collection 拒绝；三层 DTO/cache/error canary；矩阵 handler 级验证而非仅纯函数。

- [ ] **Step 1: 写并确认限频、安全、索引 RED**
  - handler 级覆盖完整 visibility/source 矩阵，不只测试纯函数。
  - 断言 publish 只使用 Task 2 limiter 且一次成功只追加一个 timestamp；Task 7 不得调用第二个 handShare limiter。
  - fake query builder 逐集合断言 where/orderBy/limit/index shape；缺索引 fail closed。
  - 对每个 social collection 和 private receipt 模拟客户端读写并期待 permission denied。

- [ ] **Step 2: 完成唯一限频责任接线**
  - friendRequest/playerCard 接入各自幂等事务；验收 Task 5 comment/like 与 Task 2 handShare，不在外层重复计数。

- [ ] **Step 3: 修改完整索引与权限部署清单**
  - `database-indexes.md` 是 Modify；完整列出执行合同中的全部索引、point-read 与 client-deny 要求。
  - 禁止缺索引时 catch 后全表扫描或 offset fallback。

- [ ] **Step 4: 执行全安全门禁**
```powershell
node --test tests/social-rate-limit.test.js tests/social-security-matrix.test.js tests/social-sensitive-field-scan.test.js tests/social-hand-share-policy.test.js tests/social-comments.test.js tests/social-likes.test.js tests/social-notifications.test.js
if ($LASTEXITCODE) { exit $LASTEXITCODE }
$socialTests = Get-ChildItem tests -Filter 'social-*.test.js' | ForEach-Object { $_.FullName }
node --test $socialTests
if ($LASTEXITCODE) { exit $LASTEXITCODE }
node tests/player-notes-store.test.js
node tests/player-notes-navigation.test.js
node tests/player-notes-cloud-boundary.test.js
node tests/friend-feed-demo.test.js
node tests/friend-hand-share-demo.test.js
node tests/friend-list-message-demo.test.js
git diff --check
```

- [ ] **Step 5: Commit**
```bash
git add cloudfunctions/poker_social/lib/validation.js cloudfunctions/poker_social/lib/repository.js cloudfunctions/poker_social/database-indexes.md cloudfunctions/poker_social/app.js tests/social-rate-limit.test.js tests/social-security-matrix.test.js tests/social-sensitive-field-scan.test.js tests/social-hand-share-policy.test.js tests/social-comments.test.js tests/social-likes.test.js tests/social-notifications.test.js tests/social-profile-ranking-security.test.js tests/social-foundation-security.test.js tests/social-card-message-security.test.js
git commit -m "test: enforce social security and deployment gates"
```
### Task 8: 真实账号验收与发布候选

**Files:**
- Create: `.superpowers/sdd/plan04-task8-release-acceptance-report.md`
- Modify: `config/release-notes.js` only after explicit user authorization for development upload or release
- Modify: version source only after explicit user authorization for development upload or release

**Interfaces:** verifies the complete friend-system implementation and creates no new business API.

##### 执行合同

##### 完整部署集合

`poker_social` 环境必须存在且 server-only：

```text
social_users
social_invites
social_friendships
social_daily_stats
social_player_card_shares
social_hand_shares
social_hand_share_slots
social_comments
social_likes
social_rate_limits
social_notification_outbox
social_notifications
social_notification_state
social_notification_heads
social_notification_actors
social_mutations
```

私有 poker-data 环境必须存在并拒绝客户端直读写：

```text
sessions
hands
hand_actions
player_notes
player_card_import_receipts
sync_operations / audit_logs（若当前云写边界启用）
```

每个集合必须有 Task 7 文档要求的索引或明确 deterministic point-read；部署脚本/清单、repository 常量、account-clear scope 三者必须一致。

##### 三账号真实矩阵

使用 A（发布者）、B（accepted friend）、C（stranger）：

1. A 发布 square/friends/selected(B) 各一手；A/B 看三条，C 只看 square。验证 feed keyset、detail 和 BB/P5 snapshot 无私有字段。
2. B 对三条分别 text、emoji、sticker、reply、like；C 只能对 square 操作。A 不能删除 B 评论，B 可删自己的顶层/回复；父删除后既有回复仍显示。
3. A 收到 comment/reply/like 通知；self action 不通知；多 actor 在 10 分钟内聚合，已读或越过边界后新通知。
4. A 移除 B；B 刷新后只剩 square 可见，旧 private 评论/like 数据仍存储但不能继续读取/互动；selected outbox 尚未投递目标必须 skipped。
5. 删除源 hand，并模拟 social withdrawal 失败；核心删除仍成功，三账号 feed/detail/interaction 都不能访问 orphan。
6. A 执行 clear account：若 social clear 任一步失败，private/local 不清且明确重试；完成后所有集合达到 Task 6 清除/匿名化结果，缓存清空。
7. 同一设备依次登录 A/B/C 并断网：feed/message/friend/ranking 缓存不串号，离线只读，所有写入口不可用。
8. 真实并发/频率：publish 20/21、comment 10/11、like transition 30/31；幂等 retry 不重复计数；查看 rate/share/slot/outbox/notification state 一致性。
9. 玩家名片继续回归：指定一个好友、五字段、新建/整体覆盖、覆盖保留 ID 与 hand links、未导入 7 天/撤回/解除好友失效、receipt 幂等。
10. 抓包扫描 OpenID、privatePlayerId、sourceHandId、盈利/EV/金额/场地、真实玩家姓名、player-note 私有字段、云文件内部 ID；错误响应也扫描。

##### Preview、合规与上传边界

- 使用真实工作区执行 WeChat DevTools auto-preview，逐页核对四份 HTML demo 的关键布局和 reduced-motion；preview 不修改版本号/公告。
- 公共广场上线前执行当期微信社区内容合规复核。广场文字评论、回复和公开昵称自动检测已纳入第一版；用户举报队列仍是可拓展功能。若平台另有未满足的前置要求，则 Task 8 结论为 blocked，不得发布。
- **没有用户明确说“上传开发版”或“发布”时：不修改版本源、不更新 release notes、不执行 upload、不创建发布。**
- Task 8 交付报告必须分别写清：自动化测试、CloudBase 三账号、DevTools preview、合规复核、upload 状态；不能用 preview 成功代替上传成功。

##### 门禁与最终顺序

1. 先执行 Task 5 gate。
2. 再执行 Task 6 gate。
3. 再执行 Task 7 全 social/security/index/client-deny gate。
4. 所有本地门禁通过后部署测试环境集合、索引、权限和函数。
5. 执行三账号矩阵、并发/限频、清除、抓包与断网测试。
6. 执行真实工作区 auto-preview，不上传。
7. 完成合规复核；验证已部署的公开文本自动检测，若仍有其他未满足的强制要求则明确 blocked。
8. 仅在用户另行明确授权后，才进入版本号、公告、development upload 或 release 流程。

- [ ] **Step 1: 执行本地门禁**
  - 严格按 Task 5 → Task 6 → Task 7 顺序，全部通过后才部署测试环境。

- [ ] **Step 2: 部署完整测试环境**
  - 创建/核对执行合同列出的全部 social/private collections、索引、server-only 权限、函数和 account-clear scope。
  - 真实 query 成功验证 ARRAY/复合索引；不得以本地 mock 代替。

- [ ] **Step 3: 执行 A/B/C 三账号矩阵**
  - 完整覆盖 feed/detail/interaction/notification/remove/source-delete/clear/cache/rate/card-share 及抓包隐私扫描。

- [ ] **Step 4: 真实工作区 auto-preview 与合规复核**
  - 核对四份 HTML demo 的布局与 reduced-motion；preview 不等于 development upload/release。
  - 验证广场评论、回复和公开昵称自动检测已经生效；若平台还有其他强制能力未满足，报告 `blocked`，不得发布。

- [ ] **Step 5: 写验收报告**
  - 分别记录自动化测试、CloudBase 三账号、DevTools preview、合规复核和 upload 状态。
  - 未获用户明确授权时 upload 状态必须为“未执行”，不改版本号/公告。

- [ ] **Step 6: Commit acceptance report only**
```bash
git add .superpowers/sdd/plan04-task8-release-acceptance-report.md
git commit -m "test: record friend system release acceptance"
```

> 后续只有在用户另行明确说“上传开发版”或“发布”后，才可修改版本源和公告并执行 upload/release；该授权不由本计划推断。
