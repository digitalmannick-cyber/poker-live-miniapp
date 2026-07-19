const test = require('node:test')
const assert = require('node:assert/strict')

const { createSocialApp } = require('../cloudfunctions/poker_social/app')

test('social response boundary excludes private identity fields and CloudBase file identifiers', async () => {
  const app = createSocialApp({
    identity: { resolve: () => ({ ownerOpenId: 'openid-private' }) },
    handlers: {
      get_security_probe() {
        return {
          ownerOpenId: 'openid-private',
          _openid: 'openid-private',
          privatePlayerId: 'PLAYER-1',
          avatarFileId: 'cloud://avatar-private',
          nested: {
            qrCodeFile: 'cloud://social-invites/secret.png',
            visible: true
          },
          attachments: [
            'cloud://social-invites/array-secret.png',
            { previewFile: 'cloud://social-invites/object-secret.png' },
            'https://temporary.example/avatar.png'
          ]
        }
      }
    },
    requestId: () => 'security-request'
  })

  const result = await app.handle({ action: 'get_security_probe' }, {})

  assert.equal(result.code, 0)
  assert.equal(JSON.stringify(result).includes('ownerOpenId'), false)
  assert.equal(JSON.stringify(result).includes('_openid'), false)
  assert.equal(JSON.stringify(result).includes('privatePlayerId'), false)
  assert.equal(JSON.stringify(result).includes('avatarFileId'), false)
  assert.equal(JSON.stringify(result).includes('cloud://'), false)
  assert.equal(JSON.stringify(result).includes('https://temporary.example/avatar.png'), true)
})

test('social failure response never exposes CloudBase file identifiers from thrown errors', async () => {
  const app = createSocialApp({
    identity: { resolve: () => ({ ownerOpenId: 'openid-private' }) },
    handlers: {
      fail_security_probe() {
        throw new Error('failed to sign cloud://social-invites/error-secret.png')
      }
    },
    requestId: () => 'security-error-request'
  })

  const result = await app.handle({ action: 'fail_security_probe' }, {})

  assert.deepEqual(result, {
    code: 'SOCIAL_ERROR',
    data: null,
    message: 'social function failed',
    requestId: 'security-error-request'
  })
  assert.equal(JSON.stringify(result).includes('cloud://'), false)
})
