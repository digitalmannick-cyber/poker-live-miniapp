# 好友资料与排行榜 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变玩家库原语义的前提下，增加好友列表、复用玩家详情的私人资料、社交统计与 Top 10 排行榜。

**Architecture:** 好友关系和公开统计来自 `poker_social`；查看者对好友的私人标注继续存入自己 owner-scoped 的 `player_notes`。排行榜读取按北京时间聚合的日桶，只返回 Top 10 与榜外本人。

**Tech Stack:** 原生小程序页面、现有 `utils/store.js`/`services/data-service.js`、CloudBase、Node.js 测试。

## Global Constraints

- 好友本地资料只属于查看者，不能写入 `social_users` 或好友账号。
- `sourceKind: 'friend'` 的玩家记录不出现在玩家库列表。
- 解除好友后保留私人资料并转换为普通玩家库记录。
- 好友公开统计只包含称号、有效时长和记录手牌数。
- 排行榜默认本周，支持本周/本月/累计；主体只返回 Top 10。
- 统计关闭后隐藏时长、手数并退出全部排行榜。

---

### Task 1: 扩展玩家记录以承载好友私人资料

**Files:**
- Modify: `utils/store.js`
- Modify: `services/data-service.js`
- Modify: `services/cloud-data-api.js`
- Modify: `cloudfunctions/poker_data/index.js`
- Test: `tests/social-friend-player-note.test.js`
- Test: `tests/player-notes-store.test.js`
- Test: `tests/player-notes-cloud-boundary.test.js`

**Interfaces:**
- Produces: `getFriendPlayerNote(friendUserId)`、`ensureFriendPlayerNote(friendSnapshot)`、`detachFriendPlayerNote(friendUserId)`。
- Player note fields: `sourceKind: 'library' | 'friend'` and `linkedFriendUserId: string`。

- [x] **Step 1: 写好友玩家记录失败测试**

```js
const friend = store.ensureFriendPlayerNote({ socialUserId: 'su_a', nickname: '银狼' })
assert.equal(friend.sourceKind, 'friend')
assert.equal(friend.linkedFriendUserId, 'su_a')
assert.equal(store.getPlayerNotes({ sourceKind: 'library' }).some(item => item._id === friend._id), false)
assert.equal(store.getFriendPlayerNote('su_a')._id, friend._id)
const detached = store.detachFriendPlayerNote('su_a')
assert.equal(detached.sourceKind, 'library')
assert.equal(detached.linkedFriendUserId, '')
```

- [x] **Step 2: 运行测试确认 RED**

Run: `node --test tests/social-friend-player-note.test.js`

Expected: FAIL because `ensureFriendPlayerNote` is undefined。

- [x] **Step 3: 实现兼容归一化和 owner-scoped 云同步**

```js
function normalizePlayerNote(input) {
  const source = input || {}
  const sourceKind = source.sourceKind === 'friend' ? 'friend' : 'library'
  return Object.assign({}, existingFields, {
    sourceKind,
    linkedFriendUserId: sourceKind === 'friend' ? String(source.linkedFriendUserId || '').trim() : ''
  })
}

function ensureFriendPlayerNote(snapshot) {
  const friendUserId = String(snapshot && snapshot.socialUserId || '').trim()
  const current = getFriendPlayerNote(friendUserId)
  if (current) return current
  return createPlayerNote({
    sourceKind: 'friend', linkedFriendUserId: friendUserId,
    name: snapshot.nickname, type: '未分类', leakTags: [], note: '', battleHandIds: []
  })
}
```

在 `buildPlayerNoteDoc` 同步白名单中加入两个字段，但所有读取和写入继续校验当前 `playerId + ownerOpenId`。不得用 `linkedFriendUserId` 跨 owner 查询玩家记录。

- [x] **Step 4: 运行新旧玩家库测试**

Run:

```powershell
node --test tests/social-friend-player-note.test.js
if ($LASTEXITCODE) { exit $LASTEXITCODE }
node tests/player-notes-store.test.js
if ($LASTEXITCODE) { exit $LASTEXITCODE }
node tests/player-notes-cloud-boundary.test.js
```

