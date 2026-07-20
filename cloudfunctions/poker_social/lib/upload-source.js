function toUploadSource(source) {
  if (Buffer.isBuffer(source)) return source
  if (source instanceof Uint8Array) {
    return Buffer.from(source.buffer, source.byteOffset, source.byteLength)
  }
  if (source instanceof ArrayBuffer) return Buffer.from(source)
  if (source && Object.prototype.hasOwnProperty.call(source, 'buffer')) return toUploadSource(source.buffer)
  throw new TypeError('cloud upload content must contain binary data')
}

module.exports = { toUploadSource }
