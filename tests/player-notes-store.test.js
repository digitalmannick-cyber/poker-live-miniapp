const assert = require('node:assert/strict')

const storage = {}
global.wx = {
  getStorageSync(key) {
    return storage[key]
  },
  setStorageSync(key, value) {
    storage[key] = value
  },
  removeStorageSync(key) {
    delete storage[key]
  }
}

const store = require('../utils/store')

function resetStore(data) {
  Object.keys(storage).forEach(key => delete storage[key])
  store.__test.resetCachedStoreForTest()
  store.importBackup(data || store.__test.buildInitialStoreData())
  store.__test.resetCachedStoreForTest()
}

resetStore({
  sessions: [],
  hands: [
    {
      _id: 'hand_a',
      playedDate: '2026-07-02',
      stakeLevel: '200/400',
      heroPosition: 'BTN',
      villainPosition: 'SB',
      heroCardsInput: 'AsKs',
      opponentCards: 'KhKd',
      currentProfit: 7200,
      board: { flop: 'Ac9s4d', turn: 'Kh', river: '2c' },
      streetInputs: {
        preflop: { actionLine: 'HJ open, Hero BTN 3bet, 老张 call' },
        river: { actionLine: 'Hero value bet, 老张 call muck' }
      },
      createdAt: 2000,
      updatedAt: 3000
    },
    {
      _id: 'hand_b',
      playedDate: '2026-07-03',
      stakeLevel: '200/400',
      heroPosition: 'HJ',
      villainPosition: 'BB',
      heroCardsInput: 'ThTs',
      currentProfit: -12000,
      board: { flop: 'Ac9s4d', turn: 'Kh', river: '2c' },
      streetInputs: {
        preflop: { actionLine: 'Hero HJ raise, BB call' },
        river: { actionLine: 'Hero HJ fold' }
      },
      createdAt: 2500,
      updatedAt: 3500
    }
  ],
  handActions: [{ _id: 'act_a', handId: 'hand_a', sequence: 1, actionType: 'bet' }],
  bankrollLogs: [],
  profile: { playerId: 'WX-PLAYER1', name: 'Hero' },
  settings: {
    opponentTypes: ['紧弱', '松弱', '激进', '跟注站'],
    playerLeakTags: ['不弃顶对', 'river少诈唬', '不弃顶对', '']
  }
})

const shaped = store.exportBackup()
assert.deepEqual(shaped.playerNotes, [], 'old backups should normalize missing playerNotes to an empty array')
assert.deepEqual(shaped.settings.playerLeakTags, ['不弃顶对', 'river少诈唬'], 'player leak tag library should remove empty and duplicate tags')

store.updateSettings({ playerLeakTags: shaped.settings.playerLeakTags.concat(['overplay', 'overplay', '']) })
assert.deepEqual(
  store.getSettings().playerLeakTags,
  ['不弃顶对', 'river少诈唬', 'overplay'],
  'custom player leak tags should persist in normalized settings'
)
assert.deepEqual(
  storage.pokerLiveMiniappStore.settings.playerLeakTags,
  ['不弃顶对', 'river少诈唬', 'overplay'],
  'custom player leak tags should also persist in the main local store snapshot'
)

const created = store.createPlayerNote({
  name: ' 老张 ',
  alias: ['红帽子', ''],
  type: '跟注站',
  leakTags: ['不弃顶对', 'river少诈唬', 'overplay', '不弃顶对', ''],
  note: 'river 主动诈唬少',
  battleHandIds: ['hand_a', 'hand_a', 'hand_b', 'missing']
})

assert.equal(created.name, '老张')
assert.equal(created.typeColor, '#ffd447')
assert.deepEqual(created.leakTags, ['不弃顶对', 'river少诈唬', 'overplay'])
assert.deepEqual(created.battleHandIds, ['hand_a', 'hand_b', 'missing'], 'battle hand ids should be de-duplicated without copying hand documents')