Expected: PASS；旧备份缺少新字段时归一化为 `sourceKind: 'library'`。

- [x] **Step 5: 提交数据扩展**

```powershell
git add utils/store.js services/data-service.js services/cloud-data-api.js cloudfunctions/poker_data/index.js tests/social-friend-player-note.test.js tests/player-notes-store.test.js tests/player-notes-cloud-boundary.test.js
git commit -m "feat: store private friend annotations in player notes"
```

### Task 2: 好友列表与玩家 Tab 信息架构

**Files:**
- Create: `components/friend-hub/friend-hub.js`
- Create: `components/friend-hub/friend-hub.wxml`
- Create: `components/friend-hub/friend-hub.wxss`
- Create: `components/friend-hub/friend-hub.json`
- Modify: `pages/player-notes/player-notes.js`
- Modify: `pages/player-notes/player-notes.wxml`
- Modify: `pages/player-notes/player-notes.wxss`
- Modify: `pages/player-notes/player-notes.json`
- Modify: `cloudfunctions/poker_social/lib/friendship.js`
- Modify: `cloudfunctions/poker_social/app.js`
- Modify: `services/social-service.js`
- Test: `tests/social-player-hub.test.js`
- Test: `tests/player-notes-navigation.test.js`

**Interfaces:**
- Consumes: `socialService.listFriends({ cursor, limit: 20 })` and Task 1 player-note functions。
- Produces cloud actions: `list_friends({ cursor, limit })` and `get_friend_detail({ friendUserId })`；两个 action 都只装配当前有效好友。
- Emits: `openfriend` with `{ friendUserId }` and `openmessages`。

- [x] **Step 1: 写双层导航和玩家库回归测试**

```js
assert.match(pageWxml, /好友[\s\S]*玩家库/)
assert.match(friendHubWxml, /动态[\s\S]*好友[\s\S]*排行榜/)
assert.match(friendHubWxml, /累计时长/)
assert.match(friendHubWxml, /手牌数/)
assert.match(friendHubWxml, /玩家类型/)
assert.match(friendHubWxml, /Leak/)
assert.match(friendHubWxml, /Note/)
assert.match(pageWxml, /player-list/)
```

- [x] **Step 2: 运行测试确认 RED**

Run: `node --test tests/social-player-hub.test.js`

Expected: FAIL because `components/friend-hub` does not exist。

- [x] **Step 3: 实现懒加载好友分支**

```js
data: { playerSection: 'friends', friendSection: 'feed', friendsLoaded: false }

async selectPlayerSection(event) {
  const section = event.currentTarget.dataset.section
  this.setData({ playerSection: section })
  if (section === 'friends' && !this.data.friendsLoaded) {
    await this.selectComponent('#friendHub').loadFriends()
    this.setData({ friendsLoaded: true })
  }
}
```

玩家库列表调用 `dataService.getPlayerNotes({ sourceKind: 'library' })`。好友卡片展示私人玩家记录的头像、名称、类型、Leak、Note，并叠加允许显示的云端称号、时长、手数。社交加载失败只替换好友分支为空态。

- [x] **Step 4: 运行页面与玩家库回归**

Run:

```powershell
node --test tests/social-player-hub.test.js
if ($LASTEXITCODE) { exit $LASTEXITCODE }
node tests/player-notes-navigation.test.js
if ($LASTEXITCODE) { exit $LASTEXITCODE }
node tests/player-notes-store.test.js
```

Expected: PASS。

- [x] **Step 5: 提交玩家 Tab 改造**

```powershell
git add components/friend-hub pages/player-notes cloudfunctions/poker_social/lib/friendship.js cloudfunctions/poker_social/app.js services/social-service.js tests/social-player-hub.test.js tests/player-notes-navigation.test.js
git commit -m "feat: integrate friend hub into player tab"
```

### Task 3: 好友详情复用玩家详情

