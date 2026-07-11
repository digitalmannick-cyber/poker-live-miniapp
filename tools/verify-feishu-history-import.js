const fs = require('fs')
const path = require('path')

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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function ensureArray(value) {
  return Array.isArray(value) ? value : []
}

function sumBy(items, getter) {
  return ensureArray(items).reduce((sum, item) => sum + (Number(getter(item)) || 0), 0)
}

function countDuplicateIds(lists) {
  const seen = new Set()
  let duplicates = 0
  lists.forEach(list => {
    ensureArray(list).forEach(item => {
      const id = item && item._id
      if (!id) return
      if (seen.has(id)) duplicates += 1
      seen.add(id)
    })
  })
  return duplicates
}

function countImportedHands(data) {
  return ensureArray(data.hands).filter(item => {
    const id = item && item._id
    return typeof id === 'string' && id.indexOf('feishu_hand_') === 0
  }).length
}

function countImportedSessions(data) {
  return ensureArray(data.sessions).filter(item => {
    const id = item && item._id
    return typeof id === 'string' && id.indexOf('feishu_session_') === 0
  }).length
}

function countMissingHeroPositions(data) {
  return ensureArray(data.hands).filter(item => {
    const id = item && item._id
    if (typeof id !== 'string' || id.indexOf('feishu_hand_') !== 0) return false
    return !String(item.heroPosition || '').trim()
  }).length
}

function validatePatch(data) {
  const failures = []
  if (!data.importMeta || data.importMeta.importMode !== 'merge_patch') {
    failures.push('patch importMeta.importMode is not merge_patch')
  }
  if (Object.prototype.hasOwnProperty.call(data, 'profile')) {
    failures.push('patch contains profile')
  }
  if (Object.prototype.hasOwnProperty.call(data, 'settings')) {
    failures.push('patch contains settings')
  }
  return failures
}

function buildReport(data, mode) {
  const duplicateIds = countDuplicateIds([
    data.sessions,
    data.hands,
    data.handActions,
    data.bankrollLogs,
    data.aiReminderQueue
  ])
  const report = {
    mode,
    sessions: ensureArray(data.sessions).length,
    hands: ensureArray(data.hands).length,
    handActions: ensureArray(data.handActions).length,
    bankrollLogs: ensureArray(data.bankrollLogs).length,
    importedSessions: countImportedSessions(data),
    importedHands: countImportedHands(data),
    importedMissingHeroPositions: countMissingHeroPositions(data),
    totalHandProfit: sumBy(data.hands, item => item && item.currentProfit),
    totalSessionProfit: sumBy(data.sessions, item => item && item.totalProfit),
    importedHandProfit: sumBy(
      ensureArray(data.hands).filter(item => item && String(item._id || '').indexOf('feishu_hand_') === 0),
      item => item && item.currentProfit
    ),
    importedSessionProfit: sumBy(
      ensureArray(data.sessions).filter(item => item && String(item._id || '').indexOf('feishu_session_') === 0),
      item => item && item.totalProfit
    ),
    importedBankrollProfit: sumBy(
      ensureArray(data.bankrollLogs).filter(item => item && String(item._id || '').indexOf('feishu_bankroll_') === 0),
      item => item && item.amount
    ),
    duplicateIds,
    hasProfile: Object.prototype.hasOwnProperty.call(data, 'profile'),
    hasSettings: Object.prototype.hasOwnProperty.call(data, 'settings')
  }

  const failures = []
  if (duplicateIds) failures.push('duplicate _id found')
  if (report.importedHands && report.importedHands !== 417) failures.push('imported hand count is not 417')
  if (report.importedSessions && report.importedSessions !== 63) failures.push('imported session count is not 63')
  if (report.importedHandProfit && report.importedHandProfit !== 2507900) failures.push('imported hand profit is not 2507900')
  if (report.importedSessionProfit && report.importedSessionProfit !== 2507900) failures.push('imported session profit is not 2507900')
  if (report.importedBankrollProfit && report.importedBankrollProfit !== 2507900) failures.push('imported bankroll profit is not 2507900')
  if (report.importedHands && report.importedMissingHeroPositions !== 160) {
    failures.push('imported missing hero position count is not 160')
  }
  if (mode === 'patch') failures.push(...validatePatch(data))

  report.ok = failures.length === 0
  report.failures = failures
  return report
}

function main() {
  const args = parseArgs(process.argv)
  const filePath = args.file || path.resolve(__dirname, '..', 'docs', 'import', 'feishu-history-import-patch.json')
  const mode = args.mode || 'patch'
  const data = readJson(filePath)
  const report = buildReport(data, mode)
  console.log(JSON.stringify(report, null, 2))
  if (!report.ok) process.exitCode = 1
}

if (require.main === module) {
  main()
}

module.exports = {
  buildReport
}
