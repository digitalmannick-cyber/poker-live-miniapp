const childProcess = require('child_process')
const fs = require('fs')
const path = require('path')

const statsAnalytics = require('../utils/stats-analytics')

const ROOT = path.resolve(__dirname, '..')
const CLOUDBASE_CLI = 'C:/Users/11075/AppData/Roaming/npm/node_modules/@cloudbase/cli/bin/cloudbase'
const ENV_ID = 'cloud1-d3ggy9aq3be912e34'
const DEFAULT_OWNER_OPEN_ID = 'oiEdl3QbetACPAPCpa8-SSupmBWI'

function parseArgs(argv) {
  const args = {}
  for (let index = 2; index < argv.length; index += 1) {
    const item = argv[index]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const value = argv[index + 1] && !argv[index + 1].startsWith('--')
      ? argv[++index]
      : true
    args[key] = value
  }
  return args
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
      maxBuffer: 80 * 1024 * 1024
    }
  )
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'cloudbase command failed')
  }
  const jsonStart = result.stdout.indexOf('{')
  if (jsonStart < 0) throw new Error('cloudbase did not return json: ' + result.stdout)
  return JSON.parse(result.stdout.slice(jsonStart))
}

function normalizeCloudValue(value) {
  if (Array.isArray(value)) return value.map(normalizeCloudValue)
  if (!value || typeof value !== 'object') return value
  if (Object.prototype.hasOwnProperty.call(value, '$numberDouble')) return Number(value.$numberDouble)
  if (Object.prototype.hasOwnProperty.call(value, '$numberInt')) return Number(value.$numberInt)
  if (Object.prototype.hasOwnProperty.call(value, '$numberLong')) return Number(value.$numberLong)
  if (Object.prototype.hasOwnProperty.call(value, '$date')) return value.$date
  const next = {}
  Object.keys(value).forEach(key => {
    next[key] = normalizeCloudValue(value[key])
  })
  return next
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8')
}

function fetchHands(ownerOpenId) {
  const hands = []
  const filter = ownerOpenId ? { ownerOpenId } : {}
  let skip = 0
  while (true) {
    const result = runCloudbase([{
      TableName: 'hands',
      CommandType: 'COMMAND',
      Command: JSON.stringify({
        find: 'hands',
        filter,
        skip,
        limit: 100
      })
    }])
    const page = normalizeCloudValue(result.data && result.data.results && result.data.results[0] || [])
    hands.push(...page)
    if (page.length < 100) break
    skip += page.length
  }
  return hands
}

function hasValue(value) {
  return value !== undefined && value !== null && value !== ''
}

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function roundMoney(value) {
  return Math.round(number(value) * 100) / 100
}

function collectText(hand) {
  const parts = []
  ;[
    hand.streetSummary,
    hand.actionLine,
    hand.notes,
    hand.mindJourney,
    hand.reviewText,
    hand.voiceText,
    hand.showdown,
    hand.opponentCards
  ].forEach(value => {
    if (value) parts.push(typeof value === 'string' ? value : JSON.stringify(value))
  })
  const streetInputs = hand.streetInputs || {}
  Object.keys(streetInputs).forEach(key => {
    const value = streetInputs[key]
    if (!value) return
    parts.push(typeof value === 'string' ? value : JSON.stringify(value))
  })
  return parts.join(' ')
}

function hasAllIn(hand) {
  const text = collectText(hand)
  return hand.isAllIn === true ||
    hand.allInEvEligible === true ||
    /(all\s*-?\s*in|allin|\bAI\b|全下|推全|打光|梭哈)/i.test(text)
}

function hasVerifiedOpponentCards(hand) {
  if (hand.opponentCardsVerified === true || hand.villainCardsVerified === true || hand.showdownVerified === true) return true
  const source = String(hand.villainCardsSource || hand.opponentCardsSource || '').trim().toLowerCase()
  if (/^(shown|showdown|showed|verified)$/.test(source)) return true
  return [
    hand.villainCardsInput,
    hand.opponentCards,
    hand.showdown
  ].some(value => {
    const text = String(value || '').trim()
    if (!text) return false
    if (/(muck|fold|弃牌|棄牌|未亮|未show|没亮|沒有亮|没有亮|推断|推測|推测|大概率|可能|疑似)/i.test(text)) return false
    if (/(?:[akqjt2-9][shdc♠♥♦♣]\s*){2}/i.test(text)) return true
    if (/\b(?:aa|kk|qq|jj|tt|99|88|77|66|55|44|33|22|ak|aq|aj|at|kq|kj|kt|qj|qt|jt)[os]?\b/i.test(text)) {
      return /(show|亮|秀|摊牌|攤牌|开牌|開牌)/i.test(text)
    }
    return false
  })
}