const list = store.getPlayerNotes({ query: 'river', type: '跟注站' })
assert.equal(list.length, 1, 'search should include note and work with type filter')
assert.equal(list[0]._id, created._id)

const battleHands = store.getPlayerNoteBattleHands(created._id)
assert.equal(battleHands.length, 2, 'battle hands should only return existing hands')
assert.equal(battleHands[0].relationshipText, 'Hero vs 老张')
assert.equal(battleHands[0].replayAvailable, true)
assert.equal(battleHands[0].heroCardsVisual.length, 2)
assert.equal(battleHands[0].boardCardsVisual.length, 5)
assert.match(battleHands[0].actionLine, /Hero BTN 3B/)
assert.equal(battleHands[0].versusSummary.heroPosition, 'BTN')
assert.equal(battleHands[0].versusSummary.opponentPosition, 'SB')
assert.equal(battleHands[0].versusSummary.hasOpponentCards, true)
assert.equal(battleHands[0].versusSummary.opponentCardsVisual.length, 2)
assert.equal(battleHands[0].versusSummary.currentProfitDisplay, '+7200')
assert.equal(battleHands[0].versusSummary.profitTone, 'positive')
assert.equal(battleHands[1].versusSummary.heroPosition, 'HJ')
assert.equal(battleHands[1].versusSummary.opponentPosition, 'BB')
assert.equal(battleHands[1].versusSummary.hasOpponentCards, false, 'hands without showdown should still show opponent position only')
assert.equal(battleHands[1].versusSummary.currentProfitDisplay, '-12000')
assert.equal(battleHands[1].versusSummary.profitTone, 'negative')

const updated = store.updatePlayerNote(created._id, {
  leakTags: ['turn过度加注'],
  battleHandIds: []
})
assert.deepEqual(updated.leakTags, ['turn过度加注'])

const fish = store.createPlayerNote({ name: 'Fish', type: '鱼' })
const regular = store.createPlayerNote({ name: 'Reg', type: '常客' })
const pro = store.createPlayerNote({ name: 'Pro', type: '职业' })
const cachedGrayFish = store.__test.normalizePlayerNote({ _id: 'old_fish', name: 'Old Fish', type: '鱼', typeColor: '#8891a7' })
assert.notEqual(fish.typeColor, '#8891a7', 'fish player type should have a distinct row color')
assert.notEqual(regular.typeColor, '#8891a7', 'regular player type should have a distinct row color')
assert.notEqual(pro.typeColor, '#8891a7', 'pro player type should have a distinct row color')
assert.notEqual(cachedGrayFish.typeColor, '#8891a7', 'old fish notes with cached gray typeColor should be repaired to the fish color')

const deleted = store.deletePlayerNote(created._id)
assert.equal(deleted.archived, true)
store.deletePlayerNote(fish._id)
store.deletePlayerNote(regular._id)
store.deletePlayerNote(pro._id)
assert.equal(store.getPlayerNotes({}).length, 0, 'archived player notes should be hidden by default')
assert.equal(store.getPlayerNotes({ includeArchived: true }).length, 4)

const backup = store.exportBackup()
assert.equal(backup.playerNotes.length, 4, 'exportBackup should include playerNotes')

const importedWithStableId = store.createPlayerNote({
  _id: 'player_note_card_import_1',
  name: '名片玩家',
  type: '常客',
  leakTags: ['河牌过度跟注'],
  note: '导入副本'
})
const importedRetry = store.createPlayerNote({
  _id: 'player_note_card_import_1',
  name: '不应产生第二份'
})
assert.equal(importedRetry._id, importedWithStableId._id)
assert.equal(store.getPlayerNotes({ sourceKind: 'library' }).filter(item => item._id === importedWithStableId._id).length, 1)

const cleared = store.clearAllData()
assert.deepEqual(cleared.playerNotes, [], 'clearAllData should reset playerNotes')

console.log('player notes store tests passed')
