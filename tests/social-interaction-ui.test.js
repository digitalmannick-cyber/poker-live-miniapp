const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')

const root = path.resolve(__dirname, '..')
const pageJs = path.join(root, 'pages/social-hand-detail/social-hand-detail.js')
const pageWxml = path.join(root, 'pages/social-hand-detail/social-hand-detail.wxml')
const stickerModule = path.join(root, 'utils/poker-stickers.js')

test('interaction surface uses icon actions, one-level replies and the frozen sticker catalogue', () => {
  assert.equal(fs.existsSync(stickerModule), true)
  const stickers = require(stickerModule)
  assert.deepEqual(stickers.POKER_STICKER_IDS, [
    'all_in', 'nice_hand', 'hero_call', 'bad_beat', 'good_fold', 'thinking'
  ])
  const serverStickers = require('../cloudfunctions/poker_social/lib/poker-stickers')
  assert.deepEqual(stickers.POKER_STICKER_IDS, serverStickers.POKER_STICKER_IDS)
  assert.equal(Object.isFrozen(stickers.POKER_STICKER_IDS), true)
  assert.equal(Object.isFrozen(stickers.POKER_STICKERS), true)

  const wxml = fs.readFileSync(pageWxml, 'utf8')
  assert.match(wxml, /bindtap="toggleLike"/)
  assert.match(wxml, /bindtap="loadMoreComments"/)
  assert.match(wxml, /bindtap="chooseSticker"/)
  assert.match(wxml, /bindtap="replyToComment"/)
  assert.match(wxml, /wx:if="\{\{item\.canDelete\}\}"/)
  assert.match(wxml, /wx:if="\{\{item\.canModerate\}\}"/)
  assert.match(wxml, /bindtap="moderateComment"/)
  assert.match(wxml, /item\.parentCommentId \? 'comment-row reply-row'/)
  assert.match(wxml, /commentsStatus !== 'ready' \? 'interaction-disabled'/)
  assert.doesNotMatch(wxml, /互动将在后续版本开放/)
})

test('administrator capability derives mutually exclusive author delete and moderation actions', async () => {
  const loaded = loadPage({
    details: [detail({ canModerateComments: true })],
    profiles: [{ socialUserId: 'su-me' }],
    commentPages: [{
      items: [
        comment('c-other', 'su-other'),
        comment('c-mine', 'su-me'),
        comment('c-deleted', 'su-other', { deleted: true, text: '该评论已被管理员移除' })
      ],
      nextCursor: null
    }]
  })
  try {
    const page = createInstance(loaded.definition)
    await page.onLoad({ shareId: 'share-1' })
    assert.deepEqual(page.data.comments.map(item => [item.commentId, item.canDelete, item.canModerate]), [
      ['c-other', false, true],
      ['c-mine', true, false],
      ['c-deleted', false, false]
    ])
  } finally { loaded.restore() }
})

test('moderation ActionSheet maps fixed reasons and applies only authoritative server state', async () => {
  const removed = comment('c-other', 'su-other', { deleted: true, text: '该评论已被管理员移除' })
  const loaded = loadPage({
    details: [detail({ canModerateComments: true })],
    commentPages: [{ items: [comment('c-other', 'su-other')], nextCursor: null }],
    actionSheets: [{ tapIndex: 1 }],
    moderations: [{ comment: removed, commentCount: 1 }]
  })
  try {
    const page = createInstance(loaded.definition)
    await page.onLoad({ shareId: 'share-1' })
    await page.moderateComment({ currentTarget: { dataset: { commentId: 'c-other' } } })
    assert.deepEqual(loaded.calls.actionSheets, [['垃圾广告', '骚扰或攻击', '泄露隐私', '违法或欺诈', '其他违规']])
    assert.equal(loaded.calls.moderations.length, 1)
    assert.equal(loaded.calls.moderations[0].commentId, 'c-other')
    assert.equal(loaded.calls.moderations[0].reason, 'abuse')
    assert.equal(typeof loaded.calls.moderations[0].clientMutationId, 'string')
    assert.equal(page.data.comments[0].text, '该评论已被管理员移除')
    assert.equal(page.data.comments[0].canModerate, false)
    assert.equal(page.data.detail.commentCount, 1)
  } finally { loaded.restore() }
})