function handAllInStreet(hand) {
  const text = String(hand.allInStreet || hand.allInRound || hand.allInStage || hand.allInEvStreet || '').trim().toLowerCase()
  if (/^(river|河牌)$/.test(text)) return 'river'
  if (/^(turn|转牌|轉牌)$/.test(text)) return 'turn'
  if (/^(flop|翻牌)$/.test(text)) return 'flop'
  if (/^(preflop|pre-flop|pf|翻前|翻牌前)$/.test(text)) return 'preflop'
  const inferred = inferAllInStreetFromText(collectText(hand))
  if (inferred) return inferred
  return text
}

function inferAllInStreetFromText(text) {
  const source = String(text || '')
  const allInIndex = source.search(/(all\s*-?\s*in|allin|\bAI\b|全下|推全|打光|梭哈)/i)
  if (allInIndex < 0) return ''
  const before = source.slice(0, allInIndex + 80)
  const hits = []
  ;[
    ['river', /(river|河牌|河底)/ig],
    ['turn', /(turn|转牌|轉牌)/ig],
    ['flop', /(flop|翻牌)/ig],
    ['preflop', /(preflop|pre-flop|翻前|翻牌前)/ig]
  ].forEach(pair => {
    const street = pair[0]
    const re = pair[1]
    let match
    while ((match = re.exec(before))) {
      hits.push({ street, index: match.index })
    }
  })
  if (!hits.length) return ''
  return hits.sort((a, b) => b.index - a.index)[0].street
}

function classifyShowdownReason(hand, classification) {
  const text = collectText(hand).toLowerCase()
  if (classification === 'showdown') {
    if (/(muck|盖牌|埋牌)/i.test(text)) return 'called_and_mucked'
    if (/(river|河牌|河底)[^/。；;]*(call|called|跟注|跟了|接了|平跟|\bc\b)/i.test(text)) return 'river_called'
    if (/(all\s*-?\s*in|allin|\bai\b|全下|推全|打光|梭哈)[^/。；;]*(call|called|跟注|跟了|接了|平跟|\bc\b)/i.test(text)) return 'all_in_called'
    return 'showdown'
  }
  if (classification === 'non_showdown') {
    if (/(fold|folded|弃牌|棄牌|弃了|棄了|弃掉|棄掉|扔牌)/i.test(text)) return 'folded_to_hero_aggression'
    return 'no_showdown'
  }
  return ''
}

function hasExplicitTrustedEv(hand) {
  if (!hasValue(hand.allInEv)) return false
  return Boolean(hand.allInEvStatus === 'calculated' || hand.allInEvSource || hand.allInEvFormula || hand.allInEvUpdatedAt)
}

function buildHandPatch(hand) {
  const patch = {}
  const classification = statsAnalytics.__test.showdownClassification(hand)
  if (classification !== 'unknown') {
    const reason = classifyShowdownReason(hand, classification)
    if (hand.showdownType !== classification) patch.showdownType = classification
    if ((hand.showdownReason || '') !== reason) patch.showdownReason = reason
  }

  const allIn = hasAllIn(hand)
  const verifiedOpponent = hasVerifiedOpponentCards(hand)
  const street = handAllInStreet(hand)
  const canCalculateEv = allIn && verifiedOpponent && street !== 'river'
  const canUseExistingTrustedEv = canCalculateEv && hasExplicitTrustedEv(hand)
  const currentProfit = roundMoney(hand.currentProfit)

  if (!allIn) {
    ;['allInEv', 'allInEvStatus', 'allInEvSource', 'allInEvFormula', 'allInEvLuckDelta'].forEach(key => {
      if (hasValue(hand[key])) patch[key] = ''
    })
    if (hand.allInEvEligible !== false) patch.allInEvEligible = false
  } else if (!verifiedOpponent) {
    if (hasValue(hand.allInEv)) patch.allInEv = ''
    if ((hand.allInEvStatus || '') !== 'unknown_opponent_cards') patch.allInEvStatus = 'unknown_opponent_cards'
    if (hasValue(hand.allInEvSource)) patch.allInEvSource = ''
    if (hasValue(hand.allInEvFormula)) patch.allInEvFormula = ''
    if (hasValue(hand.allInEvLuckDelta)) patch.allInEvLuckDelta = ''
    if (hand.allInEvEligible !== false) patch.allInEvEligible = false
  } else if (street === 'river') {
    if (hand.allInEv !== currentProfit) patch.allInEv = currentProfit
    if ((hand.allInEvStatus || '') !== 'river_actual') patch.allInEvStatus = 'river_actual'
    if ((hand.allInEvSource || '') !== 'macau_showdown_rules') patch.allInEvSource = 'macau_showdown_rules'
    if (hasValue(hand.allInEvFormula)) patch.allInEvFormula = ''
    if (hasValue(hand.allInEvLuckDelta) && number(hand.allInEvLuckDelta) !== 0) patch.allInEvLuckDelta = 0
    if (hand.allInEvEligible !== false) patch.allInEvEligible = false
  } else if (!canUseExistingTrustedEv) {
    const calculated = statsAnalytics.__test.allInEvProfit(Object.assign({}, hand, {
      isAllIn: true,
      allInEvEligible: true
    }))
    if (calculated !== currentProfit) {
      if (hand.allInEv !== calculated) patch.allInEv = calculated
      if ((hand.allInEvStatus || '') !== 'calculated') patch.allInEvStatus = 'calculated'
      if ((hand.allInEvSource || '') !== 'macau_showdown_rules') patch.allInEvSource = 'macau_showdown_rules'
      if ((hand.allInEvFormula || '') !== 'allInPot * heroEquityPct / 100 - heroInvested') patch.allInEvFormula = 'allInPot * heroEquityPct / 100 - heroInvested'
      const delta = roundMoney(currentProfit - calculated)
      if (number(hand.allInEvLuckDelta) !== delta) patch.allInEvLuckDelta = delta
      if (hand.allInEvEligible !== true) patch.allInEvEligible = true
    } else if ((hand.allInEvStatus || '') !== 'needs_verified_equity') {
      patch.allInEvStatus = 'needs_verified_equity'
      if (hasValue(hand.allInEv)) patch.allInEv = ''
      if (hasValue(hand.allInEvSource)) patch.allInEvSource = ''
      if (hasValue(hand.allInEvFormula)) patch.allInEvFormula = ''
      if (hasValue(hand.allInEvLuckDelta)) patch.allInEvLuckDelta = ''
    }
  }

  return patch
}