**Files:**
- Modify: `pages/player-note-detail/player-note-detail.js`
- Modify: `pages/player-note-detail/player-note-detail.wxml`
- Modify: `pages/player-note-detail/player-note-detail.wxss`
- Modify: `cloudfunctions/poker_social/lib/friendship.js`
- Modify: `services/social-service.js`
- Test: `tests/social-friend-detail.test.js`
- Test: `tests/social-player-hub.test.js`
- Test: `tests/player-notes-navigation.test.js`

**Interfaces:**
- Consumes: query `friendUserId`、`getFriendPlayerNote()`、`socialService.getFriendDetail(friendUserId)`。
- Produces: existing player editing plus `removeFriend(friendUserId, clientMutationId)`。

- [x] **Step 1: 写私人/公开字段边界测试**

```js
assert.match(detailJs, /options\.friendUserId/)
assert.match(detailWxml, /累计时长/)
assert.match(detailWxml, /记录手牌/)
assert.match(detailWxml, /称号/)
assert.match(detailWxml, /解除好友/)
assert.match(detailJs, /updatePlayerNote/)
assert.doesNotMatch(detailJs, /updateFriend.*leakTags|updateFriend.*note/)
```

- [x] **Step 2: 运行测试确认 RED**

Run: `node --test tests/social-friend-detail.test.js`

Expected: FAIL because friend mode is absent。

- [x] **Step 3: 实现双模式加载与解除保留**

```js
const socialMutation = require('../../utils/social-mutation')

async loadFriendMode(friendUserId) {
  const localNote = await dataService.getFriendPlayerNote(friendUserId)
  const remote = await socialService.getFriendDetail(friendUserId)
  this.setData({ mode: 'friend', id: localNote._id, note: localNote, friend: remote, form: buildForm(localNote) })
}

async confirmRemoveFriend() {
  await socialService.removeFriend(this.data.friend.socialUserId, socialMutation.createMutationId('remove_friend'))
  await dataService.detachFriendPlayerNote(this.data.friend.socialUserId)
  wx.switchTab({ url: '/pages/player-notes/player-notes' })
}
```

当 `statsVisible=false` 时只显示“对方已隐藏统计数据”；不渲染占位数字。私人编辑继续走现有 `updatePlayerNote`，不走社交 API。

- [x] **Step 4: 运行详情回归**

Run:

```powershell
node --test tests/social-friend-detail.test.js
if ($LASTEXITCODE) { exit $LASTEXITCODE }
node tests/player-notes-navigation.test.js
if ($LASTEXITCODE) { exit $LASTEXITCODE }
node tests/player-notes-store.test.js
```

Expected: PASS。

- [x] **Step 5: 提交好友详情**

```powershell
git add pages/player-note-detail cloudfunctions/poker_social/lib/friendship.js services/social-service.js tests/social-friend-detail.test.js tests/social-player-hub.test.js tests/player-notes-navigation.test.js
git commit -m "feat: reuse player detail for private friend notes"
```

### Task 4: 本人社交统计日桶

**Files:**
- Create: `cloudfunctions/poker_social/lib/ranking.js`
- Modify: `cloudfunctions/poker_social/lib/repository.js`
- Modify: `cloudfunctions/poker_social/index.js`
- Modify: `cloudfunctions/poker_social/app.js`
- Modify: `services/social-api.js`
- Modify: `services/social-service.js`
- Modify: `services/data-service.js`
- Test: `tests/social-stats-sync.test.js`

**Interfaces:**
- Produces cloud action `sync_my_social_stats` and `ranking.buildDailyBuckets({ sessions, hands, timezoneOffsetMinutes })`。
- Produces `socialService.scheduleMyStatsSync(playerId)`，五分钟内只触发一次。

- [x] **Step 1: 写有效时长与北京时间边界测试**