test('cancelled or stale moderation sheets never send an administrator request', async () => {
  const pending = {}
  const loaded = loadPage({
    details: [detail({ canModerateComments: true })],
    commentPages: [{ items: [comment('c-other', 'su-other')], nextCursor: null }],
    actionSheets: [typedError('CANCEL'), { pending }]
  })
  try {
    const page = createInstance(loaded.definition)
    await page.onLoad({ shareId: 'share-1' })
    await page.moderateComment({ currentTarget: { dataset: { commentId: 'c-other' } } })
    assert.equal(loaded.calls.moderations.length, 0)
    const stale = page.moderateComment({ currentTarget: { dataset: { commentId: 'c-other' } } })
    page.onHide()
    pending.success({ tapIndex: 0 })
    await stale
    assert.equal(loaded.calls.moderations.length, 0)
  } finally { loaded.restore() }
})

test('revoked moderator permission reloads the still-readable detail instead of marking the hand unavailable', async () => {
  const loaded = loadPage({
    details: [detail({ canModerateComments: true }), detail({ canModerateComments: false })],
    profiles: [{ socialUserId: 'su-me' }, { socialUserId: 'su-me' }],
    commentPages: [
      { items: [comment('c-other', 'su-other')], nextCursor: null },
      { items: [comment('c-other', 'su-other')], nextCursor: null }
    ],
    actionSheets: [{ tapIndex: 0 }],
    moderations: [typedError('FORBIDDEN')]
  })
  try {
    const page = createInstance(loaded.definition)
    await page.onLoad({ shareId: 'share-1' })
    await page.moderateComment({ currentTarget: { dataset: { commentId: 'c-other' } } })
    assert.equal(page.data.status, 'ready')
    assert.equal(page.data.detail.canModerateComments, false)
    assert.equal(page.data.comments[0].canModerate, false)
    assert.equal(loaded.calls.detail.length, 2)
    assert.equal(loaded.calls.toast.at(-1).title, '管理权限已变化')
  } finally { loaded.restore() }
})

test('response-lost administrator delete retries with the same mutation id', async () => {
  const removed = comment('c-other', 'su-other', { deleted: true, text: '该评论已被管理员移除' })
  const loaded = loadPage({
    details: [detail({ canModerateComments: true })],
    commentPages: [{ items: [comment('c-other', 'su-other')], nextCursor: null }],
    actionSheets: [{ tapIndex: 4 }, { tapIndex: 4 }],
    moderations: [typedError('NETWORK_ERROR'), { comment: removed, commentCount: 1 }]
  })
  try {
    const page = createInstance(loaded.definition)
    await page.onLoad({ shareId: 'share-1' })
    await page.moderateComment({ currentTarget: { dataset: { commentId: 'c-other' } } })
    const lostId = loaded.calls.moderations[0].clientMutationId
    await page.moderateComment({ currentTarget: { dataset: { commentId: 'c-other' } } })
    assert.equal(loaded.calls.moderations[1].clientMutationId, lostId)
    assert.equal(page.data.comments[0].deleted, true)
  } finally { loaded.restore() }
})

test('detail loads strict comments and derives delete authority only from my public social id', async () => {
  const loaded = loadPage({
    profiles: [{ socialUserId: 'su-me' }],
    commentPages: [{
      items: [comment('c-other', 'su-other'), comment('c-mine', 'su-me', { parentCommentId: 'c-other' })],
      nextCursor: 'cursor-1'
    }]
  })
  try {
    const page = createInstance(loaded.definition)
    await page.onLoad({ shareId: 'share-1' })

    assert.equal(page.data.status, 'ready')
    assert.equal(page.data.commentsStatus, 'ready')
    assert.equal(page.data.commentsNextCursor, 'cursor-1')
    assert.deepEqual(page.data.comments.map(item => [item.commentId, item.canDelete, item.isReply]), [
      ['c-other', false, false],
      ['c-mine', true, true]
    ])
    assert.deepEqual(loaded.calls.profile, [true])
    assert.deepEqual(loaded.calls.comments, [{ shareId: 'share-1', cursor: '', limit: 20 }])
  } finally { loaded.restore() }
})

