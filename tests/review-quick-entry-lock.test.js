const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const reviewJs = fs.readFileSync(path.join(root, 'pages/review-list/review-list.js'), 'utf8')

assert.ok(
  reviewJs.includes('const LOCKED_QUICK_ENTRY_FIELDS') &&
  reviewJs.includes("'heroCardsInput'") &&
  reviewJs.includes("'currentProfit'"),
  'review voice backfill should define quick-entry locked fields'
)

assert.ok(
  reviewJs.includes('function preserveLockedQuickEntryFields') &&
  reviewJs.includes('preserveLockedQuickEntryFields(extracted, detailHand)') &&
  reviewJs.includes('preserveLockedQuickEntryFields(Object.assign({}, parsedVoice), detailHand)'),
  'AI parsed preview and voice patch should preserve quick-entry fields from the original hand'
)

assert.ok(
  reviewJs.includes('const lockedParsedVoice = preserveLockedQuickEntryFields(Object.assign({}, parsedVoice), detailHand)') &&
  reviewJs.includes('heroCardsInput: lockedParsedVoice.heroCardsInput || current.heroCardsInput') &&
  reviewJs.includes('lockedParsedVoice.currentProfit ===') &&
  reviewJs.includes('voiceExtract: buildStoredVoiceExtract(lockedParsedVoice)'),
  'saved hand and stored voice extract should use locked quick-entry values'
)

console.log('review quick-entry lock tests passed')
