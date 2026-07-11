const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const BASE_TOKEN = 'Cm47bUX6JafbJbs3k4ecU80Ln9s'
const TABLE_ID = 'tblk4qC1I8IjLhfI'
const PAGE_SIZE = 200
const HISTORY_TOTAL_HOURS = 360

const FIELDS = {
  date: 'fldOb1Nprp',
  hand: 'fldfHvZ4ZW',
  level: 'flduhlEowm',
  result: 'fld3DaUbby',
  resultBb: 'fldNoEyIhb',
  heroPosition: 'fldtS3CwoB',
  actionLine: 'fldVrV6N7z',
  preflopAction: 'fldL2P6KRV',
  flopAction: 'fldGCUobfO',
  turnAction: 'fldvEyggPk',
  riverAction: 'flde53I9dC',
  flopBoard: 'fldtXrsjSI',
  turnBoard: 'fldinPgpsU',
  riverBoard: 'fldSl2mrM9',
  mindJourney: 'fldjpbEoWo',
  tags: 'fldRgpHZKk',
  opponentType: 'flduHFv2oH',
  importIssue: 'fldAmPiEkt'
}

const FIELD_ORDER = Object.keys(FIELDS)
const FIELD_IDS = FIELD_ORDER.map(key => FIELDS[key])
const FIELD_INDEX = FIELD_ORDER.reduce((map, key, index) => {
  map[key] = index
  return map
}, {})

function runLark(args) {
  const binary = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'lark-cli'
  const finalArgs = process.platform === 'win32'
    ? ['/d', '/s', '/c', ['lark-cli'].concat(args).join(' ')]
    : args
  const result = spawnSync(binary, finalArgs, {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    windowsHide: true
  })
  if (result.status !== 0) {
    throw new Error(result.error && result.error.message || result.stderr || result.stdout || 'lark-cli failed')
  }
  return JSON.parse(result.stdout)
}

function getCell(row, key) {
  return row[FIELD_INDEX[key]]
}

function scalar(value) {
  if (value == null) return ''
  if (Array.isArray(value)) return value.map(item => String(item == null ? '' : item)).filter(Boolean).join(',')
  return String(value)
}

function listValue(value) {
  if (value == null) return []
  if (Array.isArray(value)) return value.map(item => String(item == null ? '' : item).trim()).filter(Boolean)
  const text = String(value).trim()
  return text ? [text] : []
}

function normalizeDate(value) {
  const text = scalar(value).trim()
  const match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (!match) return ''
  return [
    match[1],
    match[2].padStart(2, '0'),
    match[3].padStart(2, '0')
  ].join('-')
}

function normalizeCardText(value) {
  return scalar(value)
    .replace(/10/g, 'T')
    .replace(/[♠♤]/g, 's')
    .replace(/[♥♡]/g, 'h')
    .replace(/[♦♢]/g, 'd')
    .replace(/[♣♧]/g, 'c')
    .replace(/[（）]/g, match => (match === '（' ? '(' : ')'))
    .trim()
}

function normalizeHeroCards(value) {
  const text = normalizeCardText(value)
  const exact = text.match(/([2-9TJQKA][shdc]).*?([2-9TJQKA][shdc])/i)
  if (exact) {
    return exact[1].charAt(0).toUpperCase() + exact[1].charAt(1).toLowerCase() +
      exact[2].charAt(0).toUpperCase() + exact[2].charAt(1).toLowerCase()
  }
  const shorthand = text.toUpperCase().match(/^([2-9TJQKA]{2}[SO]?)\b/)
  return shorthand ? shorthand[1] : text
}

function normalizeBoard(value) {
  const text = normalizeCardText(value)
  const cards = text.match(/[2-9TJQKA][shdc]/ig) || []
  return cards.map(card => card.charAt(0).toUpperCase() + card.charAt(1).toLowerCase()).join('')
}

function parseBlind(level) {
  const numbers = scalar(level).match(/\d+(?:\.\d+)?/g) || []
  if (numbers.length < 2) return { smallBlind: 0, bigBlind: 0 }
  return {
    smallBlind: Number(numbers[0]) || 0,
    bigBlind: Number(numbers[1]) || 0
  }
}