test('profile failure fails closed for delete while comments remain readable', async () => {
  const loaded = loadPage({
    profiles: [typedError('NETWORK_ERROR')],
    commentPages: [{ items: [comment('c-mine', 'su-me')], nextCursor: null }]
  })
  try {
    const page = createInstance(loaded.definition)
    await page.onLoad({ shareId: 'share-1' })
    assert.equal(page.data.status, 'ready')
    assert.equal(page.data.commentsStatus, 'ready')
    assert.equal(page.data.mySocialUserId, '')
    assert.equal(page.data.comments[0].canDelete, false)
  } finally { loaded.restore() }
})

test('comment DTO rejects non-string leaves, polluted shapes and invalid timestamps without retaining canaries', async t => {
  const cases = [
    ['comment id number', row => { row.commentId = 7 }],
    ['parent object', row => { row.parentCommentId = { canary: 'CANARY_COMMENT' } }],
    ['author nickname object', row => { row.author.nickname = { canary: 'CANARY_COMMENT' } }],
    ['kind number', row => { row.kind = 7 }],
    ['unknown sticker', row => { row.kind = 'sticker'; row.text = ''; row.stickerId = 'unknown' }],
    ['mixed text sticker', row => { row.stickerId = 'all_in' }],
    ['createdAt zero', row => { row.createdAt = 0 }],
    ['createdAt unsafe', row => { row.createdAt = Number.MAX_SAFE_INTEGER + 1 }],
    ['extra private key', row => { row.authorId = 'CANARY_COMMENT' }]
  ]

  for (const [name, mutate] of cases) {
    await t.test(name, async () => {
      const row = comment('c-bad', 'su-other')
      mutate(row)
      const loaded = loadPage({ commentPages: [{ items: [row], nextCursor: null }] })
      try {
        const page = createInstance(loaded.definition)
        await page.onLoad({ shareId: 'share-1' })
        assert.equal(page.data.status, 'ready')
        assert.equal(page.data.commentsStatus, 'error')
        assert.deepEqual(page.data.comments, [])
        assert.doesNotMatch(JSON.stringify(page.data), /CANARY_COMMENT/)
      } finally { loaded.restore() }
    })
  }
})

test('detail and comment avatar URLs allow only empty or parseable https values', async t => {
  const invalidValues = ['cloud://avatar', 'signed:cloud://avatar', 'http://example/avatar', 'not a url']
  for (const invalidValue of invalidValues) {
    await t.test(`detail rejects ${invalidValue}`, async () => {
      const dto = detail()
      dto.publisher.avatarUrl = invalidValue
      const loaded = loadPage({ details: [dto] })
      try {
        const page = createInstance(loaded.definition)
        await page.onLoad({ shareId: 'share-1' })
        assert.equal(page.data.status, 'error')
        assert.equal(page.data.detail, null)
      } finally { loaded.restore() }
    })

    await t.test(`comment rejects ${invalidValue}`, async () => {
      const row = comment('c-avatar', 'su-other')
      row.author.avatarUrl = invalidValue
      const loaded = loadPage({ commentPages: [{ items: [row], nextCursor: null }] })
      try {
        const page = createInstance(loaded.definition)
        await page.onLoad({ shareId: 'share-1' })
        assert.equal(page.data.status, 'ready')
        assert.equal(page.data.commentsStatus, 'error')
        assert.deepEqual(page.data.comments, [])
      } finally { loaded.restore() }
    })
  }

  const loaded = loadPage({ commentPages: [{ items: [comment('c-empty-avatar', 'su-other')], nextCursor: null }] })
  try {
    const page = createInstance(loaded.definition)
    await page.onLoad({ shareId: 'share-1' })
    assert.equal(page.data.status, 'ready')
    assert.equal(page.data.commentsStatus, 'ready')
    assert.equal(page.data.detail.publisher.avatarUrl, 'https://example/avatar')
    assert.equal(page.data.comments[0].author.avatarUrl, '')
  } finally { loaded.restore() }
})

