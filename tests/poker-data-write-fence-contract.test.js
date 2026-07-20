const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const source = fs.readFileSync(path.join(__dirname, '../cloudfunctions/poker_data/index.js'), 'utf8')

function functionSource(name) {
  const start = source.indexOf(`async function ${name}`)
  assert.notEqual(start, -1, `${name} must exist`)
  const nextDeclaration = source.slice(start + 1).match(/\n(?:async )?function [A-Za-z0-9_]+\s*\(/)
  const end = nextDeclaration ? start + 1 + nextDeclaration.index : source.length
  return source.slice(start, end)
}

test('every deployed poker-data business write action captures an account generation', () => {
  const actionDeclaration = source.slice(
    source.indexOf('const BUSINESS_WRITE_ACTIONS'),
    source.indexOf('const BUSINESS_COLLECTIONS')
  )
  const declaredActions = Array.from(actionDeclaration.matchAll(/'([^']+)'/g), match => match[1])
  assert.deepEqual(declaredActions, [
    'login_account',
    'sync_stats',
    'save_settings',
    'backfill_session_durations',
    'begin_player_card_import_receipt',
    'complete_player_card_import_receipt',
    'create_player_note',
    'update_player_note',
    'delete_player_note',
    'create_session',
    'update_session',
    'finish_session',
    'create_hand',
    'update_hand',
    'upsert_hand',
    'delete_hand',
    'delete_session'
  ])

  const main = source.slice(source.indexOf('exports.main = async function main'), source.indexOf('exports.__test ='))
  assert.match(main, /BUSINESS_WRITE_ACTIONS\.includes\(action\)/)
  assert.match(main, /captureAccountLifecycle\(ownerOpenId, playerId\)/)
  assert.match(main, /runWithBusinessFence\(fence, \(\) => exports\.main\(rawEvent\)\)/)
})

test('every direct business transaction re-reads the active generation before its write', () => {
  const directBusinessTransactions = [
    'claimHandActionRevision',
    'finalizeHandActionRevision',
    'writeHandMetadataCloud',
    'beginPlayerCardImportReceiptAction',
    'completePlayerCardImportReceiptAction'
  ]

  for (const name of directBusinessTransactions) {
    const body = functionSource(name)
    const fenceRead = body.indexOf('assertBusinessFenceInTransaction(transaction)')
    const businessWrite = body.indexOf('transaction.collection(COLLECTIONS.')
    assert.notEqual(fenceRead, -1, `${name} must re-read its generation in the transaction`)
    assert.ok(businessWrite > fenceRead, `${name} must re-read the generation before the business write`)
  }

  for (const name of [
    'stageSyncOperationResultOnce',
    'completeSyncOperationClaim',
    'persistMutationRecoveryEvidence'
  ]) {
    const body = functionSource(name)
    assert.match(body, /assertBusinessFenceInTransaction\(transaction\)/,
      `${name} stores business payload and must participate in the same generation transaction`)
  }
})

test('generic business set/remove paths and clear special mode cannot bypass the lifecycle transaction', () => {
  assert.match(functionSource('setDocById'), /runFencedBusinessTransaction\(/)
  assert.match(functionSource('removeDocById'), /runFencedBusinessTransaction\(/)

  const clearRemove = functionSource('removeClearBusinessDocById')
  assert.match(clearRemove, /PRIVATE_CLEAR_COLLECTIONS\.includes\(collectionName\)/)
  assert.match(clearRemove, /assertClearFenceInTransaction\(transaction, scopedFence\)/)
  assert.match(clearRemove, /getDocByPointRead\(transaction, collectionName, docId\)/)
  assert.match(clearRemove, /ACCOUNT_CLEAR_SCOPE_INVALID/)
  assert.match(clearRemove, /transaction\.collection\(collectionName\)\.doc\(docId\)\.remove\(\)/)

  const clearMetadata = functionSource('setClearMetadataDocById')
  assert.match(clearMetadata, /assertClearLifecycleInTransaction\(transaction, clearFence\)/)
  assert.match(clearMetadata, /getDocByPointRead\(transaction, collectionName, docId\)/)
  assert.match(clearMetadata, /ACCOUNT_CLEAR_SCOPE_INVALID/)
  assert.match(clearMetadata, /transaction\.collection\(collectionName\)\.doc\(docId\)\.set\(/)

  const redaction = functionSource('redactOwnedOperationHistory')
  assert.match(redaction, /setClearMetadataDocById\(clearFence, collectionName, doc\._id/)
})
