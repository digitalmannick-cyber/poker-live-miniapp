const REVIEW_TAG_OPTIONS = [
  { key: 'great', label: '精彩', aliases: ['精彩', '好牌', '打得好', 'good', 'great', 'nice_hand'] },
  { key: 'optimize', label: '可优化', aliases: ['可优化', '建议优化', '优化', '问题', 'issue', 'issues', 'optimization', 'optimizations', 'passive_flop_play', 'contradictory_hand_reading'] },
  { key: 'mistake', label: '明显错误', aliases: ['明显错误', '错误', '重大错误', 'clear_mistake', 'clear_mistakes', 'mistake', 'error', 'bad_play'] },
  { key: 'hero_call', label: 'Hero Call', aliases: ['Hero Call', 'hero_call', 'herocall', 'call_down', 'calldown', '抓诈', '抓鸡', 'bluff_catch', 'bluffcatch'] },
  { key: 'overfold', label: 'Overfold', aliases: ['Overfold', 'overfold', 'river_overfold', '过度弃牌', '弃太多', 'fold太多'] },
  { key: 'bad_fold', label: 'Bad Fold', aliases: ['Bad Fold', 'badfold', 'bad_fold', '错误弃牌', '弃错', 'fold错'] },
  { key: 'value_bet', label: '价值下注', aliases: ['价值下注', '薄价值', 'value', 'value_bet', 'thin_value', 'value_check_behind'] },
  { key: 'bluff', label: '诈唬', aliases: ['诈唬', '偷鸡', 'bluff', 'semi_bluff', '虚张'] },
  { key: 'multiway', label: '多人池', aliases: ['多人池', '多人底池', '三人池', '四人池', 'multiway', 'multi_way'] },
  { key: 'deep_stack', label: '深筹码', aliases: ['深筹码', 'deep_stack', 'deep_stack_misunderstanding', 'deepstack', '200bb+', '深筹'] },
  { key: 'three_bet_pot', label: '3Bet池', aliases: ['3Bet池', '3bet', '3bet_pot', 'preflop_3bet_pot', '三bet池', '三逼池'] },
  { key: 'four_bet_pot', label: '4Bet池', aliases: ['4Bet池', '4bet', '4bet_pot', 'preflop_4bet_pot', '四bet池', '四逼池'] }
]

const TAG_ALIAS_MAP = REVIEW_TAG_OPTIONS.reduce((map, option) => {
  option.aliases.concat([option.key, option.label]).forEach(alias => {
    map[normalizeTagKey(alias)] = option.label
  })
  return map
}, {})

function normalizeTagKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
}

function normalizeOneTag(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  return TAG_ALIAS_MAP[normalizeTagKey(raw)] || ''
}

function normalizeReviewTags(list) {
  const source = Array.isArray(list) ? list : String(list || '').split(/[,，、\s]+/)
  const seen = {}
  return source
    .map(normalizeOneTag)
    .filter(Boolean)
    .filter(tag => {
      if (seen[tag]) return false
      seen[tag] = true
      return true
    })
}

function getReviewTagOptions(activeKey) {
  const current = String(activeKey || 'all')
  return [{ key: 'all', label: '全部标签', active: current === 'all' }]
    .concat(REVIEW_TAG_OPTIONS.map(option => ({
      key: option.key,
      label: option.label,
      active: current === option.key
    })))
}

function getTagKeyByLabel(label) {
  const normalized = normalizeOneTag(label)
  const found = REVIEW_TAG_OPTIONS.find(option => option.label === normalized)
  return found ? found.key : ''
}

function matchesTagFilter(tags, tagKey) {
  const key = String(tagKey || 'all')
  if (!key || key === 'all') return true
  const option = REVIEW_TAG_OPTIONS.find(item => item.key === key)
  if (!option) return true
  return normalizeReviewTags(tags).indexOf(option.label) > -1
}

module.exports = {
  REVIEW_TAG_OPTIONS,
  normalizeReviewTags,
  getReviewTagOptions,
  getTagKeyByLabel,
  matchesTagFilter
}
