function hasMeaningfulVoiceEvidence(hand) {
  const source = hand || {}
  const voiceExtract = source.voiceExtract && typeof source.voiceExtract === 'object' ? source.voiceExtract : {}
  return !!(
    String(source.voiceNote || '').trim() ||
    /voice|speech|audio|agent/i.test(String(source.source || source.inputMode || source.reviewSource || '')) ||
    ['source', 'provider', 'transcript', 'rawText', 'naturalLanguageSummary', 'actionLine', 'streetSummary']
      .some(key => String(voiceExtract[key] || '').trim())
  )
}

function isFullEntryHand(hand) {
  if (!hand) return false
  const markers = [
    hand.inputMode,
    hand.reviewSource,
    hand.source,
    hand.recordType,
    hand.entryType,
    hand.reviewEntry,
    hand.createdBy
  ].map(item => String(item || '').trim().toLowerCase())
  if (markers.some(item => /(?:ledger|full|complete|precision|accurate)/i.test(item) || item.indexOf('\u7cbe\u51c6') > -1 || item.indexOf('\u5b8c\u6574') > -1)) return true
  if (hand.ledgerState) return true
  if (Array.isArray(hand.tags) && hand.tags.some(tag => {
    const value = String(tag || '').toLowerCase()
    return /(?:ledger|full)/i.test(value) || value.indexOf('\u7cbe\u51c6') > -1 || value.indexOf('\u5b8c\u6574') > -1
  })) return true
  if (Array.isArray(hand.playerSnapshots) && hand.playerSnapshots.length) return true
  if (Array.isArray(hand.actions) && hand.actions.length) return true
  if (!hasMeaningfulVoiceEvidence(hand) && hand.detailBackfilled && hand.reviewStatus === 'reviewed' && String(hand.streetSummary || hand.actionLine || '').trim()) return true
  const streets = hand.streetInputs || {}
  return !hasMeaningfulVoiceEvidence(hand) && Object.keys(streets).some(key => {
    const street = streets[key] || {}
    return String(street.actionLine || '').trim() || Number(street.pot) > 0
  })
}

module.exports = {
  isFullEntryHand,
  hasMeaningfulVoiceEvidence
}