test('comment keyset pagination is singleflight, deduplicates ids and ignores hidden stale results', async () => {
  const nextPage = deferred()
  const loaded = loadPage({
    commentPages: [
      { items: [comment('c-1', 'su-other')], nextCursor: 'cursor-1' },
      nextPage.promise
    ]
  })
  try {
    const page = createInstance(loaded.definition)
    await page.onLoad({ shareId: 'share-1' })
    const first = page.loadMoreComments()
    const same = page.loadMoreComments()
    assert.equal(first, same)
    assert.deepEqual(loaded.calls.comments[1], { shareId: 'share-1', cursor: 'cursor-1', limit: 20 })

    page.onHide()
    nextPage.resolve({ items: [comment('c-1', 'su-other'), comment('c-2', 'su-other')], nextCursor: null })
    await first
    assert.deepEqual(page.data.comments.map(item => item.commentId), ['c-1'])
  } finally { loaded.restore() }
})

test('like, create and delete writes stay disabled until profile and first comments settle', async () => {
  const profile = deferred()
  const firstComments = deferred()
  const loaded = loadPage({
    profiles: [profile.promise],
    commentPages: [firstComments.promise],
    likes: [{ shareId: 'share-1', likedByMe: true, likeCount: 3 }],
    creates: [{ comment: comment('c-early', 'su-me'), commentCount: 3 }],
    deletes: [{ comment: comment('c-mine', 'su-me', { deleted: true, text: '该评论已删除' }), commentCount: 1 }]
  })
  try {
    const page = createInstance(loaded.definition)
    const loading = page.onLoad({ shareId: 'share-1' })
    await Promise.resolve()
    await Promise.resolve()
    assert.equal(page.data.status, 'ready')
    assert.equal(page.data.commentsStatus, 'loading')
    page.onCommentInput({ detail: { value: 'too early' } })
    page.data.comments = [Object.assign(comment('c-mine', 'su-me'), { canDelete: true })]

    await page.submitComment()
    await page.toggleLike()
    await page.deleteComment({ currentTarget: { dataset: { commentId: 'c-mine' } } })
    assert.deepEqual([loaded.calls.creates.length, loaded.calls.likes.length, loaded.calls.deletes.length], [0, 0, 0])

    profile.resolve({ socialUserId: 'su-me' })
    firstComments.resolve({ items: [], nextCursor: null })
    await loading
  } finally { loaded.restore() }
})

test('desired like is singleflight and applies only the authoritative server state and count', async () => {
  const pending = deferred()
  const loaded = loadPage({ likes: [pending.promise] })
  try {
    const page = createInstance(loaded.definition)
    await page.onLoad({ shareId: 'share-1' })
    const first = page.toggleLike()
    const same = page.toggleLike()
    assert.equal(first, same)
    assert.equal(page.data.detail.likedByMe, false)
    assert.equal(page.data.likeSubmitting, true)
    assert.equal(loaded.calls.likes.length, 1)
    assert.equal(loaded.calls.likes[0].shareId, 'share-1')
    assert.equal(loaded.calls.likes[0].liked, true)
    assert.equal(typeof loaded.calls.likes[0].clientMutationId, 'string')

    pending.resolve({ shareId: 'share-1', likedByMe: true, likeCount: 41 })
    await first
    assert.equal(page.data.detail.likedByMe, true)
    assert.equal(page.data.detail.likeCount, 41)
    assert.equal(page.data.likeSubmitting, false)
  } finally { loaded.restore() }
})

