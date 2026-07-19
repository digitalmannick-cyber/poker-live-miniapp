# 社交身份与好友关系 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立独立 `poker_social` 云函数、客户端调用层、社交资料、邀请与双向好友关系状态机。

**Architecture:** 云函数入口只负责身份解析和依赖装配，纯业务逻辑放入可在 Node.js 直接测试的模块。好友对使用确定性 ID，所有状态变更通过 `clientMutationId` 幂等并由事务提交。

**Tech Stack:** 微信云开发、原生 JavaScript、`wx-server-sdk ^3.0.1`、Node.js `node:test`。

## Global Constraints

- `ownerOpenId` 只存在服务端，不得进入 DTO。
- 邀请只能发起好友申请，不能自动建立好友关系。
- 同一用户对只允许一条关系；拒绝或解除后冷却 7 天。
- 第一版不提供全站昵称搜索。
- 云函数响应统一为 `{ code, data, requestId }`。
- 客户端不得直接访问 `social_*` 集合。

---

### Task 1: 云函数骨架与客户端 API

**Files:**
- Create: `cloudfunctions/poker_social/package.json`
- Create: `cloudfunctions/poker_social/index.js`
- Create: `cloudfunctions/poker_social/app.js`
- Create: `cloudfunctions/poker_social/lib/identity.js`
- Create: `cloudfunctions/poker_social/lib/repository.js`
- Create: `cloudfunctions/poker_social/lib/social-error.js`
- Create: `services/social-api.js`
- Create: `utils/social-mutation.js`
- Create: `tests/helpers/social-fixture.js`
- Test: `tests/social-api.test.js`
- Test: `tests/social-cloud-routing.test.js`

**Interfaces:**
- Produces: `createSocialApp(deps).handle(event, context)`、`callSocialFunction(action, payload)`、`socialError(code, message)`、`createMutationId(prefix)`。
- Test helper: `createMemorySocialRepository(seed)`，提供 `get(collection, id)`、`set(collection, id, value)`、`where(collection, predicate)`、`runTransaction(callback)`。
- Response: `{ code: 0, data, requestId }` or `{ code: string, message: string, requestId }`。

- [x] **Step 1: 写客户端调用失败测试**

```js
test('callSocialFunction sends action to poker_social and maps cloud errors', async () => {
  global.wx = { cloud: { callFunction: async input => ({ result: { code: 0, data: input.data } }) } }
  const api = require('../services/social-api')
  const result = await api.callSocialFunction('get_me', { value: 1 })
  assert.equal(result.action, 'get_me')
  assert.equal(result.value, 1)
})
```

- [x] **Step 2: 运行测试确认 RED**

Run: `node --test tests/social-api.test.js`

Expected: FAIL with `Cannot find module '../services/social-api'`。

- [x] **Step 3: 实现最小 API 和可注入路由**

```js
// services/social-api.js
const SOCIAL_FUNCTION_NAME = 'poker_social'
async function callSocialFunction(action, payload) {
  if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
    const error = new Error('social function unavailable')
    error.code = 'NETWORK_ERROR'
    throw error
  }
  const response = await wx.cloud.callFunction({
    name: SOCIAL_FUNCTION_NAME,
    data: Object.assign({}, payload || {}, { action })
  })
  const body = response && response.result || {}
  if (body.code && body.code !== 0) {
    const error = new Error(body.message || 'social function failed')
    error.code = body.code
    throw error
  }
  return body.data || {}
}
module.exports = { callSocialFunction }
```

`app.js` 导出 `createSocialApp({ identity, handlers, requestId })`；未知 action 返回 `UNKNOWN_ACTION`。`index.js` 是唯一引用 `wx-server-sdk` 的入口，并将 `cloud.getWXContext().OPENID` 交给 `identity.resolve()`。

```js
// utils/social-mutation.js
function createMutationId(prefix) {
  return String(prefix || 'social') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10)
}
module.exports = { createMutationId }

// cloudfunctions/poker_social/lib/social-error.js
function socialError(code, message) {
  const error = new Error(message || code)
  error.code = code
  return error
}
module.exports = { socialError }

// tests/helpers/social-fixture.js
function createMemorySocialRepository(seed) {
  const tables = JSON.parse(JSON.stringify(seed || {}))
  return {
    get(collection, id) { return (tables[collection] || []).find(row => row._id === id) || null },
    set(collection, id, value) {
      const rows = tables[collection] || (tables[collection] = [])
      const index = rows.findIndex(row => row._id === id)
      const next = Object.assign({}, value, { _id: id })
      if (index >= 0) rows[index] = next
      else rows.push(next)
      return next
    },
    where(collection, predicate) { return (tables[collection] || []).filter(predicate) },
    runTransaction(callback) { return callback(this) },
    dump() { return JSON.parse(JSON.stringify(tables)) }
  }
}
module.exports = { createMemorySocialRepository }
```

