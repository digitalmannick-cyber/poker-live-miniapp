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

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8')
}

function ensureArray(value) {
  return Array.isArray(value) ? value : []
}

function mergeById(existing, incoming, options) {
  const config = options || {}
  const protectedIds = new Set()
  const list = ensureArray(existing).slice()
  list.forEach(item => {
    if (item && item._id) protectedIds.add(item._id)
  })

  const added = []
  const skipped = []
  ensureArray(incoming).forEach(item => {
    if (!item || !item._id) return
    if (protectedIds.has(item._id)) {
      skipped.push(item._id)
      return
    }
    protectedIds.add(item._id)
    added.push(item)
    if (config.prepend) {
      list.unshift(item)
    } else {
      list.push(item)
    }
  })

  return { list, added: added.length, skipped }
}

function mergePatch(currentBackup, patch) {
  const current = Object.assign({}, currentBackup || {})
  const importMeta = patch.importMeta || {}
  if (importMeta.importMode !== 'merge_patch') {
    throw new Error('patch importMeta.importMode must be merge_patch')
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'profile') || Object.prototype.hasOwnProperty.call(patch, 'settings')) {
    throw new Error('patch must not contain profile/settings; refusing to risk account overwrite')
  }

  const sessions = mergeById(current.sessions, patch.sessions, { prepend: false })
  const hands = mergeById(current.hands, patch.hands, { prepend: false })
  const handActions = mergeById(current.handActions, patch.handActions, { prepend: false })
  const bankrollLogs = mergeById(current.bankrollLogs, patch.bankrollLogs, { prepend: false })

  const merged = Object.assign({}, current, {
    initialDataVersion: Number(current.initialDataVersion) || 2,
    sessions: sessions.list,
    hands: hands.list,
    handActions: handActions.list,
    bankrollLogs: bankrollLogs.list,
    aiReminderQueue: ensureArray(current.aiReminderQueue)
  })

  return {
    backup: merged,
    summary: {
      source: importMeta.source || 'feishu_base_history_import',
      sessionsAdded: sessions.added,
      handsAdded: hands.added,
      handActionsAdded: handActions.added,
      bankrollLogsAdded: bankrollLogs.added,
      sessionsSkippedExisting: sessions.skipped.length,
      handsSkippedExisting: hands.skipped.length,
      handActionsSkippedExisting: handActions.skipped.length,
      bankrollLogsSkippedExisting: bankrollLogs.skipped.length,
      totalSessions: merged.sessions.length,
      totalHands: merged.hands.length,
      importedHandProfit: ensureArray(patch.hands).reduce((sum, hand) => sum + (Number(hand.currentProfit) || 0), 0),
      importedSessionProfit: ensureArray(patch.sessions).reduce((sum, session) => sum + (Number(session.totalProfit) || 0), 0)
    }
  }
}

function main() {
  const args = parseArgs(process.argv)
  const currentPath = args.current || args.backup
  const patchPath = args.patch || path.resolve(__dirname, '..', 'docs', 'import', 'feishu-history-import-patch.json')
  const outPath = args.out || path.resolve(__dirname, '..', 'docs', 'import', 'feishu-history-merged-backup.json')
  const rollbackPath = args.rollback || path.resolve(__dirname, '..', 'docs', 'import', 'feishu-history-rollback-backup.json')

  if (!currentPath) {
    throw new Error('missing --current <current-backup.json>')
  }

  const current = readJson(currentPath)
  const patch = readJson(patchPath)
  const result = mergePatch(current, patch)

  writeJson(outPath, result.backup)
  writeJson(rollbackPath, current)
  writeJson(outPath.replace(/\.json$/i, '.summary.json'), result.summary)
  console.log(JSON.stringify(result.summary, null, 2))
}

if (require.main === module) {
  main()
}

module.exports = {
  mergePatch
}