test('response-lost comment retry reuses its mutation id, success clears it, and payload changes rotate it', async () => {
  const loaded = loadPage({ creates: [
    typedError('NETWORK_ERROR'),
    { comment: comment('c-retry', 'su-me', { text: '同一条' }), commentCount: 3 },
    { comment: comment('c-new-operation', 'su-me', { text: '同一条' }), commentCount: 4 },
    typedError('NETWORK_ERROR'),
    { comment: comment('c-changed', 'su-me', { text: '已变化' }), commentCount: 5 }
  ] })
  try {
    const page = createInstance(loaded.definition)
    await page.onLoad({ shareId: 'share-1' })

    page.onCommentInput({ detail: { value: '同一条' } })
    await page.submitComment()
    const lostId = loaded.calls.creates[0].clientMutationId
    await page.submitComment()
    assert.equal(loaded.calls.creates[1].clientMutationId, lostId)

    page.onCommentInput({ detail: { value: '同一条' } })
    await page.submitComment()
    assert.notEqual(loaded.calls.creates[2].clientMutationId, lostId)

    page.onCommentInput({ detail: { value: '旧内容' } })
    await page.submitComment()
    const oldPayloadId = loaded.calls.creates[3].clientMutationId
    page.onCommentInput({ detail: { value: '已变化' } })
    await page.submitComment()
    assert.notEqual(loaded.calls.creates[4].clientMutationId, oldPayloadId)
  } finally { loaded.restore() }
})

test('hide preserves a failed comment mutation chain for retry after reauthorization', async () => {
  const responseLost = deferred()
  const loaded = loadPage({
    details: [detail(), detail()],
    profiles: [{ socialUserId: 'su-me' }, { socialUserId: 'su-me' }],
    commentPages: [{ items: [], nextCursor: null }, { items: [], nextCursor: null }],
    creates: [responseLost.promise, { comment: comment('c-after-show', 'su-me', { text: '别重复' }), commentCount: 3 }]
  })
  try {
    const page = createInstance(loaded.definition)
    await page.onLoad({ shareId: 'share-1' })
    page.onCommentInput({ detail: { value: '别重复' } })
    const first = page.submitComment()
    const lostId = loaded.calls.creates[0].clientMutationId
    page.onHide()
    responseLost.reject(typedError('NETWORK_ERROR'))
    await first
    await page.onShow()
    await page.submitComment()
    assert.equal(loaded.calls.creates[1].clientMutationId, lostId)
  } finally { loaded.restore() }
})

test('hide preserves a successful stale comment mutation id for exact retry after reauthorization', async () => {
  const staleSuccess = deferred()
  const loaded = loadPage({
    details: [detail(), detail()],
    profiles: [{ socialUserId: 'su-me' }, { socialUserId: 'su-me' }],
    commentPages: [{ items: [], nextCursor: null }, { items: [], nextCursor: null }],
    creates: [
      staleSuccess.promise,
      { comment: comment('c-stale-success', 'su-me', { text: 'dedupe me' }), commentCount: 3 }
    ]
  })
  try {
    const page = createInstance(loaded.definition)
    await page.onLoad({ shareId: 'share-1' })
    page.onCommentInput({ detail: { value: 'dedupe me' } })
    const first = page.submitComment()
    const mutationId = loaded.calls.creates[0].clientMutationId
    page.onHide()
    staleSuccess.resolve({ comment: comment('c-stale-success', 'su-me', { text: 'dedupe me' }), commentCount: 3 })
    await first
    await page.onShow()
    await page.submitComment()
    assert.equal(loaded.calls.creates[1].clientMutationId, mutationId)
  } finally { loaded.restore() }
})

