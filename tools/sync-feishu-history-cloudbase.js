const childProcess = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const CLOUDBASE_CLI = 'C:/Users/11075/AppData/Roaming/npm/node_modules/@cloudbase/cli/bin/cloudbase'
const ENV_ID = 'cloud1-d3ggy9aq3be912e34'
const PLAYER_ID = 'PLR-UYOV-EQWZOM'
const OWNER_OPEN_ID = 'oiEdl3QbetACPAPCpa8-SSupmBWI'

const COLLECTIONS = {
  sessions: 'sessions',
  hands: 'hands',
  handActions: 'hand_actions',
  bankrollLogs: 'bankroll_logs'
}

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
      maxBuffer: 50 * 1024 * 1024
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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function stripUndefined(value) {
  if (Array.isArray(value)) return value.map(stripUndefined)
  if (value && typeof value === 'object') {
    const next = {}
    Object.keys(value).forEach(key => {
      const item = stripUndefined(value[key])
      if (item !== undefined) next[key] = item
    })
    return next
  }
  return value === undefined ? undefined : value
}

function withOwner(doc) {
  const next = Object.assign({}, doc || {}, {
    playerId: PLAYER_ID,
    ownerOpenId: OWNER_OPEN_ID
  })
  delete next._openid
  return stripUndefined(next)
}

function compactSessionNotes(items) {
  return items.map(item => {
    const next = Object.assign({}, item)
    if (typeof next.notes === 'string' && next.notes.includes('含多个级别')) {
      const base = 'Feishu历史数据按日期自动创建session；session盈亏等于当日已导入手牌盈亏合计。'
      next.notes = base + ' 含多个级别，session盲注仅取首条，单手stakeLevel为准。'
    }
    return next
  })
}

function buildUpdateCommands(collectionName, items) {
  return [{
    TableName: collectionName,
    CommandType: 'UPDATE',
    Command: JSON.stringify({
      update: collectionName,
      updates: items.map(item => {
        const doc = withOwner(item)
        const id = doc._id
        delete doc._id
        return {
          q: { _id: id },
          u: { $set: doc },
          upsert: true
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

function importedOnly(list, prefix) {
  return (Array.isArray(list) ? list : []).filter(item => {
    return item && typeof item._id === 'string' && item._id.indexOf(prefix) === 0
  })
}

function queryCounts() {
  const commands = [
    {
      TableName: 'sessions',
      CommandType: 'COMMAND',
      Command: JSON.stringify({
        count: 'sessions',
        query: { playerId: PLAYER_ID, ownerOpenId: OWNER_OPEN_ID, _id: { $regex: '^feishu_session_' } }
      })
    },
    {
      TableName: 'hands',
      CommandType: 'COMMAND',
      Command: JSON.stringify({
        count: 'hands',
        query: { playerId: PLAYER_ID, ownerOpenId: OWNER_OPEN_ID, _id: { $regex: '^feishu_hand_' } }
      })
    },
    {
      TableName: 'bankroll_logs',
      CommandType: 'COMMAND',
      Command: JSON.stringify({
        count: 'bankroll_logs',
        query: { playerId: PLAYER_ID, ownerOpenId: OWNER_OPEN_ID, _id: { $regex: '^feishu_bankroll_' } }
      })
    }
  ]
  return runCloudbase(commands)
}

function syncCollection(collectionName, items, batchSize) {
  let written = 0
  chunk(items, batchSize).forEach(batch => {
    runCloudbase(buildUpdateCommands(collectionName, batch))
    written += batch.length
    console.log(JSON.stringify({ collectionName, written, total: items.length }))
  })
  return written
}

function main() {
  const args = parseArgs(process.argv)
  const mode = args.mode || 'verify'
  const backupPath = args.file || path.join(ROOT, 'docs', 'import', 'feishu-history-merged-backup.json')
  const backup = readJson(backupPath)
  const sessions = compactSessionNotes(importedOnly(backup.sessions, 'feishu_session_'))
  const hands = importedOnly(backup.hands, 'feishu_hand_')
  const bankrollLogs = importedOnly(backup.bankrollLogs, 'feishu_bankroll_')

  if (mode === 'verify') {
    console.log(JSON.stringify(queryCounts(), null, 2))
    return
  }
  if (mode !== 'sync') {
    throw new Error('unsupported --mode: ' + mode)
  }

  const sessionFrom = Number(args['sessions-from'] || 0)
  const handFrom = Number(args['hands-from'] || 0)
  const bankrollFrom = Number(args['bankroll-from'] || 0)
  const syncSessions = args['skip-sessions'] !== true
  const syncHands = args['skip-hands'] !== true
  const syncBankrollLogs = args['skip-bankroll'] !== true

  const summary = {
    ownerOpenId: OWNER_OPEN_ID,
    playerId: PLAYER_ID,
    sessions: syncSessions
      ? syncCollection(COLLECTIONS.sessions, sessions.slice(sessionFrom), 5)
      : 0,
    hands: syncHands
      ? syncCollection(COLLECTIONS.hands, hands.slice(handFrom), 5)
      : 0,
    bankrollLogs: syncBankrollLogs
      ? syncCollection(COLLECTIONS.bankrollLogs, bankrollLogs.slice(bankrollFrom), 10)
      : 0
  }
  console.log(JSON.stringify({ synced: summary, verify: queryCounts() }, null, 2))
}

if (require.main === module) {
  main()
}
