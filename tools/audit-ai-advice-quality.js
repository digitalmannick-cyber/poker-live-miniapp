const childProcess = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const CLOUDBASE_CLI = process.env.CLOUDBASE_CLI || 'C:/Users/11075/AppData/Roaming/npm/node_modules/@cloudbase/cli/bin/cloudbase'
const ENV_ID = process.env.CLOUDBASE_ENV_ID || 'cloud1-d3ggy9aq3be912e34'
const OWNER_OPEN_ID = process.env.OWNER_OPEN_ID || 'oiEdl3QbetACPAPCpa8-SSupmBWI'
const OUT_DIR = path.join(ROOT, 'logs', 'ai-advice-audit')

const STREETS = ['preflop', 'flop', 'turn', 'river']

function normalizeCloudValue(value) {
  if (Array.isArray(value)) return value.map(normalizeCloudValue)
  if (!value || typeof value !== 'object') return value
  if (Object.prototype.hasOwnProperty.call(value, '$numberLong')) return Number(value.$numberLong)
  if (Object.prototype.hasOwnProperty.call(value, '$numberInt')) return Number(value.$numberInt)
  if (Object.prototype.hasOwnProperty.call(value, '$numberDouble')) return Number(value.$numberDouble)
  if (Object.prototype.hasOwnProperty.call(value, '$date')) return value.$date
  const next = {}
  Object.keys(value).forEach(key => {
    next[key] = normalizeCloudValue(value[key])
  })
  return next
}

function runCloudbase(commands) {
  const result = childProcess.spawnSync(
    process.execPath,
    [
      CLOUDBASE_CLI,
      'db',
      'nosql',
      'execute',
      '--env-id',
      ENV_ID,
      '--command',
      JSON.stringify(commands),
      '--json'
    ],
    {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 120000,
      maxBuffer: 100 * 1024 * 1024
    }
  )
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'cloudbase command failed')
  const jsonStart = result.stdout.indexOf('{')
  if (jsonStart < 0) throw new Error('cloudbase did not return json: ' + result.stdout)
  return JSON.parse(result.stdout.slice(jsonStart))
}

function fetchAll(collectionName, filter) {
  const rows = []
  let skip = 0
  while (true) {
    const result = runCloudbase([{
      TableName: collectionName,
      CommandType: 'COMMAND',
      Command: JSON.stringify({
        find: collectionName,
        filter: filter || {},
        skip,
        limit: 100
      })
    }])
    const page = normalizeCloudValue(result.data && result.data.results && result.data.results[0] || [])
    rows.push(...page)
    if (page.length < 100) break
    skip += page.length
  }
  return rows
}

function asText(value) {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}

function reviewText(hand) {
  return asText(hand && hand.aiReview || '')
}

function streetInput(hand, street) {
  const inputs = hand && hand.streetInputs || {}
  return inputs[street] || inputs[street[0].toUpperCase() + street.slice(1)] || {}
}

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function extractHeroBetAmounts(line) {
  const text = String(line || '')
  const results = []
  const patterns = [
    /(?:Hero(?:\s+[A-Z0-9+]+)?|我)\s*(?:bet|下注|B)\s*(\d+)/ig,
    /(?:Hero(?:\s+[A-Z0-9+]+)?|我)\s*(?:all[\s-]*in|AI|推)\s*(\d+)/ig
  ]
  patterns.forEach(pattern => {
    let match
    while ((match = pattern.exec(text))) {
      results.push(Number(match[1]) || 0)
    }
  })
  return results.filter(Boolean)
}

function previousPot(hand, street) {
  const index = STREETS.indexOf(street)
  if (index < 0) return 0
  for (let i = index - 1; i >= 0; i -= 1) {
    const pot = number(streetInput(hand, STREETS[i]).pot)
    if (pot > 0) return pot
  }
  return street === 'preflop' ? 0 : number(streetInput(hand, street).pot)
}

function heroBetRatios(hand) {
  return STREETS.flatMap(street => {
    const input = streetInput(hand, street)
    const line = input.actionLine || ''
    const pot = previousPot(hand, street)
    return extractHeroBetAmounts(line).map(amount => ({
      street,
      amount,
      estimatedPotBefore: pot,
      ratio: pot > 0 ? Math.round(amount / pot * 100) / 100 : null
    }))
  })
}

function boardText(hand) {
  const board = hand && hand.board || {}
  return [board.flop, board.turn, board.river].filter(Boolean).join(' / ')
}

function handLine(hand) {
  return STREETS.map(street => {
    const input = streetInput(hand, street)
    const board = input.board || (hand.board && hand.board[street]) || ''
    const pot = input.pot ? ` pot=${input.pot}` : ''
    const line = input.actionLine || ''
    return line ? `${street}${board ? ` ${board}` : ''}${pot}: ${line}` : ''
  }).filter(Boolean).join(' | ')
}