test('separate page instances never share a failed mutation chain', async () => {
  const loaded = loadPage({
    details: [detail(), detail()],
    profiles: [{ socialUserId: 'su-me' }, { socialUserId: 'su-me' }],
    commentPages: [{ items: [], nextCursor: null }, { items: [], nextCursor: null }],
    creates: [typedError('NETWORK_ERROR'), typedError('NETWORK_ERROR')]
  })
  try {
    const firstPage = createInstance(loaded.definition)
    await firstPage.onLoad({ shareId: 'share-1' })
    firstPage.onCommentInput({ detail: { value: '相同内容' } })
    await firstPage.submitComment()
    firstPage.onUnload()

    const nextPage = createInstance(loaded.definition)
    await nextPage.onLoad({ shareId: 'share-1' })
    nextPage.onCommentInput({ detail: { value: '相同内容' } })
    await nextPage.submitComment()
    assert.notEqual(loaded.calls.creates[1].clientMutationId, loaded.calls.creates[0].clientMutationId)
  } finally { loaded.restore() }
})

test('like and delete retries share mutation-chain semantics', async () => {
  const loaded = loadPage({
    commentPages: [{ items: [comment('c-mine', 'su-me')], nextCursor: null }],
    likes: [typedError('NETWORK_ERROR'), { shareId: 'share-1', likedByMe: true, likeCount: 7 }, { shareId: 'share-1', likedByMe: false, likeCount: 6 }],
    deletes: [typedError('NETWORK_ERROR'), { comment: comment('c-mine', 'su-me', { deleted: true, text: '该评论已删除' }), commentCount: 1 }]
  })
  try {
    const page = createInstance(loaded.definition)
    await page.onLoad({ shareId: 'share-1' })

    await page.toggleLike()
    const lostLikeId = loaded.calls.likes[0].clientMutationId
    await page.toggleLike()
    assert.equal(loaded.calls.likes[1].clientMutationId, lostLikeId)
    await page.toggleLike()
    assert.notEqual(loaded.calls.likes[2].clientMutationId, lostLikeId)

    const event = { currentTarget: { dataset: { commentId: 'c-mine' } } }
    await page.deleteComment(event)
    const lostDeleteId = loaded.calls.deletes[0].clientMutationId
    await page.deleteComment(event)
    assert.equal(loaded.calls.deletes[1].clientMutationId, lostDeleteId)
  } finally { loaded.restore() }
})

test('comment-only privacy delete succeeds closed while polluted delete result is rejected', async () => {
  const deleted = comment('c-mine', 'su-me', { deleted: true, text: '该评论已删除' })
  const privacy = loadPage({
    commentPages: [{ items: [comment('c-mine', 'su-me')], nextCursor: null }],
    deletes: [{ comment: deleted }]
  })
  try {
    const page = createInstance(privacy.definition)
    await page.onLoad({ shareId: 'share-1' })
    await page.deleteComment({ currentTarget: { dataset: { commentId: 'c-mine' } } })
    assert.equal(page.data.status, 'unavailable')
    assert.equal(page.data.detail, null)
    assert.deepEqual(page.data.comments, [])
    assert.equal(privacy.calls.toast.length, 0)
  } finally { privacy.restore() }

  const polluted = loadPage({
    commentPages: [{ items: [comment('c-mine', 'su-me')], nextCursor: null }],
    deletes: [{ comment: deleted, unexpected: true }]
  })
  try {
    const page = createInstance(polluted.definition)
    await page.onLoad({ shareId: 'share-1' })
    await page.deleteComment({ currentTarget: { dataset: { commentId: 'c-mine' } } })
    assert.equal(page.data.status, 'ready')
    assert.equal(page.data.comments[0].deleted, false)
    assert.equal(polluted.calls.toast.length, 1)
  } finally { polluted.restore() }
})

