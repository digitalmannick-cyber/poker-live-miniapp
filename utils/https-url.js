function safeHttpsUrl(value) {
  if (typeof value !== 'string') return null
  if (value === '') return ''
  if (/[\u0000-\u0020\u007f]/.test(value)) return null
  return /^https:\/\/[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::\d{1,5})?(?:[/?#][^\s]*)?$/.test(value)
    ? value
    : null
}

module.exports = { safeHttpsUrl }
