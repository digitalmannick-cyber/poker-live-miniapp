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
    }
  ])
  assert.deepEqual(manifest.pointReadOnly, [
    'social_hand_share_slots',
    'social_rate_limits',
    'social_notification_state',
    'social_notification_heads',
    'social_notification_actors',
    'social_likes'
  ])

  const markdown = fs.readFileSync(path.join(socialRoot, 'database-indexes.md'), 'utf8')
  const declaration = '`social_comments`: `shareId ASC, createdAt DESC, _id DESC`'
  assert.equal(markdown.split(declaration).length - 1, 1, 'Markdown must declare the same real comment-list index exactly once')
})