test('text, emoji, sticker and reply creation use frozen payloads and authoritative comment counts', async () => {
  const loaded = loadPage({ creates: [
    { comment: comment('c-text', 'su-me', { text: '打得好' }), commentCount: 8 },
    { comment: comment('c-reply', 'su-me', { parentCommentId: 'c-other', text: '👍' }), commentCount: 9 },
    { comment: comment('c-sticker', 'su-me', { kind: 'sticker', text: '', stickerId: 'hero_call' }), commentCount: 10 }
  ], commentPages: [{ items: [comment('c-other', 'su-other')], nextCursor: null }] })
  try {
    const page = createInstance(loaded.definition)
    await page.onLoad({ shareId: 'share-1' })

    page.onCommentInput({ detail: { value: '  打得好  ' } })
    await page.submitComment()
    assert.deepEqual(stripMutation(loaded.calls.creates[0]), {
      shareId: 'share-1', parentCommentId: '', kind: 'text', text: '打得好', stickerId: ''
    })
    assert.equal(page.data.detail.commentCount, 8)

    page.replyToComment({ currentTarget: { dataset: { commentId: 'c-other' } } })
    page.appendEmoji({ currentTarget: { dataset: { emoji: '👍' } } })
    await page.submitComment()
    assert.deepEqual(stripMutation(loaded.calls.creates[1]), {
      shareId: 'share-1', parentCommentId: 'c-other', kind: 'text', text: '👍', stickerId: ''
    })
    assert.equal(page.data.detail.commentCount, 9)

    await page.chooseSticker({ currentTarget: { dataset: { stickerId: 'hero_call' } } })
    assert.deepEqual(stripMutation(loaded.calls.creates[2]), {
      shareId: 'share-1', parentCommentId: '', kind: 'sticker', text: '', stickerId: 'hero_call'
    })
    assert.equal(page.data.detail.commentCount, 10)
    assert.deepEqual(page.data.comments.slice(0, 3).map(item => item.commentId), ['c-sticker', 'c-reply', 'c-text'])
  } finally { loaded.restore() }
})

test('a publisher still cannot delete another author comment and server count is authoritative', async () => {
  const loaded = loadPage({
    profiles: [{ socialUserId: 'su-publisher' }],
    commentPages: [{ items: [comment('c-other', 'su-other'), comment('c-publisher', 'su-publisher')], nextCursor: null }],
    deletes: [{ comment: comment('c-publisher', 'su-publisher', { deleted: true, text: '该评论已删除' }), commentCount: 4 }]
  })
  try {
    const page = createInstance(loaded.definition)
    await page.onLoad({ shareId: 'share-1' })
    await page.deleteComment({ currentTarget: { dataset: { commentId: 'c-other' } } })
    assert.equal(loaded.calls.deletes.length, 0)

    await page.deleteComment({ currentTarget: { dataset: { commentId: 'c-publisher' } } })
    assert.equal(loaded.calls.deletes.length, 1)
    assert.equal(loaded.calls.deletes[0].commentId, 'c-publisher')
    assert.equal(page.data.detail.commentCount, 4)
    const deleted = page.data.comments.find(item => item.commentId === 'c-publisher')
    assert.equal(deleted.deleted, true)
    assert.equal(deleted.canDelete, false)
  } finally { loaded.restore() }
})

test('show after hide reauthorizes detail, profile and first comment page', async () => {
  const loaded = loadPage({
    details: [detail(), detail({ likeCount: 9 })],
    profiles: [{ socialUserId: 'su-me' }, { socialUserId: 'su-me' }],
    commentPages: [
      { items: [comment('c-old', 'su-other')], nextCursor: null },
      { items: [comment('c-fresh', 'su-other')], nextCursor: null }
    ]
  })
  try {
    const page = createInstance(loaded.definition)
    await page.onLoad({ shareId: 'share-1' })
    await page.onShow()
    page.onHide()
    await page.onShow()
    assert.equal(loaded.calls.detail.length, 2)
    assert.equal(loaded.calls.profile.length, 2)
    assert.equal(loaded.calls.comments.length, 2)
    assert.equal(page.data.detail.likeCount, 9)
    assert.deepEqual(page.data.comments.map(item => item.commentId), ['c-fresh'])
  } finally { loaded.restore() }
})