function hasWetBoard(hand) {
  const board = hand && hand.board || {}
  const text = [board.flop, board.turn, board.river].filter(Boolean).join('')
  const suits = {}
  Array.from(text.matchAll(/[AKQJT2-9]([shdc])/ig)).forEach(match => {
    suits[match[1].toLowerCase()] = (suits[match[1].toLowerCase()] || 0) + 1
  })
  const ranks = Array.from(text.toUpperCase().replace(/10/g, 'T').matchAll(/[AKQJT2-9]/g)).map(match => '23456789TJQKA'.indexOf(match[0]))
    .filter(index => index >= 0)
    .sort((a, b) => a - b)
  const flushDraw = Object.values(suits).some(count => count >= 2)
  let straightConnected = false
  for (let i = 0; i < ranks.length; i += 1) {
    for (let j = i + 1; j < ranks.length; j += 1) {
      if (Math.abs(ranks[j] - ranks[i]) <= 4) straightConnected = true
    }
  }
  return flushDraw || straightConnected
}

function qualitySignals(hand, session) {
  const text = reviewText(hand)
  const lower = text.toLowerCase()
  const signals = []
  const ratios = heroBetRatios(hand)
  const maxRatio = ratios.reduce((max, item) => Math.max(max, item.ratio || 0), 0)
  if (/超池|over\s*pot|overbet/i.test(text) && maxRatio > 0 && maxRatio < 1.05) {
    signals.push({
      severity: 'high',
      type: 'possible_false_overpot_claim',
      note: `AI mentions overpot but largest detected Hero bet ratio is ${maxRatio}x pot.`,
      evidence: ratios
    })
  }
  if (/没有.{0,8}价值|无.{0,8}价值|no.{0,8}value/i.test(text) && /三条|set|trips|葫芦|full house/i.test(text) && hasWetBoard(hand)) {
    signals.push({
      severity: 'high',
      type: 'possible_value_range_underestimate',
      note: 'AI says little/no value while the review itself mentions trips/set/full house on a wet board.'
    })
  }
  if (/结合.{0,8}范围.{0,8}SPR|范围、SPR、位置|range.*spr.*position/i.test(text)) {
    signals.push({
      severity: 'medium',
      type: 'generic_template_language',
      note: 'Contains generic template language that often indicates a low-actionable review.'
    })
  }
  if (!/preflop|flop|turn|river|翻前|翻牌|转牌|河牌/i.test(text)) {
    signals.push({
      severity: 'medium',
      type: 'missing_street_specific_review',
      note: 'Review text does not appear to contain street-specific analysis.'
    })
  }
  if (/JSONDecodeError|factual_conflict|EV脑出问题|llm_coach_review/i.test(String(hand.aiReviewError || ''))) {
    signals.push({
      severity: 'high',
      type: 'generation_error',
      note: String(hand.aiReviewError || '').slice(0, 400)
    })
  }
  if (lower.includes('fallback') || /复查本手的关键街道|判断这条线是否赚钱|选择最优线/.test(text)) {
    signals.push({
      severity: 'medium',
      type: 'fallback_or_placeholder_advice',
      note: 'Looks like fallback or placeholder advice.'
    })
  }
  const gtoSpotScore = [
    /3bet|3B|4bet|4B|squeeze|SQZ/i.test(handLine(hand)) ? 2 : 0,
    /turn|river|转牌|河牌/i.test(handLine(hand)) ? 1 : 0,
    hasWetBoard(hand) ? 1 : 0,
    ratios.some(item => item.ratio && item.ratio >= 0.55) ? 1 : 0,
    signals.some(item => item.severity === 'high') ? 3 : 0,
    signals.some(item => item.type === 'generic_template_language') ? 1 : 0
  ].reduce((sum, value) => sum + value, 0)
  return {
    handId: hand._id,
    sessionId: hand.sessionId,
    sessionTitle: session && session.title || '',
    date: hand.playedDate || session && session.date || '',
    hero: `${hand.heroPosition || ''} ${hand.heroCardsInput || ''}`.trim(),
    villain: `${hand.villainPosition || ''} ${hand.opponentType || hand.villainType || ''}`.trim(),
    stake: hand.stakeLevel || session && session.stakeLevel || '',
    board: boardText(hand),
    line: handLine(hand),
    profit: number(hand.currentProfit),
    aiReviewStatus: hand.aiReviewStatus || '',
    hasAiReview: !!hand.aiReview,
    signals,
    detectedHeroBetRatios: ratios,
    gtoCandidateScore: gtoSpotScore,
    aiReviewExcerpt: text.slice(0, 700)
  }
}

