const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const socialRoot = path.join(__dirname, '../cloudfunctions/poker_social')

function readManifest(name) {
  return JSON.parse(fs.readFileSync(path.join(socialRoot, name), 'utf8'))
}

function simulateClientAccess(rules, collection, operation) {
  const policy = rules.collections && rules.collections[collection]
  if (!policy || policy[operation] !== true) {
    const error = new Error(`client ${operation} denied for ${collection}`)
    error.code = 'DATABASE_PERMISSION_DENIED'
    throw error
  }
  return true
}

test('deployment security manifest denies direct client reads and writes for every private collection', () => {
  const rules = readManifest('database-security-rules.json')
  const { SOCIAL_COLLECTIONS } = require('../cloudfunctions/poker_social/lib/repository')
  const expectedCollections = Array.from(new Set([
    ...Object.values(SOCIAL_COLLECTIONS),
    'player_card_import_receipts'
  ])).sort()

  assert.equal(rules.version, 1)
  assert.deepEqual(Object.keys(rules.collections || {}).sort(), expectedCollections)
  for (const collection of expectedCollections) {
    assert.deepEqual(rules.collections[collection], { read: false, write: false })
    for (const operation of ['read', 'write']) {
      assert.throws(
        () => simulateClientAccess(rules, collection, operation),
        error => error && error.code === 'DATABASE_PERMISSION_DENIED'
      )
    }
  }
})

