function socialError(code, message) {
  const error = new Error(message || code)
  error.code = code
  return error
}

module.exports = { socialError }
