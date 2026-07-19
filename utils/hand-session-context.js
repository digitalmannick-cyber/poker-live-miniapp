function hasOwn(source, key) {
  return !!source && Object.prototype.hasOwnProperty.call(source, key)
}

function getSessionLevel(session) {
  if (!session) return ''
  if (!session.smallBlind && !session.bigBlind) return ''
  return String(session.smallBlind || 0) + '/' + String(session.bigBlind || 0)
}

function resolveHandSessionContext(hand, session) {
  const source = hand || {}
  const ledger = source.ledgerState || {}
  const handTableSize = Number(source.playerCount || source.tableSize)
  const ledgerTableSize = Number(ledger.tableMax)
  const sessionTableSize = Number(session && (session.tableSize || session.playerCount))
  const hasHandStraddle = hasOwn(source, 'hasStraddle')
  const hasLedgerStraddle = hasOwn(ledger, 'hasStraddle')

  return {
    stakeLevel: String(source.stakeLevel || ledger.levelText || getSessionLevel(session) || ''),
    tableSize: handTableSize || ledgerTableSize || sessionTableSize || 0,
    hasStraddle: hasHandStraddle
      ? !!source.hasStraddle
      : hasLedgerStraddle
        ? !!ledger.hasStraddle
        : !!(session && session.hasStraddle),
    venue: String(source.venue || source.location || (session && session.venue) || '')
  }
}

module.exports = {
  getSessionLevel,
  resolveHandSessionContext
}