function csvEscape(value) {
  const text = String(value === undefined || value === null ? '' : value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function writeOutputs(auditRows, rawData) {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const jsonPath = path.join(OUT_DIR, `ai-advice-quality-${stamp}.json`)
  const mdPath = path.join(OUT_DIR, `ai-advice-gto-candidates-${stamp}.md`)
  const csvPath = path.join(OUT_DIR, `ai-advice-gto-candidates-${stamp}.csv`)
  const rawPath = path.join(OUT_DIR, `cloud-hands-export-${stamp}.json`)
  const reviewed = auditRows.filter(item => item.hasAiReview)
  const candidateRows = reviewed
    .slice()
    .sort((a, b) => b.gtoCandidateScore - a.gtoCandidateScore || b.signals.length - a.signals.length)
    .slice(0, 30)
  const summary = {
    generatedAt: new Date().toISOString(),
    ownerOpenId: OWNER_OPEN_ID,
    totalHands: rawData.hands.length,
    totalSessions: rawData.sessions.length,
    totalActions: rawData.actions.length,
    reviewedHands: reviewed.length,
    statusCounts: rawData.hands.reduce((map, hand) => {
      const key = String(hand.aiReviewStatus || 'empty')
      map[key] = (map[key] || 0) + 1
      return map
    }, {}),
    signalCounts: reviewed.reduce((map, row) => {
      row.signals.forEach(signal => {
        map[signal.type] = (map[signal.type] || 0) + 1
      })
      return map
    }, {}),
    highRiskReviewedHands: reviewed.filter(row => row.signals.some(signal => signal.severity === 'high')).length,
    genericReviewedHands: reviewed.filter(row => row.signals.some(signal => signal.type === 'generic_template_language')).length,
    gtoCandidateCount: candidateRows.length
  }
  const payload = { summary, rows: auditRows }
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8')
  fs.writeFileSync(rawPath, JSON.stringify(rawData, null, 2), 'utf8')
  const lines = [
    '# AI 建议质量审计与 GTO Wizard 候选清单',
    '',
    `- 生成时间：${summary.generatedAt}`,
    `- 云端手牌：${summary.totalHands}`,
    `- 已有 AI 建议：${summary.reviewedHands}`,
    `- 高风险建议：${summary.highRiskReviewedHands}`,
    `- 泛化模板信号：${summary.genericReviewedHands}`,
    `- 状态分布：${JSON.stringify(summary.statusCounts)}`,
    '',
    '## 优先拿去 GTO Wizard 跑的候选',
    '',
    '| # | 分数 | Hand ID | 日期 | Hero | 牌面 | 信号 | 行动线 |',
    '|---:|---:|---|---|---|---|---|---|'
  ]
  candidateRows.forEach((row, index) => {
    lines.push([
      index + 1,
      row.gtoCandidateScore,
      row.handId,
      row.date,
      row.hero,
      row.board,
      row.signals.map(signal => signal.type).join('<br>') || '-',
      row.line
    ].map(value => String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')).join(' | ').replace(/^/, '| ').replace(/$/, ' |'))
  })
  lines.push('', '## 使用方式', '')
  lines.push('先从前 10-15 手开始，在 GTO Wizard 手动录入或用 Analyze/AI Solver 跑关键决策点。把结果截图或文字贴回后，可按 handId 写入人工/GTO 标注，再做一致率统计。')
  fs.writeFileSync(mdPath, lines.join('\n'), 'utf8')
  const csvFields = ['rank', 'score', 'handId', 'date', 'stake', 'hero', 'villain', 'board', 'profit', 'signals', 'line', 'aiReviewExcerpt']
  const csvLines = [csvFields.join(',')]
  candidateRows.forEach((row, index) => {
    csvLines.push([
      index + 1,
      row.gtoCandidateScore,
      row.handId,
      row.date,
      row.stake,
      row.hero,
      row.villain,
      row.board,
      row.profit,
      row.signals.map(signal => signal.type).join(';'),
      row.line,
      row.aiReviewExcerpt
    ].map(csvEscape).join(','))
  })
  fs.writeFileSync(csvPath, csvLines.join('\n'), 'utf8')
  return { summary, jsonPath, mdPath, csvPath, rawPath }
}

function main() {
  const sessions = fetchAll('sessions', { ownerOpenId: OWNER_OPEN_ID })
  const hands = fetchAll('hands', { ownerOpenId: OWNER_OPEN_ID })
  const actions = fetchAll('hand_actions', { ownerOpenId: OWNER_OPEN_ID })
  const sessionById = new Map(sessions.map(session => [session._id, session]))
  const actionByHandId = actions.reduce((map, action) => {
    const key = String(action.handId || '')
    if (!key) return map
    if (!map[key]) map[key] = []
    map[key].push(action)
    return map
  }, {})
  const enrichedHands = hands.map(hand => Object.assign({}, hand, {
    actions: (actionByHandId[hand._id] || []).sort((a, b) => number(a.sequence) - number(b.sequence))
  }))
  const rows = enrichedHands.map(hand => qualitySignals(hand, sessionById.get(hand.sessionId)))
  const outputs = writeOutputs(rows, { sessions, hands: enrichedHands, actions })
  console.log(JSON.stringify(outputs, null, 2))
}

if (require.main === module) {
  main()
}