- [x] **Step 4: 验证路由和 API**

Run: `node --test tests/social-api.test.js tests/social-cloud-routing.test.js`

Expected: PASS；测试同时断言返回对象不包含 `ownerOpenId` 和 `_openid`。

- [x] **Step 5: 提交任务文件**

```powershell
git add cloudfunctions/poker_social services/social-api.js utils/social-mutation.js tests/helpers/social-fixture.js tests/social-api.test.js tests/social-cloud-routing.test.js
git commit -m "feat: scaffold isolated social service"
```

### Task 2: 社交资料初始化与公开 DTO

**Files:**
- Create: `cloudfunctions/poker_social/lib/profile.js`
- Modify: `cloudfunctions/poker_social/lib/repository.js`
- Modify: `cloudfunctions/poker_social/index.js`
- Modify: `cloudfunctions/poker_social/app.js`
- Create: `services/social-service.js`
- Test: `tests/social-profile.test.js`

**Interfaces:**
- Consumes: `callSocialFunction(action, payload)` from Task 1。
- Produces: `initializeSocialProfile({ playerId, nickname, avatarMode, avatarFileId, statsVisible, defaultShareScope })`、`getMySocialProfile()`。
- DTO: `{ socialUserId, nickname, avatarUrl, avatarText, title, statsVisible, defaultShareScope }`。

- [x] **Step 1: 写资料白名单失败测试**

```js
test('profile DTO never exposes owner identity or avatar file id', () => {
  const dto = profile.toProfileDto({
    _id: 'su_1', ownerOpenId: 'secret', profile: { nickname: '老王', avatarFileId: 'cloud://secret' }
  }, { avatarUrl: 'https://temp/avatar' })
  assert.deepEqual(dto, {
    socialUserId: 'su_1', nickname: '老王', avatarUrl: 'https://temp/avatar',
    avatarText: '老', title: '初来乍到', statsVisible: true, defaultShareScope: 'friends'
  })
})
```

- [x] **Step 2: 运行测试确认 RED**

Run: `node --test tests/social-profile.test.js`

Expected: FAIL because `lib/profile.js` does not exist。

- [x] **Step 3: 实现随机身份与白名单映射**

```js
function normalizeProfileInput(input) {
  const source = input || {}
  const nickname = String(source.nickname || '').trim().slice(0, 24)
  if (!nickname) throw Object.assign(new Error('nickname required'), { code: 'INVALID_PROFILE' })
  return {
    privatePlayerId: String(source.playerId || '').trim().toUpperCase(),
    profile: { nickname, avatarFileId: String(source.avatarFileId || '').trim(), avatarText: nickname.slice(0, 1) },
    statsVisible: source.statsVisible !== false,
    defaultShareScope: ['square', 'friends', 'selected'].includes(source.defaultShareScope) ? source.defaultShareScope : 'friends'
  }
}
```

创建资料时使用 `crypto.randomBytes(16).toString('hex')` 生成 `su_` ID。`privatePlayerId` 只保存在服务端，用于后续读取当前账号自己的源数据，不进入 DTO。`avatarMode` 只接受 `wechat` 或 `custom`；微信头像昵称必须由用户明确选择后提交，不能静默读取。

- [x] **Step 4: 运行资料与 API 测试**

Run: `node --test tests/social-profile.test.js tests/social-api.test.js tests/social-cloud-routing.test.js`

Expected: PASS。

- [x] **Step 5: 提交资料能力**

```powershell
git add cloudfunctions/poker_social/lib/profile.js cloudfunctions/poker_social/lib/repository.js cloudfunctions/poker_social/index.js cloudfunctions/poker_social/app.js services/social-service.js tests/social-profile.test.js
git commit -m "feat: add private social identity profile"
```

### Task 3: 邀请令牌与好友申请状态机

**Files:**
- Create: `cloudfunctions/poker_social/lib/invite.js`
- Create: `cloudfunctions/poker_social/lib/friendship.js`
- Create: `cloudfunctions/poker_social/lib/idempotency.js`
- Modify: `cloudfunctions/poker_social/lib/repository.js`
- Modify: `cloudfunctions/poker_social/index.js`
- Modify: `cloudfunctions/poker_social/app.js`
- Modify: `services/social-service.js`
- Test: `tests/social-friendship.test.js`

**Interfaces:**
- Produces cloud actions: `create_invite`、`create_invite_qr`、`inspect_invite`、`send_friend_request`、`accept_friend_request`、`reject_friend_request`、`remove_friend`、`list_friends`。
- Produces service methods with the same camelCase names and required `clientMutationId` for writes。

