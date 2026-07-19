const test = require('node:test')
const assert = require('node:assert/strict')

const importer = require('../utils/player-card-import')

test('player names use NFKC, trim, collapsed whitespace, and lowercase', () => {
  assert.equal(importer.normalizePlayerName('  ＡＬＩＣＥ\t  Smith  '), 'alice smith')
  assert.equal(importer.normalizePlayerName('老\n\n张'), '老 张')
})

test('duplicate detection is current-name only and library-only', () => {
  const notes = [
    { _id: 'friend', sourceKind: 'friend', name: 'Alice Smith' },
    { _id: 'alias-only', sourceKind: 'library', name: '老王', alias: ['Alice Smith'] },
    { _id: 'archived', sourceKind: 'library', name: 'Alice Smith', archived: true },
    { _id: 'library', sourceKind: 'library', name: ' Ａlice   Smith ', alias: ['ignored'] }
  ]
  assert.equal(importer.findDuplicateByName(notes, 'alice smith')._id, 'library')
  assert.equal(importer.findDuplicateByName(notes, '老张'), null)
})

test('overwrite patch is a strict five-category whitelist plus receiver avatar asset', () => {
  const patch = importer.buildCardOverwritePatch({
    name: '老张', type: '激进', leakTags: ['x'], note: 'n',
    avatarUrl: 'https://temporary.example/avatar.png', alias: ['别名'],
    battleHandIds: ['h2'], createdAt: 99
  }, {
    avatarUrl: 'cloud://receiver-env/player-card/avatar.png',
    avatarFileId: 'cloud://receiver-env/player-card/avatar.png'
  })
  assert.deepEqual(Object.keys(patch).sort(), ['avatarFileId', 'avatarUrl', 'leakTags', 'name', 'note', 'type'])
  assert.equal(patch.avatarUrl, 'cloud://receiver-env/player-card/avatar.png')
  assert.equal(Object.hasOwn(patch, 'alias'), false)
  assert.equal(Object.hasOwn(patch, 'battleHandIds'), false)
  assert.equal(Object.hasOwn(patch, 'createdAt'), false)
})

test('applying overwrite keeps ids, relationship, hands, and system metadata', () => {
  const existing = {
    _id: 'p1', playerId: 'ME', sourceKind: 'library', linkedFriendUserId: '',
    name: '旧名', avatarUrl: '', avatarFileId: '', type: '稳健', leakTags: ['old'], note: 'old',
    battleHandIds: ['h1'], linkedHandIds: ['h0'], createdAt: 1, updatedAt: 2,
    lastSeenAt: 3, lastVenue: 'home', lastStake: '2/5'
  }
  const next = Object.assign({}, existing, importer.buildCardOverwritePatch({
    name: '新名', avatarUrl: '', type: '激进', leakTags: ['new'], note: 'new'
  }))
  for (const key of ['_id', 'playerId', 'sourceKind', 'linkedFriendUserId', 'battleHandIds', 'linkedHandIds', 'createdAt', 'lastSeenAt', 'lastVenue', 'lastStake']) {
    assert.deepEqual(next[key], existing[key], key + ' must be preserved')
  }
  assert.equal(next.name, '新名')
})

test('temporary HTTPS avatar is downloaded and reuploaded under receiver cloud storage', async () => {
  const calls = []
  const copied = await importer.copyCardAvatar('https://temp.example/a.png', 'import:mutation/1', {
    downloadFile(input) {
      calls.push(['download', input.url])
      input.success({ statusCode: 200, tempFilePath: 'wxfile://tmp/card.png' })
    },
    uploadFile(input) {
      calls.push(['upload', input.cloudPath, input.filePath])
      input.success({ fileID: 'cloud://receiver-env/player-card/import-mutation-1.png' })
    }
  })
  assert.deepEqual(copied, {
    avatarUrl: 'cloud://receiver-env/player-card/import-mutation-1.png',
    avatarFileId: 'cloud://receiver-env/player-card/import-mutation-1.png'
  })
  assert.equal(calls[0][0], 'download')
  assert.equal(calls[1][0], 'upload')
  assert.equal(calls[1][2], 'wxfile://tmp/card.png')
})

test('unsafe avatar sources and failed copies never become stored avatar values', async () => {
  for (const url of ['cloud://source/private', 'data:image/png;base64,a', 'wxfile://tmp/a.png', 'http://a.test/a.png']) {
    await assert.rejects(importer.copyCardAvatar(url, 'm', {}), error => error.code === 'INVALID_CARD_AVATAR')
  }
  await assert.rejects(importer.copyCardAvatar('https://temp.example/a.png', 'm', {
    downloadFile(input) { input.fail(new Error('offline')) },
    uploadFile() {}
  }), error => error.code === 'CARD_AVATAR_COPY_FAILED')
})
