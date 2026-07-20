const { Readable } = require('stream')

function toUploadSource(source) {
  if (source && typeof source.on === 'function' && typeof source.pipe === 'function') return source
  if (Buffer.isBuffer(source)) return Readable.from([source])
  if (source instanceof Uint8Array) {
    return Readable.from([Buffer.from(source.buffer, source.byteOffset, source.byteLength)])
  }
  if (source instanceof ArrayBuffer) return Readable.from([Buffer.from(source)])
  throw new TypeError('cloud upload content must be binary or a readable stream')
}

module.exports = { toUploadSource }