- [x] **Step 1: 写状态机和冷却失败测试**

```js
test('friend pair is canonical and rejected pairs cool down for seven days', () => {
  assert.equal(friendship.getPairId('su_b', 'su_a'), friendship.getPairId('su_a', 'su_b'))
  const rejected = friendship.transition({ status: 'pending' }, 'reject', 1_000)
  assert.equal(rejected.status, 'rejected')
  assert.equal(rejected.cooldownUntil, 1_000 + 7 * 24 * 60 * 60 * 1000)
  assert.throws(() => friendship.transition(rejected, 'request', 2_000), error => error.code === 'FRIEND_REQUEST_COOLDOWN')
})
```

- [x] **Step 2: 运行测试确认 RED**

Run: `node --test tests/social-friendship.test.js`

Expected: FAIL because friendship module is missing。

- [x] **Step 3: 实现确定性关系、令牌摘要与幂等**

```js
function transition(current, operation, nowMs) {
  const state = current || { status: 'none' }
  if (operation === 'request' && Number(state.cooldownUntil) > nowMs) throw socialError('FRIEND_REQUEST_COOLDOWN')
  if (operation === 'accept' && state.status === 'pending') return Object.assign({}, state, { status: 'accepted', acceptedAt: nowMs, updatedAt: nowMs })
  if (operation === 'reject' && state.status === 'pending') return Object.assign({}, state, { status: 'rejected', rejectedAt: nowMs, cooldownUntil: nowMs + COOLDOWN_MS, updatedAt: nowMs })
  if (operation === 'remove' && state.status === 'accepted') return Object.assign({}, state, { status: 'removed', removedAt: nowMs, cooldownUntil: nowMs + COOLDOWN_MS, updatedAt: nowMs })
  return state
}

function buildFriendshipRecord(leftUserId, rightUserId, requesterId, nowMs) {
  const ordered = [leftUserId, rightUserId].sort()
  return {
    _id: getPairId(ordered[0], ordered[1]), userIds: ordered,
    userA: ordered[0], userB: ordered[1], requesterId,
    receiverId: requesterId === ordered[0] ? ordered[1] : ordered[0],
    status: 'pending', createdAt: nowMs, updatedAt: nowMs
  }
}
```

好友邀请码使用最少 32 随机字节的云函数环境变量 `SOCIAL_INVITE_TOKEN_SECRET`，以 HMAC-SHA256 由邀请人、动作和 `clientMutationId` 派生 22 字符代码，集合只保存 `sha256(code)`；有效期固定 7 天，密钥缺失或不足 32 字节时失败关闭。`create_invite_qr` 调用注入的 `qrCode.getUnlimited({ scene: code, page: 'pages/social-invite/social-invite' })`；事务只保存稳定邀请摘要/云路径，提交后才上传图片并返回每次可重新签发的临时展示 URL。事务通过 repository 的 `runTransaction(callback)` 完成。

`list_friends` 分别查询 `userA=current` 和 `userB=current` 的 accepted 记录后按 `acceptedAt DESC, _id ASC` 合并分页，不对 `userIds` 数组做全表扫描；offset 最大 1000，超过时公开返回 `INVALID_PAGINATION`，不得静默截断。两侧查询需要索引 `(userA ASC, status ASC, acceptedAt DESC, _id ASC)` 与 `(userB ASC, status ASC, acceptedAt DESC, _id ASC)`。

- [x] **Step 4: 运行好友关系测试**

Run: `node --test tests/social-friendship.test.js tests/social-profile.test.js tests/social-cloud-routing.test.js`

Expected: PASS；覆盖双方同时申请、重复接受、拒绝冷却、解除冷却和转发邀请不会自动建立关系。

- [x] **Step 5: 提交关系状态机**

```powershell
git add cloudfunctions/poker_social/lib/invite.js cloudfunctions/poker_social/lib/friendship.js cloudfunctions/poker_social/lib/idempotency.js cloudfunctions/poker_social/lib/repository.js cloudfunctions/poker_social/index.js cloudfunctions/poker_social/app.js services/social-service.js tests/social-friendship.test.js
git commit -m "feat: implement social friendship lifecycle"
```

### Task 4: 邀请页面与好友申请入口

**Files:**
- Create: `pages/social-invite/social-invite.js`
- Create: `pages/social-invite/social-invite.wxml`
- Create: `pages/social-invite/social-invite.wxss`
- Create: `pages/social-invite/social-invite.json`
- Modify: `cloudfunctions/poker_social/lib/friendship.js`
- Modify: `app.json`
- Modify: `pages/player-notes/player-notes.js`
- Modify: `pages/player-notes/player-notes.wxml`
- Test: `tests/social-invite-page.test.js`
- Test: `tests/social-friendship.test.js`