test('deployment index manifest preserves exact compound field order and array shape', () => {
  const manifest = readManifest('database-indexes.json')
  const indexes = manifest.indexes || []
  const actual = indexes.map(index => ({ collection: index.collection, fields: index.fields }))

  assert.equal(manifest.version, 1)
  assert.deepEqual(actual, [
    {
      collection: 'social_friendships',
      fields: [
        { field: 'userA', order: 'ASC' },
        { field: 'status', order: 'ASC' },
        { field: 'acceptedAt', order: 'DESC' },
        { field: '_id', order: 'ASC' }
      ]
    },
    {
      collection: 'social_friendships',
      fields: [
        { field: 'userB', order: 'ASC' },
        { field: 'status', order: 'ASC' },
        { field: 'acceptedAt', order: 'DESC' },
        { field: '_id', order: 'ASC' }
      ]
    },
    {
      collection: 'social_hand_shares',
      fields: [
        { field: 'status', order: 'ASC' },
        { field: 'scope', order: 'ASC' },
        { field: 'createdAt', order: 'DESC' },
        { field: '_id', order: 'DESC' }
      ]
    },
    {
      collection: 'social_hand_shares',
      fields: [
        { field: 'publisherId', order: 'ASC' },
        { field: 'status', order: 'ASC' },
        { field: 'createdAt', order: 'DESC' },
        { field: '_id', order: 'DESC' }
      ]
    },
    {
      collection: 'social_hand_shares',
      fields: [
        { field: 'targetUserIds', array: true },
        { field: 'status', order: 'ASC' },
        { field: 'createdAt', order: 'DESC' },
        { field: '_id', order: 'DESC' }
      ]
    },
    {
      collection: 'social_notification_outbox',
      fields: [
        { field: 'status', order: 'ASC' },
        { field: 'targetUserIds', array: true },
        { field: 'createdAt', order: 'ASC' },
        { field: '_id', order: 'ASC' }
      ]
    },
    {
      collection: 'social_comments',
      fields: [
        { field: 'shareId', order: 'ASC' },
        { field: 'createdAt', order: 'DESC' },
        { field: '_id', order: 'DESC' }
      ]
    },
    {
      collection: 'hand_actions',
      fields: [
        { field: 'ownerOpenId', order: 'ASC' },
        { field: 'playerId', order: 'ASC' },
        { field: 'handId', order: 'ASC' },
        { field: 'sequence', order: 'ASC' },
        { field: '_id', order: 'ASC' }
      ]
    },
    {
      collection: 'hand_actions',
      fields: [
        { field: '_openid', order: 'ASC' },
        { field: 'playerId', order: 'ASC' },
        { field: 'handId', order: 'ASC' },
        { field: 'sequence', order: 'ASC' },
        { field: '_id', order: 'ASC' }
      ]
    },
    {
      collection: 'social_notifications',
      fields: [
        { field: 'recipientId', order: 'ASC' },
        { field: 'createdAt', order: 'DESC' },
        { field: '_id', order: 'DESC' }
      ]
    },
    {
      collection: 'social_users',
      fields: [
        { field: 'ownerOpenId', order: 'ASC' },
        { field: '_id', order: 'ASC' }
      ]
    },
    {
      collection: 'social_invites',
      fields: [
        { field: 'inviterId', order: 'ASC' },
        { field: 'revokedAt', order: 'ASC' },
        { field: 'createdAt', order: 'ASC' },
        { field: '_id', order: 'ASC' }
      ]
    },
    {
      collection: 'social_player_card_shares',
      fields: [
        { field: 'senderUserId', order: 'ASC' },
        { field: 'status', order: 'ASC' },
        { field: 'createdAt', order: 'DESC' },
        { field: '_id', order: 'DESC' }
      ]
    },
    {
      collection: 'social_player_card_shares',
      fields: [
        { field: 'targetUserId', order: 'ASC' },
        { field: 'status', order: 'ASC' },
        { field: 'importedAt', order: 'ASC' },
        { field: 'createdAt', order: 'DESC' },
        { field: '_id', order: 'DESC' }
      ]
    },
    {
      collection: 'social_comments',
      fields: [
        { field: 'authorId', order: 'ASC' },
        { field: 'deleted', order: 'ASC' },
        { field: 'createdAt', order: 'DESC' },
        { field: '_id', order: 'DESC' }
      ]
    },
    {
      collection: 'social_likes',
      fields: [
        { field: 'actorId', order: 'ASC' },
        { field: 'active', order: 'ASC' },
        { field: 'updatedAt', order: 'DESC' },
        { field: '_id', order: 'DESC' }
      ]
    },
    {
      collection: 'social_notifications',
      fields: [
        { field: 'actorSnapshot.socialUserId', order: 'ASC' },
        { field: 'createdAt', order: 'ASC' },
        { field: '_id', order: 'ASC' }
      ]
    },
    {
      collection: 'social_notification_heads',
      fields: [
        { field: 'recipientId', order: 'ASC' },
        { field: 'latestAt', order: 'ASC' },
        { field: '_id', order: 'ASC' }
      ]
    },
    {
      collection: 'social_notification_actors',
      fields: [
        { field: 'notificationId', order: 'ASC' },
        { field: 'createdAt', order: 'ASC' },
        { field: '_id', order: 'ASC' }
      ]
    },
    {
      collection: 'social_notification_actors',
      fields: [
        { field: 'actorId', order: 'ASC' },
        { field: 'createdAt', order: 'ASC' },
        { field: '_id', order: 'ASC' }
      ]
    },
    {
      collection: 'social_notification_outbox',
      fields: [
        { field: 'publisherId', order: 'ASC' },
        { field: 'status', order: 'ASC' },
        { field: 'createdAt', order: 'ASC' },
        { field: '_id', order: 'ASC' }
      ]
    },
    {
      collection: 'social_rate_limits',
      fields: [
        { field: 'actorId', order: 'ASC' },
        { field: '_id', order: 'ASC' }
      ]
    },
    {
      collection: 'social_rate_limits',
      fields: [
        { field: 'publisherId', order: 'ASC' },
        { field: '_id', order: 'ASC' }
      ]
    },
    {
      collection: 'social_mutations',
      fields: [
        { field: 'actorId', order: 'ASC' },
        { field: 'createdAt', order: 'ASC' },
        { field: '_id', order: 'ASC' }
      ]
    },
    {
      collection: 'social_daily_stats',
      fields: [
        { field: 'socialUserId', order: 'ASC' },
        { field: 'dateKey', order: 'ASC' },
        { field: '_id', order: 'ASC' }
      ]
    },
    {
      collection: 'social_invites',
      fields: [
        { field: 'inviterId', order: 'ASC' },
        { field: 'createdAt', order: 'DESC' },
        { field: '_id', order: 'DESC' }
      ]
    },
    {
      collection: 'social_player_card_shares',
      fields: [
        { field: 'targetUserId', order: 'ASC' },
        { field: 'status', order: 'ASC' },
        { field: 'createdAt', order: 'DESC' },
        { field: '_id', order: 'DESC' }
      ]
    },
    {
      collection: 'social_comments',
      fields: [
        { field: 'authorId', order: 'ASC' },
        { field: 'createdAt', order: 'DESC' },
        { field: '_id', order: 'DESC' }
      ]
    },
    {
      collection: 'social_likes',
      fields: [
        { field: 'actorId', order: 'ASC' },
        { field: 'updatedAt', order: 'DESC' },
        { field: '_id', order: 'DESC' }
      ]
    },
    {
      collection: 'player_card_import_receipts',
      fields: [
        { field: 'ownerOpenId', order: 'ASC' },
        { field: 'playerId', order: 'ASC' },
        { field: '_id', order: 'ASC' }
      ]
    }
  ])
  assert.deepEqual(manifest.pointReadOnly, [
    'social_user_owners',
    'social_hand_share_slots',
    'social_notification_state'
  ])

  const markdown = fs.readFileSync(path.join(socialRoot, 'database-indexes.md'), 'utf8')
  const declaration = '`social_comments`: `shareId ASC, createdAt DESC, _id DESC`'
  assert.equal(markdown.split(declaration).length - 1, 1, 'Markdown must declare the same real comment-list index exactly once')
  for (const index of actual) {
    const fields = index.fields.map(field => `${field.field} ${field.array ? 'ARRAY' : field.order}`).join(', ')
    const synchronizedDeclaration = `\`${index.collection}\`: \`${fields}\``
    assert.equal(markdown.split(synchronizedDeclaration).length - 1, 1, `Markdown must declare ${synchronizedDeclaration} exactly once`)
  }
})

