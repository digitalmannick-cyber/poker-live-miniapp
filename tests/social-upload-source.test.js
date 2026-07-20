const assert = require('node:assert/strict')
const test = require('node:test')
const { toUploadSource } = require('../cloudfunctions/poker_social/lib/upload-source')

test('QR buffers stay as Buffer instances required by current cloud uploadFile', () => {
  const png = Buffer.from('png-binary')
  const source = toUploadSource(png)

  assert.equal(source, png)
  assert.equal(Buffer.isBuffer(source), true)
})

test('wxacode response objects upload their documented buffer field', () => {
  const png = Buffer.from('wxacode-png')
  const source = toUploadSource({ contentType: 'image/png', buffer: png })

  assert.equal(source, png)
})

test('typed arrays are normalized to Buffer and invalid upload content fails closed', () => {
  const source = toUploadSource(new Uint8Array([1, 2, 3]))
  assert.equal(Buffer.isBuffer(source), true)
  assert.deepEqual([...source], [1, 2, 3])
  assert.throws(() => toUploadSource({}), /contain binary data/)
})