```js
const result = ranking.buildDailyBuckets({
  sessions: [
    { _id: 's1', status: 'finished', startTime: '2026-07-19 20:00', endTime: '2026-07-19 22:30' },
    { _id: 's2', status: 'active', startTime: '2026-07-19 23:00' }
  ],
  hands: [{ _id: 'h1', sessionId: 's1' }],
  timezoneOffsetMinutes: 480
})
assert.equal(result[0].durationMinutes, 150)
assert.equal(result[0].recordedHandCount, 1)
```

- [x] **Step 2: 运行测试确认 RED**

Run: `node --test tests/social-stats-sync.test.js`

Expected: FAIL because ranking module is missing。

- [x] **Step 3: 实现只读私有源和尽力同步**

```js
async function scheduleMyStatsSync(playerId) {
  const lastAt = Number(wx.getStorageSync('socialStatsSyncedAt')) || 0
  if (Date.now() - lastAt < 5 * 60 * 1000) return { skipped: true }
  const result = await socialApi.callSocialFunction('sync_my_social_stats', {
    playerId: String(playerId || '').trim().toUpperCase()
  })
  wx.setStorageSync('socialStatsSyncedAt', Date.now())
  return result
}
```

在场次/手牌写入成功后调用该函数并 `.catch(logCloudBackgroundFailure)`，不得 `await` 它来决定核心写入是否成功。云函数使用当前 OpenID 与传入 `playerId` 读取本人私有数据，写入 `social_daily_stats`。

- [x] **Step 4: 验证同步与核心写入隔离**

Run: `node --test tests/social-stats-sync.test.js tests/ai-reminder-cloud-write-flow.test.js`

Expected: PASS；模拟社交同步拒绝时 `createHand` 和 `finishSession` 仍返回核心结果。

- [x] **Step 5: 提交统计日桶**

```powershell
git add cloudfunctions/poker_social/lib/ranking.js cloudfunctions/poker_social/lib/repository.js cloudfunctions/poker_social/index.js cloudfunctions/poker_social/app.js services/social-api.js services/social-service.js services/data-service.js tests/social-stats-sync.test.js
git commit -m "feat: sync non-financial social statistics"
```

### Task 5: Top 10 排行榜与隐私设置

**Files:**
- Modify: `cloudfunctions/poker_social/lib/ranking.js`
- Modify: `cloudfunctions/poker_social/app.js`
- Modify: `components/friend-hub/friend-hub.js`
- Modify: `components/friend-hub/friend-hub.wxml`
- Modify: `components/friend-hub/friend-hub.wxss`
- Modify: `pages/profile/profile.js`
- Modify: `pages/profile/profile.wxml`
- Modify: `pages/profile/profile.wxss`
- Test: `tests/social-ranking.test.js`
- Test: `tests/social-ranking-ui.test.js`
- Test: `tests/profile-settings-editor.test.js`

**Interfaces:**
- Produces `list_ranking({ rangeKey: 'week' | 'month' | 'all' }) -> { top10, myRank }`。
- Produces `update_social_settings({ statsVisible, defaultShareScope }, clientMutationId)`。
- 排名候选严格限定为当前用户和当前仍有效的好友；不得把全站用户加入好友排行榜。周/月边界按北京时间计算。
- `statsVisible=false` 的用户从候选中剔除；本人关闭后返回空榜外本人，不得从旧日桶或缓存继续展示。
- `defaultShareScope` 仅接受 `square | friends | selected`，默认 `friends`；选择 `selected` 只表示发布页默认进入好友选择器，不保存一组永久收件人。

- [x] **Step 1: 写并列、Top 10 与榜外本人失败测试**

```js
const output = ranking.rankRows(rows, 'su_me')
assert.equal(output.top10.length, 10)
assert.equal(output.top10[1].rank, output.top10[2].rank)
assert.equal(output.myRank.socialUserId, 'su_me')
assert.ok(output.myRank.rank > 10)
assert.equal(JSON.stringify(output).includes('profit'), false)
```

- [x] **Step 2: 运行测试确认 RED**

Run: `node --test tests/social-ranking.test.js tests/social-ranking-ui.test.js`

Expected: FAIL because ranking action and UI do not exist。

- [x] **Step 3: 实现排行榜 DTO、领奖台与隐私开关**

