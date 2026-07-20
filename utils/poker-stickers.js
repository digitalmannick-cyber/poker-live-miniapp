const POKER_STICKER_IDS = Object.freeze([
  'all_in',
  'nice_hand',
  'hero_call',
  'bad_beat',
  'good_fold',
  'thinking'
])

const POKER_STICKERS = Object.freeze([
  Object.freeze({ id: 'all_in', emoji: '🔥', label: 'ALL IN' }),
  Object.freeze({ id: 'nice_hand', emoji: '♠️', label: '好牌' }),
  Object.freeze({ id: 'hero_call', emoji: '🦸', label: 'Hero Call' }),
  Object.freeze({ id: 'bad_beat', emoji: '💥', label: 'Bad Beat' }),
  Object.freeze({ id: 'good_fold', emoji: '🃏', label: '好弃牌' }),
  Object.freeze({ id: 'thinking', emoji: '🤔', label: '想一想' })
])

const POKER_STICKER_BY_ID = Object.freeze(POKER_STICKERS.reduce((result, sticker) => {
  result[sticker.id] = sticker
  return result
}, Object.create(null)))

module.exports = { POKER_STICKER_IDS, POKER_STICKERS, POKER_STICKER_BY_ID }
