const test = require('node:test')
const assert = require('node:assert/strict')

function loadService() {
  const apiPath = require.resolve('../services/social-api')
  const servicePath = require.resolve('../services/social-service')
  const originalApi = require.cache[apiPath]
  const calls = []
  require.cache[apiPath] = {
    exports: {
      callSocialFunction: async (action, payload) => {
        calls.push({ action, payload })
        return { ok: true }
      }
    }
  }
  delete require.cache[servicePath]
  return {
    service: require('../services/social-service'),
    calls,
    restore() {
      delete require.cache[servicePath]
      if (originalApi) require.cache[apiPath] = originalApi
      else delete require.cache[apiPath]
    }
  }
}

test('interaction service exposes exact read and write payloads without forwarding authority fields', async t => {
  const loaded = loadService()
  t.after(() => loaded.restore())
  const { service, calls } = loaded

  await service.listComments({ shareId: ' share-1 ', cursor: 'opaque', limit: 20, viewerId: 'attacker' })
  await service.createComment({
    shareId: ' share-1 ', parentCommentId: ' parent-1 ', kind: ' text ', text: ' hello ', stickerId: '',
    clientMutationId: ' comment-1 ', authorId: 'attacker', source: { handId: 'private' }
  })
  await service.deleteComment({ commentId: ' comment-1 ', clientMutationId: ' delete-1 ', shareId: 'must-not-forward' })
  await service.setLike({ shareId: ' share-1 ', liked: true, clientMutationId: ' like-1 ', likeCount: 999 })

  assert.deepEqual(calls, [
    { action: 'list_comments', payload: { shareId: 'share-1', cursor: 'opaque', limit: 20 } },
    { action: 'create_comment', payload: {
      shareId: 'share-1', parentCommentId: 'parent-1', kind: 'text', text: ' hello ', stickerId: '', clientMutationId: 'comment-1'
    } },
    { action: 'delete_comment', payload: { commentId: 'comment-1', clientMutationId: 'delete-1' } },
    { action: 'set_like', payload: { shareId: 'share-1', liked: true, clientMutationId: 'like-1' } }
  ])
})

test('interaction service enforces comment pagination and the 1..128 string mutation boundary locally', async t => {
  const loaded = loadService()
  t.after(() => loaded.restore())
  const { service, calls } = loaded

  for (const input of [
    { shareId: 'share-1', cursor: null, limit: 20 },
    { shareId: 'share-1', cursor: '', limit: 0 },
    { shareId: 'share-1', cursor: '', limit: 51 },
    { shareId: 'share-1', cursor: '', limit: '20' }
  ]) {
    await assert.rejects(service.listComments(input), error => error && error.code === 'INVALID_PAGINATION')
  }

  const writes = [
    input => service.createComment(Object.assign({ shareId: 'share-1', parentCommentId: '', kind: 'text', text: 'x', stickerId: '' }, input)),
    input => service.deleteComment(Object.assign({ commentId: 'comment-1' }, input)),
    input => service.setLike(Object.assign({ shareId: 'share-1', liked: true }, input))
  ]
  for (const write of writes) {
    for (const clientMutationId of [undefined, '', '   ', 1, {}, 'x'.repeat(129)]) {
      assert.throws(() => write({ clientMutationId }), error => error && error.code === 'INVALID_MUTATION')
    }
  }
  await service.setLike({ shareId: 'share-1', liked: false, clientMutationId: 'x'.repeat(128) })
  assert.equal(calls.length, 1, 'only the valid boundary write reaches the cloud function')
})

test('social API preserves server typed error code and request id', async t => {
  const originalWx = global.wx
  const apiPath = require.resolve('../services/social-api')
  delete require.cache[apiPath]
  global.wx = {
    cloud: {
      callFunction: async () => ({ result: { code: 'CONTENT_UNAVAILABLE', message: 'content unavailable', requestId: 'req-1', data: null } })
    }
  }
  t.after(() => {
    delete require.cache[apiPath]
    if (originalWx === undefined) delete global.wx
    else global.wx = originalWx
  })

  const { callSocialFunction } = require('../services/social-api')
  await assert.rejects(
    callSocialFunction('list_comments', { shareId: 'share-1', cursor: '', limit: 20 }),
    error => error && error.code === 'CONTENT_UNAVAILABLE' && error.requestId === 'req-1' && error.message === 'content unavailable'
  )
})