```js
function rankRows(rows, viewerId) {
  const sorted = rows.slice().sort((a, b) => b.durationMinutes - a.durationMinutes || a.socialUserId.localeCompare(b.socialUserId))
  let previousMinutes = null
  let previousRank = 0
  const ranked = sorted.map((row, index) => {
    const rank = row.durationMinutes === previousMinutes ? previousRank : index + 1
    previousMinutes = row.durationMinutes
    previousRank = rank
    return { socialUserId: row.socialUserId, nickname: row.nickname, avatarUrl: row.avatarUrl, title: row.title, durationMinutes: row.durationMinutes, recordedHandCount: row.recordedHandCount, rank }
  })
  return { top10: ranked.slice(0, 10), myRank: ranked.find(row => row.socialUserId === viewerId) || null }
}
```

前三名使用静态领奖台、较大头像、金银铜层级和克制的入场/呼吸动效；避免旋转扇叶、强光束等喧宾夺主的效果。第 4 至 10 名使用带排名色条的完整卡片。`prefers-reduced-motion: reduce` 下关闭光环和浮动。设置关闭后云端立即把本人从排名候选剔除。本人进入 Top 10 时不得重复渲染固定卡；榜外时固定展示实际名次。

- [x] **Step 4: 运行排行榜、设置与页面回归**

Run:

```powershell
node --test tests/social-ranking.test.js tests/social-ranking-ui.test.js tests/profile-settings-editor.test.js
if ($LASTEXITCODE) { exit $LASTEXITCODE }
node tests/player-notes-navigation.test.js
```

Expected: PASS。

- [x] **Step 5: 提交排行榜与设置**

```powershell
git add cloudfunctions/poker_social/lib/ranking.js cloudfunctions/poker_social/app.js components/friend-hub pages/profile tests/social-ranking.test.js tests/social-ranking-ui.test.js tests/profile-settings-editor.test.js
git commit -m "feat: add privacy-safe friend ranking"
```

### Task 6: 第二计划验收

**Files:**
- Create: `tests/social-profile-ranking-security.test.js`

**Interfaces:**
- Verifies Tasks 1-5 and Plan 01 friendship APIs。

- [ ] **Step 1: 写敏感字段响应扫描**

```js
const forbidden = ['ownerOpenId', '_openid', 'profit', 'currentProfit', 'buyIn', 'cashOut', 'hourlyRate', 'winRate', 'venue']
const body = JSON.stringify([
  { socialUserId: 'su_friend', nickname: '银狼', avatarUrl: 'https://temp/avatar', title: '常客', durationMinutes: 90, recordedHandCount: 4 },
  ranking.rankRows([{ socialUserId: 'su_me', nickname: 'Hero', durationMinutes: 60, recordedHandCount: 3 }], 'su_me')
])
forbidden.forEach(field => assert.equal(body.includes(field), false, field + ' leaked'))
```

- [ ] **Step 2: 运行第二计划测试集**

Run: `node --test tests/social-friend-player-note.test.js tests/social-player-hub.test.js tests/social-friend-detail.test.js tests/social-stats-sync.test.js tests/social-ranking.test.js tests/social-ranking-ui.test.js tests/social-profile-ranking-security.test.js`

Expected: PASS。

- [ ] **Step 3: 运行玩家库回归**

Run: `node tests/player-notes-store.test.js; node tests/player-notes-navigation.test.js; node tests/player-notes-cloud-boundary.test.js`

Expected: three commands exit `0`。

- [ ] **Step 4: 真实工作区预览**

Run: 使用 `skills/wechat-miniapp-auto-preview/SKILL.md` 对真实工作区预览好友列表、好友详情、玩家库和排行榜。

Expected: 好友页社交失败不影响玩家库；前三名动效正常且 reduced-motion 可关闭；不上传开发版。

- [ ] **Step 5: 提交验收测试**

```powershell
git add tests/social-profile-ranking-security.test.js
git commit -m "test: protect friend profile and ranking privacy"
```
