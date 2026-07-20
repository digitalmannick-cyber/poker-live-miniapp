const MAX_OPEN_ID_LENGTH = 128

function parseAdminOpenIds(raw) {
  if (typeof raw !== 'string' || /[\r\n]/u.test(raw)) return []
  const values = raw.split(',').map(value => value.trim()).filter(Boolean)
  if (!values.length || values.some(value => value.length > MAX_OPEN_ID_LENGTH || /\s/u.test(value))) return []
  return Array.from(new Set(values))
}

function createAdminPolicy(raw) {
  const allowlist = new Set(parseAdminOpenIds(raw))
  return Object.freeze({
    isAdminActor(actor) {
      const ownerOpenId = actor && typeof actor.ownerOpenId === 'string' ? actor.ownerOpenId : ''
      return !!ownerOpenId && allowlist.has(ownerOpenId)
    }
  })
}

module.exports = { parseAdminOpenIds, createAdminPolicy }