function buildUpdateCommands(items) {
  return [{
    TableName: 'hands',
    CommandType: 'UPDATE',
    Command: JSON.stringify({
      update: 'hands',
      updates: items.map(item => {
        return {
          q: { _id: item._id },
          u: { $set: item.patch },
          upsert: false
        }
      })
    })
  }]
}

function chunk(list, size) {
  const chunks = []
  for (let index = 0; index < list.length; index += size) {
    chunks.push(list.slice(index, index + size))
  }
  return chunks
}

function summarize(changes) {
  return changes.reduce((summary, item) => {
    summary.changedHands += 1
    Object.keys(item.patch).forEach(key => {
      summary.changedFields[key] = (summary.changedFields[key] || 0) + 1
      if (key === 'showdownType') {
        summary.showdownType[item.patch[key]] = (summary.showdownType[item.patch[key]] || 0) + 1
      }
      if (key === 'allInEvStatus') {
        summary.allInEvStatus[item.patch[key]] = (summary.allInEvStatus[item.patch[key]] || 0) + 1
      }
    })
    return summary
  }, {
    changedHands: 0,
    changedFields: {},
    showdownType: {},
    allInEvStatus: {}
  })
}

function main() {
  const args = parseArgs(process.argv)
  const mode = args.mode || 'preview'
  const ownerOpenId = args.ownerOpenId || DEFAULT_OWNER_OPEN_ID
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outDir = args.outDir || path.join(ROOT, 'logs', 'macau-stats-rules-' + stamp)

  const hands = fetchHands(ownerOpenId)
  const changes = hands.map(hand => {
    const patch = buildHandPatch(hand)
    return Object.keys(patch).length ? {
      _id: hand._id,
      playedDate: hand.playedDate || hand.createdAt || hand.updatedAt || '',
      currentProfit: hand.currentProfit,
      old: {
        showdownType: hand.showdownType || '',
        showdownReason: hand.showdownReason || '',
        allInEv: hasValue(hand.allInEv) ? hand.allInEv : '',
        allInEvStatus: hand.allInEvStatus || '',
        allInEvSource: hand.allInEvSource || '',
        allInEvEligible: hand.allInEvEligible === true
      },
      patch
    } : null
  }).filter(Boolean)

  const report = {
    mode,
    ownerOpenId,
    totalHands: hands.length,
    summary: summarize(changes),
    changes
  }

  writeJson(path.join(outDir, 'cloud-hands-backup.json'), hands)
  writeJson(path.join(outDir, 'macau-stats-rules-changes.json'), report)

  if (mode === 'apply') {
    let written = 0
    chunk(changes, 20).forEach(batch => {
      runCloudbase(buildUpdateCommands(batch))
      written += batch.length
      console.log(JSON.stringify({ written, total: changes.length }))
    })
    report.applied = true
    report.appliedAt = new Date().toISOString()
    writeJson(path.join(outDir, 'macau-stats-rules-applied.json'), report)
  } else if (mode !== 'preview') {
    throw new Error('unsupported --mode: ' + mode)
  }

  console.log(JSON.stringify({
    mode,
    ownerOpenId,
    outDir,
    totalHands: hands.length,
    summary: report.summary,
    applied: mode === 'apply'
  }, null, 2))
}

if (require.main === module) {
  main()
}

module.exports = {
  buildHandPatch,
  hasVerifiedOpponentCards
}