test('repository deployment scope covers every Task 7 collection and account-clear query stage', () => {
  const manifest = readManifest('database-indexes.json')
  const repositorySource = fs.readFileSync(path.join(socialRoot, 'lib/repository.js'), 'utf8')
  const {
    SOCIAL_COLLECTIONS,
    ACCOUNT_CLEAR_QUERY_STAGES,
    DETERMINISTIC_POINT_READ_COLLECTIONS
  } = require('../cloudfunctions/poker_social/lib/repository')
  const { STAGES } = require('../cloudfunctions/poker_social/lib/account-clear')
  const indexedCollections = new Set((manifest.indexes || []).map(index => index.collection))
  const pointReadCollections = new Set(manifest.pointReadOnly || [])
  const deployedCollections = Array.from(new Set([
    ...Object.values(SOCIAL_COLLECTIONS),
    'player_card_import_receipts'
  ])).sort()

  for (const collection of deployedCollections) {
    assert.equal(indexedCollections.has(collection) || pointReadCollections.has(collection), true,
      `${collection} must have an index or deterministic point-read declaration`)
  }
  assert.deepEqual(ACCOUNT_CLEAR_QUERY_STAGES, STAGES.filter(stage => ![
    'profile', 'recipient_state', 'complete'
  ].includes(stage)))
  const expectedDeterministicPointReads = [
    'social_user_owners',
    'social_hand_share_slots',
    'social_rate_limits',
    'social_likes',
    'social_notification_state',
    'social_notification_heads',
    'social_notification_actors'
  ]
  assert.deepEqual(DETERMINISTIC_POINT_READ_COLLECTIONS, expectedDeterministicPointReads)
  assert.deepEqual(manifest.deterministicPointReads, expectedDeterministicPointReads)
  assert.ok((manifest.pointReadOnly || []).every(collection => expectedDeterministicPointReads.includes(collection)))
  const accountClearMethod = repositorySource.slice(
    repositorySource.indexOf('async listAccountClearBatch'),
    repositorySource.indexOf('async listAccountClearNotificationActors')
  )
  assert.doesNotMatch(accountClearMethod, /\.skip\s*\(/, 'account-clear queries must converge without offset/skip')
  assert.doesNotMatch(accountClearMethod, /catch\s*\(/, 'missing indexes must fail closed without fallback scans')
})

function createQueryRecorder(missingMethod) {
  const calls = []
  const database = {
    command: {
      in(values) { return { $in: values.slice() } },
      and(values) { return { $and: values } },
      or(values) { return { $or: values } },
      lt(value) { return { $lt: value } },
      gt(value) { return { $gt: value } },
      eq(value) { return { $eq: value } }
    },
    collection(collection) {
      const call = { collection, where: null, orders: [], limit: null, skipCalls: 0 }
      const chain = {
        where(query) { call.where = query; return chain },
        orderBy(field, direction) { call.orders.push([field, direction]); return chain },
        limit(value) { call.limit = value; return chain },
        skip() { call.skipCalls += 1; return chain },
        async get() { calls.push(JSON.parse(JSON.stringify(call))); return { data: [] } }
      }
      if (missingMethod) delete chain[missingMethod]
      return chain
    }
  }
  return { database, calls }
}

function expectedAccountClearShape(stage, id) {
  const friendship = /^friendships_([ab])_(pending|accepted|rejected)$/.exec(stage)
  if (friendship) return {
    collection: 'social_friendships',
    where: { [friendship[1] === 'a' ? 'userA' : 'userB']: id, status: friendship[2] },
    orders: [['acceptedAt', 'desc'], ['_id', 'asc']], limit: 50
  }
  const shapes = {
    invites: ['social_invites', { inviterId: id, revokedAt: 0 }, [['createdAt', 'asc'], ['_id', 'asc']]],
    hand_shares: ['social_hand_shares', { publisherId: id, status: 'active' }, [['createdAt', 'desc'], ['_id', 'desc']]],
    card_shares_sent: ['social_player_card_shares', { senderUserId: id, status: 'active' }, [['createdAt', 'desc'], ['_id', 'desc']]],
    card_shares_received: ['social_player_card_shares', { targetUserId: id, status: 'active', importedAt: 0 }, [['createdAt', 'desc'], ['_id', 'desc']]],
    comments: ['social_comments', { authorId: id, deleted: false }, [['createdAt', 'desc'], ['_id', 'desc']]],
    likes: ['social_likes', { actorId: id, active: true }, [['updatedAt', 'desc'], ['_id', 'desc']]],
    recipient_notifications: ['social_notifications', { recipientId: id }, [['createdAt', 'desc'], ['_id', 'desc']]],
    recipient_heads: ['social_notification_heads', { recipientId: id }, [['latestAt', 'asc'], ['_id', 'asc']]],
    actor_notifications: ['social_notifications', { 'actorSnapshot.socialUserId': id }, [['createdAt', 'asc'], ['_id', 'asc']]],
    actor_memberships: ['social_notification_actors', { actorId: id }, [['createdAt', 'asc'], ['_id', 'asc']]],
    outbox_publisher: ['social_notification_outbox', { publisherId: id, status: 'pending' }, [['createdAt', 'asc'], ['_id', 'asc']]],
    outbox_target: ['social_notification_outbox', { status: 'pending', targetUserIds: id }, [['createdAt', 'asc'], ['_id', 'asc']]],
    rate_actor: ['social_rate_limits', { actorId: id }, [['_id', 'asc']]],
    rate_publisher: ['social_rate_limits', { publisherId: id }, [['_id', 'asc']]],
    mutations: ['social_mutations', { actorId: id }, [['createdAt', 'asc'], ['_id', 'asc']]],
    daily_stats: ['social_daily_stats', { socialUserId: id }, [['dateKey', 'asc'], ['_id', 'asc']]]
  }
  const shape = shapes[stage]
  return shape && { collection: shape[0], where: shape[1], orders: shape[2], limit: 50 }
}

test('real repository queries match Task 7 shapes and fail closed when query builders are unavailable', async t => {
  const { createCloudSocialRepository, ACCOUNT_CLEAR_QUERY_STAGES } = require('../cloudfunctions/poker_social/lib/repository')
  const id = 'su_viewer'
  const scenarios = [
    ['square feed', repository => repository.listSquareShareCandidates({ limit: 20 }), {
      collection: 'social_hand_shares', where: { status: 'active', scope: 'square' },
      orders: [['createdAt', 'desc'], ['_id', 'desc']], limit: 20
    }],
    ['self feed', repository => repository.listSelfShareCandidates(id, { limit: 20 }), {
      collection: 'social_hand_shares', where: { publisherId: id, status: 'active' },
      orders: [['createdAt', 'desc'], ['_id', 'desc']], limit: 20
    }],
    ['friend feed', repository => repository.listFriendShareCandidates(['su_friend'], { limit: 20 }), {
      collection: 'social_hand_shares', where: { publisherId: { $in: ['su_friend'] }, status: 'active' },
      orders: [['createdAt', 'desc'], ['_id', 'desc']], limit: 20
    }],
    ['selected feed', repository => repository.listSelectedShareCandidates(id, { limit: 20 }), {
      collection: 'social_hand_shares', where: { targetUserIds: id, status: 'active' },
      orders: [['createdAt', 'desc'], ['_id', 'desc']], limit: 20
    }],
    ['friend adjacency', repository => repository.listAcceptedFriendshipsBySideKeyset(id, 'userA', { limit: 20 }), {
      collection: 'social_friendships', where: { userA: id, status: 'accepted' },
      orders: [['acceptedAt', 'desc'], ['_id', 'asc']], limit: 20
    }],
    ['recipient outbox', repository => repository.listNotificationOutboxesForRecipient(id, 5), {
      collection: 'social_notification_outbox', where: { status: 'pending', targetUserIds: id },
      orders: [['createdAt', 'asc'], ['_id', 'asc']], limit: 5
    }],
    ['comments', repository => repository.listComments('share-1', { limit: 20 }), {
      collection: 'social_comments', where: { shareId: 'share-1' },
      orders: [['createdAt', 'desc'], ['_id', 'desc']], limit: 20
    }],
    ['notifications', repository => repository.listNotifications(id, { limit: 20 }), {
      collection: 'social_notifications', where: { recipientId: id },
      orders: [['createdAt', 'desc'], ['_id', 'desc']], limit: 21
    }]
  ]

  for (const [name, invoke, expected] of scenarios) {
    await t.test(name, async () => {
      const recorded = createQueryRecorder()
      await invoke(createCloudSocialRepository(recorded.database))
      assert.deepEqual(recorded.calls, [Object.assign({ skipCalls: 0 }, expected)])
      for (const missing of ['where', 'orderBy', 'limit']) {
        const unavailable = createQueryRecorder(missing)
        await assert.rejects(invoke(createCloudSocialRepository(unavailable.database)))
        assert.equal(unavailable.calls.length, 0)
      }
    })
  }

  for (const stage of ACCOUNT_CLEAR_QUERY_STAGES) {
    await t.test('account clear ' + stage, async () => {
      const expected = expectedAccountClearShape(stage, id)
      assert.ok(expected)
      const recorded = createQueryRecorder()
      const repository = createCloudSocialRepository(recorded.database)
      await repository.listAccountClearBatch(stage, id, 50)
      assert.deepEqual(recorded.calls, [Object.assign({ skipCalls: 0 }, expected)])
      for (const missing of ['where', 'orderBy', 'limit']) {
        const unavailable = createQueryRecorder(missing)
        await assert.rejects(createCloudSocialRepository(unavailable.database).listAccountClearBatch(stage, id, 50))
        assert.equal(unavailable.calls.length, 0)
      }
    })
  }

  await t.test('account clear notification actors', async () => {
    const expected = {
      collection: 'social_notification_actors', where: { notificationId: 'notification-1' },
      orders: [['createdAt', 'asc'], ['_id', 'asc']], limit: 50
    }
    const recorded = createQueryRecorder()
    await createCloudSocialRepository(recorded.database).listAccountClearNotificationActors('notification-1', 50)
    assert.deepEqual(recorded.calls, [Object.assign({ skipCalls: 0 }, expected)])
    for (const missing of ['where', 'orderBy', 'limit']) {
      const unavailable = createQueryRecorder(missing)
      await assert.rejects(createCloudSocialRepository(unavailable.database)
        .listAccountClearNotificationActors('notification-1', 50))
      assert.equal(unavailable.calls.length, 0)
    }
  })
})
