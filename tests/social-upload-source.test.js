const assert = require('node:assert/strict')
const test = require('node:test')
const { Readable } = require('node:stream')
const { toUploadSource } = require('../cloudfunctions/poker_social/lib/upload-source')

async function collect(stream) {
  const chunks = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

test('QR buffers are converted to the readable stream required by cloud uploadFile', async () => {
  const png = Buffer.from('png-binary')
  const source = toUploadSource(png)

  assert.equal(typeof source.on, 'function')
  assert.equal(typeof source.pipe, 'function')
  assert.deepEqual(await collect(source), png)
})

test('wxacode response objects upload their documented buffer field', async () => {
  const png = Buffer.from('wxacode-png')
  const source = toUploadSource({ contentType: 'image/png', buffer: png })

  assert.deepEqual(await collect(source), png)
})

test('existing readable streams are preserved and invalid upload content fails closed', () => {
  const source = Readable.from([Buffer.from('png')])
  assert.equal(toUploadSource(source), source)
  assert.throws(() => toUploadSource({}), /binary or a readable stream/)
})