**Interfaces:**
- Consumes: `socialService.createInvite()`、`createInviteQr(code)`、`inspectInvite(code)`、`sendFriendRequest(code, clientMutationId)`。
- Route: 微信卡片使用 `/pages/social-invite/social-invite?token=<encodedCode>`；小程序码通过 `options.scene` 传入同一邀请码。

- [x] **Step 1: 写页面注册和交互失败测试**

```js
assert.ok(appConfig.pages.includes('pages/social-invite/social-invite'))
assert.match(inviteJs, /onShareAppMessage/)
assert.match(inviteJs, /sendFriendRequest/)
assert.match(inviteWxml, /发送好友申请/)
assert.doesNotMatch(inviteJs, /ownerOpenId|_openid/)
```

- [x] **Step 2: 运行测试确认 RED**

Run: `node --test tests/social-invite-page.test.js`

Expected: FAIL because invite page is not registered。

- [x] **Step 3: 实现邀请创建、微信卡片和二维码页面**

```js
const socialMutation = require('../../utils/social-mutation')

onLoad(options) {
  const code = decodeURIComponent(options.scene || options.token || '')
  this.setData({ inviteToken: code })
  this.inspectInvite(code)
}

onShareAppMessage() {
  return {
    title: this.data.shareTitle,
    path: '/pages/social-invite/social-invite?token=' + encodeURIComponent(this.data.inviteToken)
  }
}

async sendRequest() {
  if (this.data.submitting) return
  this.setData({ submitting: true })
  try {
    await socialService.sendFriendRequest(this.data.inviteToken, socialMutation.createMutationId('friend_request'))
    this.setData({ status: 'sent' })
  } finally {
    this.setData({ submitting: false })
  }
}
```

二维码只编码同一路径，不编码 OpenID。页面明确写“发送申请后需对方确认”，不存在“一键自动成为好友”文案。

- [x] **Step 4: 运行页面和基础回归测试**

Run:

```powershell
node --test tests/social-invite-page.test.js tests/social-friendship.test.js
if ($LASTEXITCODE) { exit $LASTEXITCODE }
node tests/player-notes-navigation.test.js
```

Expected: PASS。

- [x] **Step 5: 提交页面**

```powershell
git add pages/social-invite cloudfunctions/poker_social/lib/friendship.js app.json pages/player-notes/player-notes.js pages/player-notes/player-notes.wxml tests/social-invite-page.test.js tests/social-friendship.test.js
git commit -m "feat: add in-app friend invitation flow"
```

### Task 5: 第一阶段验收与真实账号预览

**Files:**
- Create: `tests/social-foundation-security.test.js`
- Modify: `docs/superpowers/specs/2026-07-19-friend-system-design.md` only if implementation reveals a confirmed design correction。

**Interfaces:**
- Verifies all interfaces produced by Tasks 1-4。

- [ ] **Step 1: 写跨账号安全测试**

```js
test('social responses exclude server identity fields', async () => {
  const repository = createMemorySocialRepository({ social_users: [], social_friendships: [] })
  const app = createSocialApp({ repository, identity: { resolve: () => ({ socialUserId: 'su_a' }) } })
  const responses = [
    await app.handle({ action: 'get_me' }),
    await app.handle({ action: 'list_friends' })
  ]
  const serialized = JSON.stringify(responses)
  ;['ownerOpenId', '_openid', 'cloud://secret'].forEach(field => assert.equal(serialized.includes(field), false))
})
```

- [ ] **Step 2: 运行全部第一计划测试**

Run: `Get-ChildItem tests\social-*.test.js | Where-Object Name -Match 'api|cloud-routing|profile|friendship|invite|foundation' | ForEach-Object { node --test $_.FullName; if ($LASTEXITCODE) { exit $LASTEXITCODE } }`

Expected: every test exits `0`。

- [ ] **Step 3: 部署测试环境云函数并核对集合权限**

```text
部署 cloudfunctions/poker_social 到测试环境；将 social_users、social_invites、social_friendships、social_mutations 的客户端权限设为禁止读写。使用两个真实微信账号完成邀请、申请、接受、解除和 7 天冷却显示。
```

- [ ] **Step 4: 运行真实工作区 auto-preview**

Run: 使用仓库既有 `skills/wechat-miniapp-auto-preview/SKILL.md` 流程，对 `D:\TRAE\xuan\poker-live-miniapp` 执行预览。

Expected: 编译与预览成功；不上传开发版。

- [ ] **Step 5: 提交验收测试**

```powershell
git add tests/social-foundation-security.test.js
git commit -m "test: verify social foundation security"
```