function normalizePosition(value) {
  const text = scalar(value).trim()
  const valid = new Set(['UTG', 'UTG+1', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB', 'STR'])
  return valid.has(text) ? text : ''
}

function buildStreetInputs(record) {
  return {
    preflop: { pot: '', actionLine: scalar(getCell(record.row, 'preflopAction')) },
    flop: { pot: '', actionLine: scalar(getCell(record.row, 'flopAction')) },
    turn: { pot: '', actionLine: scalar(getCell(record.row, 'turnAction')) },
    river: { pot: '', actionLine: scalar(getCell(record.row, 'riverAction')) }
  }
}

function inferShowdownInfo(record) {
  const text = [
    scalar(getCell(record.row, 'actionLine')),
    scalar(getCell(record.row, 'preflopAction')),
    scalar(getCell(record.row, 'flopAction')),
    scalar(getCell(record.row, 'turnAction')),
    scalar(getCell(record.row, 'riverAction')),
    scalar(getCell(record.row, 'mindJourney'))
  ].join(' ').toLowerCase()
  const hasShow = /(showdown|show\s|shows|showed|show牌|亮牌|秀牌|摊牌|攤牌|开牌|開牌)/i.test(text)
  const hasCallOrCheckdown = /(call|called|跟注|跟了|接了|平跟|check\s*check|check-check|过牌\s*过牌|过过|check到|一路check|check\s*back)/i.test(text)
  const hasMuck = /(muck|盖牌|埋牌)/i.test(text)
  const hasFold = /(fold|folded|弃牌|棄牌|弃了|棄了|弃掉|棄掉|扔牌)/i.test(text)

  if (/showdown|摊牌|攤牌/i.test(text) || hasShow && (hasCallOrCheckdown || hasMuck) || hasMuck && hasCallOrCheckdown) {
    return { showdownType: 'showdown', showdownReason: hasMuck ? 'called_and_mucked' : 'text_showdown' }
  }
  if (hasFold || hasMuck) {
    return { showdownType: 'non_showdown', showdownReason: 'folded_to_bet' }
  }
  return { showdownType: '', showdownReason: '' }
}

function stableId(prefix, value) {
  return prefix + '_' + String(value || '').replace(/[^0-9A-Za-z_-]/g, '_')
}

function fetchRecords() {
  const records = []
  let offset = 0
  while (true) {
    const args = [
      'base', '+record-list',
      '--base-token', BASE_TOKEN,
      '--table-id', TABLE_ID,
      '--limit', String(PAGE_SIZE),
      '--offset', String(offset),
      '--as', 'user',
      '--jq', '.'
    ]
    FIELD_IDS.forEach(fieldId => {
      args.push('--field-id', fieldId)
    })
    const result = runLark(args)
    const data = result.data || {}
    const rows = data.data || []
    const ids = data.record_id_list || []
    rows.forEach((row, index) => {
      records.push({ id: ids[index], row })
    })
    if (!data.has_more) break
    offset += PAGE_SIZE
  }
  return records
}

function buildImportPreview(records) {
  const nowMs = Date.now()
  const sessionMap = {}
  const hands = []
  const handActions = []
  const warnings = []

  records.forEach((record, index) => {
    const date = normalizeDate(getCell(record.row, 'date'))
    const level = scalar(getCell(record.row, 'level')).trim()
    const profit = Number(getCell(record.row, 'result')) || 0
    const resultBb = getCell(record.row, 'resultBb')
    const rawHand = scalar(getCell(record.row, 'hand')).trim()
    if (!date || !level || !rawHand || getCell(record.row, 'result') == null || resultBb == null) {
      warnings.push({ recordId: record.id, type: 'skipped_core_missing', date, level, rawHand })
      return
    }

    const blind = parseBlind(level)
    const sessionId = stableId('feishu_session', date)
    if (!sessionMap[date]) {
      sessionMap[date] = {
        _id: sessionId,
        title: '历史导入 ' + date,
        date,
        startTime: date + ' 00:00:00',
        endTime: date + ' 23:59:00',
        venue: '历史导入',
        smallBlind: blind.smallBlind,
        bigBlind: blind.bigBlind,
        tableSize: 8,
        buyIn: 0,
        cashOut: 0,
        endingChips: null,
        totalProfit: 0,
        durationMinutes: 0,
        timerPausedAt: '',
        handCount: 0,
        status: 'finished',
        notes: 'Feishu历史数据按日期自动创建session；session盈亏等于当日已导入手牌盈亏合计。',
        createdAt: nowMs + index,
        updatedAt: nowMs + index,
        source: { type: 'feishu_base_history_import', baseToken: BASE_TOKEN, tableId: TABLE_ID, date }
      }
    }

    const session = sessionMap[date]
    if (session.bigBlind !== blind.bigBlind || session.smallBlind !== blind.smallBlind) {
      session.notes = session.notes + ' 含多个级别，session盲注仅取首条，单手stakeLevel为准。'
    }
    session.totalProfit += profit
    session.handCount += 1

    const handId = stableId('feishu_hand', record.id)
    const actionLine = scalar(getCell(record.row, 'actionLine'))
    const mindJourney = scalar(getCell(record.row, 'mindJourney'))
    const importIssue = scalar(getCell(record.row, 'importIssue'))
    const tags = listValue(getCell(record.row, 'tags'))
    const showdownInfo = inferShowdownInfo(record)
    if (importIssue) tags.push(importIssue)

    hands.push({
      _id: handId,
      sessionId,
      playedDate: date,
      stakeLevel: level,
      heroSeat: 0,
      heroPosition: normalizePosition(getCell(record.row, 'heroPosition')),
      villainPosition: '',
      villainType: scalar(getCell(record.row, 'opponentType')),
      hasStraddle: level.split('/').length >= 3,
      buttonSeat: 0,
      heroCardsInput: normalizeHeroCards(rawHand),
      effectiveStack: 0,
      potSize: 0,
      currentProfit: profit,
      allInEv: '',
      resultBB: String(resultBb),
      opponentType: scalar(getCell(record.row, 'opponentType')),
      opponentName: '',
      board: {
        flop: normalizeBoard(getCell(record.row, 'flopBoard')),
        turn: normalizeBoard(getCell(record.row, 'turnBoard')),
        river: normalizeBoard(getCell(record.row, 'riverBoard'))
      },
      opponentCards: '',
      opponentCardsSource: '',
      showdown: '',
      showdownType: showdownInfo.showdownType,
      showdownReason: showdownInfo.showdownReason,
      streetInputs: buildStreetInputs(record),
      ev: '',
      tags,
      notes: actionLine,
      mindJourney,
      streetSummary: actionLine,
      heroQuestion: '',
      detailBackfilled: true,
      voiceNote: '',
      voiceExtract: {
        source: 'feishu_base_history_import',
        sourceRecordId: record.id,
        rawHand,
        rawHeroPosition: scalar(getCell(record.row, 'heroPosition')),
        rawTags: listValue(getCell(record.row, 'tags')),
        importIssue
      },
      aiReview: null,
      reviewStatus: 'extracted',
      createdAt: nowMs + index,
      updatedAt: nowMs + index
    })
  })

  const sessions = Object.keys(sessionMap)
    .sort()
    .map(date => {
      const session = sessionMap[date]
      if (session.totalProfit >= 0) {
        session.buyIn = 0
        session.cashOut = session.totalProfit
      } else {
        session.buyIn = Math.abs(session.totalProfit)
        session.cashOut = 0
      }
      session.endingChips = session.cashOut || null
      return session
    })

  hands
    .slice()
    .sort((a, b) => String(a.playedDate || '').localeCompare(String(b.playedDate || '')) || (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0))
    .forEach((hand, index, list) => {
      hand.cumulativeHours = Math.round(HISTORY_TOTAL_HOURS * (index + 1) / Math.max(1, list.length) * 10) / 10
      hand.elapsedHours = hand.cumulativeHours
    })

  const totalImportedHands = Math.max(1, hands.length)
  sessions.forEach(session => {
    session.durationMinutes = Math.round(HISTORY_TOTAL_HOURS * 60 * (Number(session.handCount) || 0) / totalImportedHands)
  })

  return {
    sessions,
    hands,
    handActions,
    bankrollLogs: sessions.map((session, index) => ({
      _id: stableId('feishu_bankroll', session._id),
      sessionId: session._id,
      type: 'session_settlement',
      amount: session.totalProfit,
      balanceAfter: 12000 + sessions.slice(0, index + 1).reduce((sum, item) => sum + item.totalProfit, 0),
      note: session.title + ' 历史导入结算',
      createdAt: session.updatedAt,
      updatedAt: session.updatedAt
    })),
    aiReminderQueue: [],
    importMeta: {
      source: 'feishu_base_history_import',
      importMode: 'merge_patch',
      note: 'Do not import this file as a full backup. Merge these business arrays into the current user backup, preserving existing profile and settings.',
      baseToken: BASE_TOKEN,
      tableId: TABLE_ID,
      generatedAt: new Date(nowMs).toISOString(),
      recordCount: records.length,
      importedHandCount: hands.length,
      sessionCount: sessions.length,
      warnings
    }
  }
}

function summarize(preview) {
  const stakeCounts = {}
  const positionMissing = []
  const defaultedStake = []
  let totalProfit = 0
  preview.hands.forEach(hand => {
    stakeCounts[hand.stakeLevel] = (stakeCounts[hand.stakeLevel] || 0) + 1
    totalProfit += Number(hand.currentProfit) || 0
    if (!hand.heroPosition) positionMissing.push(hand._id)
    if (hand.tags.indexOf('已默认级别-200/400') > -1) defaultedStake.push(hand._id)
  })
  return {
    recordCount: preview.importMeta.recordCount,
    handCount: preview.hands.length,
    sessionCount: preview.sessions.length,
    totalProfit,
    sessionProfitTotal: preview.sessions.reduce((sum, item) => sum + item.totalProfit, 0),
    bankrollLogTotal: preview.bankrollLogs.reduce((sum, item) => sum + item.amount, 0),
    stakeCounts,
    missingHeroPositionCount: positionMissing.length,
    defaultedStakeCount: defaultedStake.length,
    warnings: preview.importMeta.warnings
  }
}

function markdownTable(rows, columns) {
  const header = '| ' + columns.map(item => item.label).join(' | ') + ' |'
  const divider = '| ' + columns.map(() => '---').join(' | ') + ' |'
  const body = rows.map(row => {
    return '| ' + columns.map(column => String(row[column.key] == null ? '' : row[column.key]).replace(/\|/g, '/')).join(' | ') + ' |'
  })
  return [header, divider].concat(body).join('\n')
}

function buildMarkdownReport(preview, summary) {
  const sampleHands = preview.hands.slice(0, 12).map(hand => ({
    date: hand.playedDate,
    hand: hand.heroCardsInput,
    level: hand.stakeLevel,
    profit: hand.currentProfit,
    bb: hand.resultBB,
    position: hand.heroPosition || '(空)',
    sessionId: hand.sessionId
  }))
  const stakeRows = Object.keys(summary.stakeCounts).map(stake => ({
    stake,
    count: summary.stakeCounts[stake]
  }))
  return [
    '# 飞书历史数据导入预览',
    '',
    '## 汇总',
    '',
    '- 飞书记录数：' + summary.recordCount,
    '- 预备导入手牌：' + summary.handCount,
    '- 按日期生成 session：' + summary.sessionCount,
    '- 手牌总盈亏：' + summary.totalProfit,
    '- session 结算盈亏合计：' + summary.sessionProfitTotal,
    '- bankroll log 合计：' + summary.bankrollLogTotal,
    '- Hero 位置未映射到标准位置：' + summary.missingHeroPositionCount,
    '- 默认级别 200/400 标记：' + summary.defaultedStakeCount,
    '- 阻断性 warning：' + summary.warnings.length,
    '',
    '## 映射规则',
    '',
    '- 同一日期的手牌归入同一个 `feishu_session_YYYY-MM-DD`。',
    '- 每个历史 session 标记为 `finished`，session 盈亏等于当日手牌盈亏合计。',
    '- `手牌` 转成小程序 `heroCardsInput`；有具体花色的转成 `AhKd` 形式，没有花色的如 `QQ/AQo` 保留简写。',
    '- `Hero位置` 只映射标准位置：UTG、UTG+1、LJ、HJ、CO、BTN、SB、BB、STR；未知/待补充/非标准位置留空，暂不进入位置分析。',
    '- `级别` 保留到每手牌的 `stakeLevel`；session 盲注只取该日期首条记录，仅用于 session 标题/基础字段。',
    '- `行动线` 写入 `streetSummary` 和 `notes`；分街行动写入 `streetInputs.preflop/flop/turn/river.actionLine`。',
    '- `导入清洗问题` 会追加到手牌 tags，用来保留默认级别等来源标记。',
    '- 输出文件是 merge patch，不是完整 backup；导入时必须合并到当前用户 backup，保留现有 profile/settings。',
    '',
    '## 级别分布',
    '',
    markdownTable(stakeRows, [
      { key: 'stake', label: '级别' },
      { key: 'count', label: '手牌数' }
    ]),
    '',
    '## 样例',
    '',
    markdownTable(sampleHands, [
      { key: 'date', label: '日期' },
      { key: 'hand', label: '手牌' },
      { key: 'level', label: '级别' },
      { key: 'profit', label: '盈亏' },
      { key: 'bb', label: 'BB' },
      { key: 'position', label: '位置' },
      { key: 'sessionId', label: 'Session' }
    ]),
    ''
  ].join('\n')
}

function main() {
  const outputDir = path.resolve(__dirname, '..', 'docs', 'import')
  fs.mkdirSync(outputDir, { recursive: true })
  const records = fetchRecords()
  const preview = buildImportPreview(records)
  const summary = summarize(preview)
  fs.writeFileSync(path.join(outputDir, 'feishu-history-import-patch.json'), JSON.stringify(preview, null, 2), 'utf8')
  fs.writeFileSync(path.join(outputDir, 'feishu-history-import-summary.json'), JSON.stringify(summary, null, 2), 'utf8')
  fs.writeFileSync(path.join(outputDir, 'feishu-history-import-report.md'), buildMarkdownReport(preview, summary), 'utf8')
  console.log(JSON.stringify(summary, null, 2))
}

if (require.main === module) {
  main()
}