function detail(patch = {}) {
  return Object.assign({
    shareId: 'share-1',
    publisher: { socialUserId: 'su-publisher', nickname: '老王', avatarUrl: 'https://example/avatar', avatarText: '王' },
    scope: 'square', scopeLabel: '广场',
    handSnapshot: {
      version: 1,
      hero: { label: 'Hero', seat: 1, position: 'BTN', cards: ['As', 'Kd'], stackBb: 100 },
      players: [{ label: '玩家 A', seat: 2, position: 'BB', stackBb: 80 }],
      board: { flop: [], turn: [], river: [] },
      actions: [{ street: 'preflop', actor: 'Hero', type: 'raise', amountBb: 2.5 }],
      showdown: []
    },
    likedByMe: false, likeCount: 2, commentCount: 2, createdAt: 123456, isMine: false, canModerateComments: false
  }, patch)
}

function comment(commentId, socialUserId, patch = {}) {
  return Object.assign({
    commentId,
    shareId: 'share-1',
    parentCommentId: '',
    author: { socialUserId, nickname: socialUserId === 'su-me' ? '我' : '夜鸦', avatarUrl: '', avatarText: '鸦' },
    kind: 'text', text: '好牌', stickerId: '', deleted: false, createdAt: 123456
  }, patch)
}

function loadPage(options = {}) {
  let definition
  const queues = {
    details: (options.details || [detail()]).slice(),
    profiles: (options.profiles || [{ socialUserId: 'su-me' }]).slice(),
    commentPages: (options.commentPages || [{ items: [], nextCursor: null }]).slice(),
    likes: (options.likes || []).slice(),
    creates: (options.creates || []).slice(),
    deletes: (options.deletes || []).slice(),
    moderations: (options.moderations || []).slice(),
    actionSheets: (options.actionSheets || []).slice()
  }
  const calls = { detail: [], profile: [], comments: [], likes: [], creates: [], deletes: [], moderations: [], actionSheets: [], toast: [] }
  const originalLoad = Module._load
  Module._load = function load(request, parent, isMain) {
    if (parent && /pages[\\/]social-hand-detail[\\/]social-hand-detail\.js$/.test(parent.filename || '') && request === '../../services/social-service') {
      return {
        getHandShare(shareId) { calls.detail.push(shareId); return next(queues.details) },
        getMySocialProfile() { calls.profile.push(true); return next(queues.profiles) },
        listComments(input) { calls.comments.push(input); return next(queues.commentPages) },
        setLike(input) { calls.likes.push(input); return next(queues.likes) },
        createComment(input) { calls.creates.push(input); return next(queues.creates) },
        deleteComment(input) { calls.deletes.push(input); return next(queues.deletes) },
        adminDeleteComment(input) { calls.moderations.push(input); return next(queues.moderations) }
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  global.Page = value => { definition = value }
  global.wx = {
    showToast(input) { calls.toast.push(input) },
    showActionSheet(input) {
      calls.actionSheets.push(input.itemList)
      const outcome = queues.actionSheets.shift()
      if (outcome && outcome.pending) {
        outcome.pending.success = input.success
        outcome.pending.fail = input.fail
      } else if (outcome instanceof Error) input.fail(outcome)
      else input.success(outcome || { tapIndex: -1 })
    }
  }
  const resolved = require.resolve(pageJs)
  delete require.cache[resolved]
  try { require(resolved) } finally { Module._load = originalLoad; delete global.Page }
  return { definition, calls, restore() { delete require.cache[resolved]; delete global.wx } }
}

function createInstance(definition) {
  const instance = {
    data: JSON.parse(JSON.stringify(definition.data || {})),
    _patches: [],
    setData(patch) { this._patches.push(patch); Object.assign(this.data, patch) }
  }
  Object.keys(definition).forEach(key => { if (key !== 'data') instance[key] = definition[key] })
  return instance
}

function next(queue) {
  const value = queue.shift()
  if (value instanceof Error) return Promise.reject(value)
  return Promise.resolve(value)
}

function typedError(code) { const error = new Error(code); error.code = code; return error }
function deferred() { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
function stripMutation(value) { const copy = Object.assign({}, value); delete copy.clientMutationId; return copy }
