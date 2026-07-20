'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const EXPECTED_ENV_ID = 'cloud1-d3ggy9aq3be912e34'
const FUNCTION_NAME = 'poker_social'
const API_VERSION = '2018-06-08'

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function normalizeField(field, context) {
  assert(field && typeof field.field === 'string' && field.field.trim(), `${context}: field is required`)
  const hasArray = field.array === true
  const hasOrder = field.order === 'ASC' || field.order === 'DESC'
  assert(hasArray !== hasOrder, `${context}.${field.field}: use exactly one of array=true or order=ASC|DESC`)
  return {
    name: field.field,
    direction: field.order === 'DESC' ? '-1' : '1',
    sourceShape: hasArray ? 'ARRAY' : field.order
  }
}

function canonicalIndex(collection, fields) {
  return `${collection}|${fields.map(field => `${field.name}:${field.direction}`).join('|')}`
}

function stableIndexName(collection, fields) {
  const digest = crypto.createHash('sha256').update(canonicalIndex(collection, fields)).digest('hex').slice(0, 16)
  const safeCollection = collection.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 36)
  return `idx_${safeCollection}_${digest}`
}

function buildPlan(root) {
  const configPath = path.join(root, 'cloudbaserc.social.json')
  const socialRoot = path.join(root, 'cloudfunctions', FUNCTION_NAME)
  const rulesPath = path.join(socialRoot, 'database-security-rules.json')
  const indexesPath = path.join(socialRoot, 'database-indexes.json')
  const config = readJson(configPath)
  const rules = readJson(rulesPath)
  const indexManifest = readJson(indexesPath)

  assert(config.envId === EXPECTED_ENV_ID, `unexpected envId: ${config.envId || '<missing>'}`)
  assert(config.functionRoot === './cloudfunctions', 'social config functionRoot must be ./cloudfunctions')
  assert(Array.isArray(config.functions) && config.functions.length === 1, 'social config must contain exactly one function')
  assert(config.functions[0].name === FUNCTION_NAME, `social config must deploy only ${FUNCTION_NAME}`)
  assert(config.functions[0].type === 'Event', 'poker_social must be an Event function')
  assert(config.functions[0].handler === 'index.main', 'poker_social handler must be index.main')
  assert(config.functions[0].runtime === 'Nodejs20.19', 'poker_social runtime must be Nodejs20.19')
  assert(config.functions[0].timeout === 60, 'poker_social timeout must be 60 seconds')
  assert(config.functions[0].memorySize === 256, 'poker_social memory must be 256 MB')
  assert(config.functions[0].installDependency === true, 'poker_social dependencies must be installed')
  assert(rules.version === 1 && rules.collections && typeof rules.collections === 'object', 'invalid security manifest')
  assert(indexManifest.version === 1 && Array.isArray(indexManifest.indexes), 'invalid index manifest')

  const managedCollections = Object.keys(rules.collections).sort()
  for (const collection of managedCollections) {
    const policy = rules.collections[collection]
    assert(policy && policy.read === false && policy.write === false,
      `${collection}: every managed collection must deny client reads and writes`)
  }

  const managedSet = new Set(managedCollections)
  const seen = new Set()
  const indexes = indexManifest.indexes.map((index, indexPosition) => {
    const context = `indexes[${indexPosition}]`
    assert(index && typeof index.collection === 'string' && index.collection.trim(), `${context}: collection is required`)
    assert(Array.isArray(index.fields) && index.fields.length > 0, `${context}: fields are required`)
    const fields = index.fields.map((field, fieldPosition) => normalizeField(field, `${context}.fields[${fieldPosition}]`))
    const canonical = canonicalIndex(index.collection, fields)
    assert(!seen.has(canonical), `${context}: duplicate index ${canonical}`)
    seen.add(canonical)
    return {
      collection: index.collection,
      ownership: managedSet.has(index.collection) ? 'managed' : 'external',
      name: stableIndexName(index.collection, fields),
      canonical,
      fields
    }
  })

  const externalCollections = Array.from(new Set(
    indexes.filter(index => index.ownership === 'external').map(index => index.collection)
  )).sort()
  assert(JSON.stringify(externalCollections) === JSON.stringify(['hand_actions']),
    `external index collections must be exactly hand_actions, got: ${externalCollections.join(', ') || '<none>'}`)

  return {
    version: 1,
    envId: config.envId,
    apiVersion: API_VERSION,
    functionName: FUNCTION_NAME,
    paths: { configPath, rulesPath, indexesPath },
    managedCollections,
    externalCollections,
    indexes
  }
}

function createTableBody(plan, collection, tag) {
  assert(plan.managedCollections.includes(collection), `${collection}: refusing to create an external collection`)
  return {
    TableName: collection,
    Tag: tag,
    EnvId: plan.envId,
    PermissionInfo: { AclTag: 'ADMINONLY', EnvId: plan.envId }
  }
}

function describeTableBody(plan, collection, tag) {
  return { TableName: collection, Tag: tag, EnvId: plan.envId }
}

function createIndexBody(plan, index, tag) {
  return {
    TableName: index.collection,
    Tag: tag,
    EnvId: plan.envId,
    CreateIndexes: [{
      IndexName: index.name,
      MgoKeySchema: {
        MgoIndexKeys: index.fields.map(field => ({ Name: field.name, Direction: field.direction })),
        MgoIsUnique: false,
        MgoIsSparse: false
      }
    }]
  }
}

if (require.main === module) {
  const rootFlag = process.argv.indexOf('--root')
  const root = rootFlag >= 0 ? process.argv[rootFlag + 1] : path.resolve(__dirname, '..', '..')
  process.stdout.write(`${JSON.stringify(buildPlan(path.resolve(root)), null, 2)}\n`)
}

module.exports = {
  API_VERSION,
  EXPECTED_ENV_ID,
  FUNCTION_NAME,
  buildPlan,
  canonicalIndex,
  createIndexBody,
  createTableBody,
  describeTableBody,
  stableIndexName
}
