const assert = require('assert')
const Module = require('module')
const path = require('path')
const fs = require('fs')

const pagePath = path.resolve(__dirname, '../pages/hand-ledger-input/hand-ledger-input.js')
const wxmlPath = path.resolve(__dirname, '../pages/hand-ledger-input/hand-ledger-input.wxml')
let savedPayload = null
let updatedHandPatch = null
let aiAdvicePayload = null
let createdPlayerNotePayload = null
let linkedBattleHands = []
let pageDefinition = null
let lastToast = null
let lastLoading = null
let hideLoadingCalled = false
let redirectToCall = null
const originalLoad = Module._load
const originalSetTimeout = global.setTimeout

function parseCardsInput(value, limit) {
  const text = String(value || '')
  const cards = []
  for (let i = 0; i < text.length - 1; i += 2) {
    const rank = text.charAt(i).toUpperCase()
    const suit = text.charAt(i + 1).toLowerCase()
    const suitMap = {
      s: ['♠', 'spade'],
      h: ['♥', 'heart'],
      d: ['♦', 'diamond'],
      c: ['♣', 'club']
    }
    if (!'AKQJT98765432'.includes(rank) || !suitMap[suit]) continue
    cards.push({ rank, suit, suitSymbol: suitMap[suit][0], suitClass: suitMap[suit][1] })
    if (limit && cards.length >= limit) break
  }
  return cards
}

function installMocks() {
  savedPayload = null
  updatedHandPatch = null
  aiAdvicePayload = null
  createdPlayerNotePayload = null
  linkedBattleHands = []
  lastToast = null
  lastLoading = null
  hideLoadingCalled = false
  redirectToCall = null
  pageDefinition = null
  global.wx = {
    showToast(options) { lastToast = options },
    showLoading(options) { lastLoading = options },
    hideLoading() { hideLoadingCalled = true },
    navigateBack() {},
    redirectTo(options) { redirectToCall = options },
    switchTab() {}
  }
  global.setTimeout = fn => {
    if (typeof fn === 'function') fn()
    return 0
  }
  global.Page = definition => {
    pageDefinition = definition
  }
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request.endsWith('../../services/data-service')) {
      return {
        async getSessionById(id) {
          if (id === 'session-after-table-change') {
            return {
              _id: id,
              smallBlind: 500,
              bigBlind: 1000,
              tableSize: 9,
              hasStraddle: true,
              buyIn: 100000,
              currentProfit: 0,
              date: '2026-07-11'
            }
          }
          return {
            _id: id || 'session-test',
            smallBlind: 200,
            bigBlind: 400,
            tableSize: 8,
            hasStraddle: false,
            buyIn: 40000,
            currentProfit: 0,
            date: '2026-07-04'
          }
        },
        async getSessionDetailData(id) {
          if (id === 'session-after-table-change') {
            return {
              session: {
                _id: id,
                smallBlind: 500,
                bigBlind: 1000,
                tableSize: 9,
                hasStraddle: true,
                buyIn: 100000,
                currentProfit: 0,
                date: '2026-07-11'
              },
              hands: []
            }
          }
          if (id === 'session-stack-snapshot') {
            return {
              session: {
                _id: id,
                smallBlind: 200,
                bigBlind: 400,
                tableSize: 8,
                hasStraddle: false,
                buyIn: 40000,
                cashOut: 200000,
                endingChips: 200000,
                currentProfit: 160000,
                totalProfit: 160000,
                date: '2026-07-04',
                timelineEvents: [
                  { _id: 'stack-mid', type: 'stack', amount: 100000, createdAtMs: 1000, sequence: 1 }
                ]
              },
              hands: []
            }
          }
          if (id === 'session-stack-before-hand') {
            return {
              session: {
                _id: id,
                smallBlind: 200,
                bigBlind: 400,
                tableSize: 8,
                hasStraddle: false,
                buyIn: 40000,
                currentProfit: 169000,
                date: '2026-07-04'
              },
              hands: [
                { _id: 'old-profit', sessionId: id, currentProfit: 120000, createdAtMs: 1000 },
                { _id: 'hand-stack-after-win', sessionId: id, currentProfit: 49000, createdAtMs: 2000 }
              ]
            }
          }
          return {
            session: {
              _id: id || 'session-test',
              smallBlind: 200,
              bigBlind: 400,
              tableSize: 8,
              hasStraddle: false,
              buyIn: 40000,
              currentProfit: 1200,
              date: '2026-07-04'
            },
            hands: [
              { _id: 'old-1', sessionId: id || 'session-test', currentProfit: 1200 }
            ]
          }
        },
        async getHandById(id) {
          if (id === 'hand-before-table-change') {
            return {
              _id: id,
              sessionId: 'session-after-table-change',
              heroCardsInput: '9hJh',
              currentProfit: 21000,
              stakeLevel: '200/400',
              playerCount: 8,
              hasStraddle: false,
              playedDate: '2026-07-11 19:37'
            }
          }
          if (id === 'hand-stack-after-win') {
            return {
              _id: id,
              sessionId: 'session-stack-before-hand',
              heroCardsInput: 'AdKd',
              currentProfit: 49000,
              createdAtMs: 2000
            }
          }
          if (id === 'hand-with-inherited-position') {
            return {
              _id: id,
              sessionId: 'session-test',
              heroCardsInput: 'QsQd',
              heroPosition: 'BTN',
              currentProfit: -1200
            }
          }
          if (id === 'hand-ledger-edit') {
            return {
              _id: id,
              sessionId: 'session-test',
              heroCardsInput: 'AhAd',
              currentProfit: 1200,
              ledgerState: {
                version: 1,
                tableMax: '8',
                levelText: '200/400',
                hasStraddle: false,
                dealerSlot: 'BTN',
                heroSlot: 'SB',
                heroPosition: 'SB',
                heroCardsInput: 'AhAd',
                villainCards: 'KhKd',
                showdownResult: 'hero',
                board: { flop: 'Th9h8h', turn: '5d', river: '2c' },
                actions: [
                  { street: 'Pre', pos: 'SB', position: 'SB', action: 'Post', amount: 200 },
                  { street: 'Pre', pos: 'BB', position: 'BB', action: 'Post', amount: 400 },
                  { street: 'Pre', pos: 'BTN', position: 'BTN', action: 'Raise', amount: 1000 },
                  { street: 'Pre', pos: 'SB', position: 'SB', action: 'Call', amount: 800 },
                  { street: 'Pre', pos: 'BB', position: 'BB', action: 'Fold' }
                ],
                players: {
                  BTN: { live: true, paid: 1000, allIn: false, initialStack: 40000, stack: 39000 },
                  SB: { live: true, paid: 1000, allIn: false, initialStack: 41200, stack: 40200 },
                  BB: { live: false, paid: 400, allIn: false, initialStack: 40000, stack: 39600 }
                },
                pot: 2400,
                street: 'Flop',
                activeSlot: 'SB',
                profitSign: '+',
                profitDigits: '1200',
                autoProfit: 1200
              }
            }
          }
          return {
            _id: id,
            sessionId: 'session-test',
            heroCardsInput: 'KhQh',
            currentProfit: 0
          }
        },
        async createHand(payload) {
          savedPayload = payload
          return { _id: 'hand-created' }
        },
        async updateHandWithCloudSync(id, payload) {
          savedPayload = Object.assign({ _id: id }, payload)
        },
        async updateHand(id, patch) {
          updatedHandPatch = Object.assign({ _id: id }, patch)
        },
        async getAppSettings() {
          return {
            chipUnit: 'CNY',
            opponentTypes: ['紧弱', '松弱', '激进', '跟注站', '鱼', '常客', '职业']
          }
        },
        async getPlayerNotes() {
          return [
            {
              _id: 'note-regular-1',
              name: '老张',
              type: '常客',
              leakTags: ['跟注过宽'],
              note: 'river 会 bluff catch'
            },
            {
              _id: 'note-fish-1',
              name: '阿鱼',
              alias: ['fish'],
              avatarUrl: 'cloud://player-avatar-fish',
              avatarFileId: 'cloud://player-avatar-fish',
              avatarText: 'F',
              type: '鱼',
              leakTags: ['不弃顶对'],
              note: '翻前跟太宽'
            }
          ]
        },
        async createPlayerNote(payload) {
          createdPlayerNotePayload = payload
          return Object.assign({ _id: 'note-created-1' }, payload)
        },
        async addPlayerNoteBattleHand(noteId, handId) {
          linkedBattleHands.push({ noteId, handId })
          return { _id: noteId, battleHandIds: [handId] }
        }
      }
    }
    if (request.endsWith('../../services/ai-service')) {
      return {
        async reviewHandVoice(payload) {
          aiAdvicePayload = payload
          return {
            code: 0,
            analysis: {
              verdict: 'ok',
              keyTakeaway: 'continue'
            }
          }
        }
      }
    }
    if (request.endsWith('../../utils/card-ui')) {
      return { parseCardsInput }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
}

function restoreMocks() {
  Module._load = originalLoad
  global.setTimeout = originalSetTimeout
  delete global.Page
  delete global.wx
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function setByPath(target, key, value) {
  if (!key.includes('.')) {
    target[key] = value
    return
  }
  const parts = key.split('.')
  let cursor = target
  parts.slice(0, -1).forEach(part => {
    if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {}
    cursor = cursor[part]
  })
  cursor[parts[parts.length - 1]] = value
}

async function createPage(options = { sessionId: 'session-test' }) {
  installMocks()
  delete require.cache[pagePath]
  require(pagePath)
  assert(pageDefinition, 'Page definition should be registered')
  const page = Object.assign({}, pageDefinition)
  page.data = clone(pageDefinition.data)
  page.setData = patch => {
    Object.keys(patch || {}).forEach(key => setByPath(page.data, key, patch[key]))
  }
  Object.keys(pageDefinition).forEach(key => {
    if (typeof pageDefinition[key] === 'function') page[key] = pageDefinition[key].bind(page)
  })
  await page.onLoad(options)
  return page
}

function event(dataset = {}, value) {
  return { currentTarget: { dataset }, detail: { value } }
}

function flushAsyncWork() {
  return new Promise(resolve => setImmediate(resolve))
}

function chooseCards(page, tokens) {
  page.setData({ pickedTokens: tokens })
  page.doneCards()
}

function enterHeroCards(page, tokens = ['Kh', 'Qh']) {
  page.nextSetup()
  page.nextSetup()
  chooseCards(page, tokens)
  assert.strictEqual(page.data.phase, 'play')
}

function tapSeat(page, slot) {
  page.tapSeat(event({ slot }))
}

function longPressSeat(page, slot) {
  assert.strictEqual(typeof page.longPressSeat, 'function', 'long press seat handler should exist')
  page.longPressSeat(event({ slot }))
}

function action(page, code) {
  return page.tapAction(event({ action: code }))
}

function amountAction(page, code, amount) {
  if (code === 'AI') {
    return action(page, code)
  }
  action(page, code)
  page.onAmountInput({ detail: { value: String(amount) } })
  page.submitAmount()
}

function board(page, tokens) {
  assert(page.data.cardPickerVisible, 'board picker should be visible before selecting board cards')
  chooseCards(page, tokens)
}

function labelsForActiveSeats(page) {
  return page.data.seats.filter(seat => seat.active).map(seat => seat.label)
}

async function testButtonKeepsHeroSeatAndSeatOrder() {
  const page = await createPage()
  assert.strictEqual(page.data.levelText, '200/400')
  assert.strictEqual(page.data.tableMax, '8')
  assert.strictEqual(page.data.defaultStack, 41200)
  assert.strictEqual(page.data.defaultOpponentStack, 40000)
  assert.strictEqual(page.data.heroCardsInput, '')
  assert.strictEqual(page.data.players.HJ.stack, 41200)
  assert.strictEqual(page.data.players.BTN.stack, 40000)
  page.nextSetup()
  tapSeat(page, 'BTN')
  assert.strictEqual(page.data.dealerSlot, 'BTN')
  assert.strictEqual(page.data.heroSlot, 'HJ', 'moving button must not move hero seat')
  assert.strictEqual(page.data.heroPosition, 'HJ')
  assert.deepStrictEqual(labelsForActiveSeats(page), ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'MP', 'HJ', 'CO'])
  restoreMocks()
}

async function testSessionEditReturnAndHistoricalPlayedTime() {
  const page = await createPage({
    sessionId: 'session-test',
    returnTo: 'session-edit',
    playedDate: '2026-07-09%2015%3A00'
  })
  page.setData({
    heroCardsInput: 'AhAd',
    saved: false,
    saving: false
  })
  const payload = page.buildSavePayload()
  assert.strictEqual(payload.playedDate, '2026-07-09 15:00')
  assert.strictEqual(payload.createdAtMs, new Date('2026-07-09T15:00:00').getTime())
  await page.saveHand()
  assert(redirectToCall, 'session edit full entry should redirect after save')
  assert.strictEqual(redirectToCall.url, '/pages/session-detail/session-detail?id=session-test&edit=1')
  restoreMocks()
}

async function testInheritedHeroCardsSkipPickerStep() {
  const page = await createPage({ handId: 'hand-with-inherited-cards' })
  assert.strictEqual(page.data.heroCardsInput, 'KhQh')
  page.nextSetup()
  page.nextSetup()
  assert.strictEqual(page.data.phase, 'play', 'existing hero cards should advance directly into action entry')
  assert.strictEqual(page.data.cardPickerVisible, false, 'existing hero cards should not reopen the hero picker')
  assert.strictEqual(page.data.heroCardsInput, 'KhQh', 'skipping the picker should preserve inherited cards')
  restoreMocks()
}

async function testQuickRecordedPositionSeedsFullEntryHeroSeat() {
  const page = await createPage({ handId: 'hand-with-inherited-position' })
  assert.strictEqual(page.data.heroCardsInput, 'QsQd')
  assert.strictEqual(page.data.heroPosition, 'BTN', 'full entry should inherit the quick-recorded Hero position')
  assert.strictEqual(page.data.heroSlot, page.slotForPosition('BTN'), 'the inherited position should move Hero to the matching seat')
  assert.strictEqual(page.data.players[page.data.heroSlot].stack, page.data.defaultStack)
  restoreMocks()
}

async function testSitHereMovesHeroDuringSetup() {
  const page = await createPage()
  assert.strictEqual(page.data.phase, 'setup')
  assert.strictEqual(page.data.heroSlot, 'HJ')
  tapSeat(page, 'CO')
  assert.strictEqual(page.data.seatMenuVisible, true)
  page.pickSeatMenu(event({ action: 'sit' }))
  assert.strictEqual(page.data.heroSlot, 'CO')
  assert.strictEqual(page.data.heroPosition, 'CO')
  assert.strictEqual(page.data.players.CO.stack, page.data.defaultStack)
  assert.strictEqual(page.data.players.HJ.stack, page.data.defaultOpponentStack)
  assert.strictEqual(page.data.seatMenuVisible, false)
  restoreMocks()
}

async function testSeatMenuHidesInvalidActionsForHeroSeat() {
  const page = await createPage()
  page.openSeatMenu(page.data.heroSlot)
  assert.deepStrictEqual(
    page.data.seatMenuItems.map(item => item.action),
    ['stack', 'cards'],
    'hero seat menu should only keep stack and cards actions'
  )
  page.openSeatMenu('CO')
  assert.deepStrictEqual(
    page.data.seatMenuItems.map(item => item.action),
    ['sit', 'stack', 'cards', 'player'],
    'non-hero setup seat menu should still allow sit, stack, cards and player binding'
  )
  enterHeroCards(page)
  page.openSeatMenu('CO')
  assert.deepStrictEqual(
    page.data.seatMenuItems.map(item => item.action),
    ['stack', 'cards', 'player'],
    'play-state non-hero seat menu should not offer sit again'
  )
  restoreMocks()
}

async function testLedgerInheritsSessionStackSnapshotNotFinalCashout() {
  const page = await createPage({ sessionId: 'session-stack-snapshot' })
  assert.strictEqual(page.data.defaultStack, 100000, 'ledger should inherit the latest recorded stack before this hand, not final cashout')
  assert.strictEqual(page.data.players.HJ.initialStack, 100000)
  assert.strictEqual(page.data.players.HJ.stack, 100000)
  assert.strictEqual(page.data.players.BTN.stack, 40000, 'opponents should still default to 100bb')
  restoreMocks()
}

async function testLedgerEditUsesHeroStackBeforeSelectedHandResult() {
  const page = await createPage({ handId: 'hand-stack-after-win' })
  assert.strictEqual(page.data.defaultStack, 160000, 'editing a won hand should inherit the hero stack before that hand, not after adding this hand result')
  assert.strictEqual(page.data.players.HJ.initialStack, 160000)
  assert.strictEqual(page.data.players.HJ.stack, 160000)
  assert.strictEqual(page.data.players.BTN.stack, 40000, 'opponents should still default to 100bb')
  restoreMocks()
}

async function testStackSheetUsesSingleEffectiveStackAndBulkExcludesHero() {
  const page = await createPage()
  tapSeat(page, 'CO')
  page.pickSeatMenu(event({ action: 'stack' }))
  assert.strictEqual(page.data.stackSheetVisible, true)
  assert.strictEqual(page.data.stackEffectiveInput, '0')
  page.onStackInput(event({ key: 'stackEffectiveInput' }, '50000'))
  page.saveStackSheet()
  assert.strictEqual(page.data.players.CO.initialStack, 50000)
  assert.strictEqual(page.data.players.CO.stack, 50000)

  const heroSlot = page.data.heroSlot
  page.setData({
    seatMenuSlot: 'HJ',
    stackSheetVisible: true,
    stackEffectiveInput: '60000'
  })
  page.setAllStacks()
  assert.strictEqual(page.data.players[heroSlot].stack, page.data.defaultStack, 'bulk stack setting should not overwrite Hero')
  assert.strictEqual(page.data.players.BTN.stack, 60000)
  assert.strictEqual(page.data.players.CO.stack, 60000)
  restoreMocks()
}

async function testStackSheetStartsAtZeroAndKeepsBbPresets() {
  const page = await createPage()
  page.setData({ levelText: '300/600' })
  page.openSeatMenu('CO')
  page.pickSeatMenu(event({ action: 'stack' }))

  assert.strictEqual(page.data.stackEffectiveInput, '0', 'stack entry should start at zero for immediate custom input')
  assert.deepStrictEqual(
    page.data.stackPresets.map(item => item.value),
    [60000, 120000, 180000],
    'stack sheet should expose 100bb, 200bb and 300bb shortcuts'
  )

  page.confirmStackAmount({ detail: { value: 90000 } })
  assert.strictEqual(page.data.players.CO.initialStack, 90000)
  assert.strictEqual(page.data.players.CO.stackCustomized, true)

  page.openSeatMenu('CO')
  page.pickSeatMenu(event({ action: 'stack' }))
  assert.strictEqual(page.data.stackEffectiveInput, '0', 'reopening stack entry should still start at zero like Bet/Raise')
  restoreMocks()
}

async function testStackSecondaryActionSyncsOpponentsWithoutOverwritingHero() {
  const page = await createPage()
  const heroSlot = page.data.heroSlot
  const heroBefore = page.data.players[heroSlot].stack
  page.setData({ seatMenuSlot: 'CO', stackSheetVisible: true })
  page.syncStackAmount({ detail: { value: 80000 } })

  assert.strictEqual(page.data.players[heroSlot].stack, heroBefore, 'bulk stack setting must not overwrite Hero')
  assert.strictEqual(page.data.players.BTN.stack, 80000)
  assert.strictEqual(page.data.players.CO.stack, 80000)
  assert.strictEqual(page.data.players.BTN.stackCustomized, true)
  restoreMocks()
}

async function testPlayerSheetCanBindExistingPlayerNote() {
  const page = await createPage()
  const slot = page.slotForPosition('BTN')
  page.openSeatMenu(slot)
  page.pickSeatMenu(event({ action: 'player' }))
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.strictEqual(page.data.playerSheetVisible, true)
  assert.strictEqual(page.data.playerLibraryLoading, false)
  assert.strictEqual(page.data.playerLibraryOptions.length, 0, 'player sheet should not list all saved players before searching')

  page.onPlayerLibrarySearchInput({ detail: { value: 'fish' } })
  page.selectPlayerLibraryNote(event({ id: 'note-fish-1' }))

  assert.strictEqual(page.data.playerNameInput, '阿鱼')
  assert.strictEqual(page.data.playerNoteInput, '翻前跟太宽')
  assert.strictEqual(page.data.selectedPlayerNoteId, 'note-fish-1')
  page.savePlayerSheet()

  assert.strictEqual(page.data.players[slot].playerNoteId, 'note-fish-1')
  assert.strictEqual(page.data.players[slot].playerAvatarUrl, 'cloud://player-avatar-fish')
  assert.strictEqual(page.data.players[slot].playerAvatarFileId, 'cloud://player-avatar-fish')
  assert.strictEqual(page.data.players[slot].playerAvatarDisplayUrl, 'cloud://player-avatar-fish')
  assert.strictEqual(page.data.players[slot].playerName, '阿鱼')
  assert.strictEqual(page.data.players[slot].playerType, '鱼')
  const payload = page.buildSavePayload()
  const snapshot = payload.playerSnapshots.find(item => item.slot === slot)
  assert.strictEqual(snapshot.playerNoteId, 'note-fish-1', 'saved hand should keep player note id for later battle-hand linking')
  assert.strictEqual(snapshot.avatarUrl, 'cloud://player-avatar-fish')
  assert.strictEqual(snapshot.avatarFileId, 'cloud://player-avatar-fish')
  assert.strictEqual(snapshot.avatarDisplayUrl, 'cloud://player-avatar-fish')
  assert.strictEqual(snapshot.playerType, '鱼')
  await page.syncPlayerNoteBattleHands('hand-created')
  assert.deepStrictEqual(linkedBattleHands, [{ noteId: 'note-fish-1', handId: 'hand-created' }])
  restoreMocks()
}

async function testPlayerSheetSearchesPlayerLibraryByName() {
  const page = await createPage()
  const slot = page.slotForPosition('BTN')
  page.openSeatMenu(slot)
  page.pickSeatMenu(event({ action: 'player' }))
  await new Promise(resolve => setTimeout(resolve, 0))

  page.onPlayerLibrarySearchInput({ detail: { value: 'fish' } })

  assert.strictEqual(page.data.playerLibraryQuery, 'fish')
  assert.strictEqual(page.data.playerLibraryOptions.length, 1)
  assert.strictEqual(page.data.playerLibraryOptions[0]._id, 'note-fish-1')
  restoreMocks()
}

async function testPlayerSheetCanCreateAndBindPlayerNote() {
  const page = await createPage()
  const slot = page.slotForPosition('CO')
  page.openSeatMenu(slot)
  page.pickSeatMenu(event({ action: 'player' }))
  page.onPlayerInput(event({ key: 'playerNameInput' }, '新玩家'))
  page.onPlayerInput(event({ key: 'playerNoteInput' }, '喜欢 limp call'))

  await page.createAndBindPlayerNote()

  assert.deepStrictEqual(createdPlayerNotePayload, {
    name: '新玩家',
    note: '喜欢 limp call',
    type: '未分类',
    leakTags: []
  })
  assert.strictEqual(page.data.selectedPlayerNoteId, 'note-created-1')
  assert.strictEqual(page.data.players[slot].playerNoteId, 'note-created-1')
  assert.strictEqual(page.data.players[slot].playerName, '新玩家')
  assert.strictEqual(page.data.players[slot].playerNote, '喜欢 limp call')
  restoreMocks()
}

async function testPlayerSheetSaveCreatesPlayerNoteWhenNoExistingPlayerSelected() {
  const page = await createPage()
  const slot = page.slotForPosition('CO')
  page.openSeatMenu(slot)
  page.pickSeatMenu(event({ action: 'player' }))
  page.onPlayerInput(event({ key: 'playerNameInput' }, 'new-player'))
  page.selectPlayerType(event({ type: '职业' }))
  page.onPlayerInput(event({ key: 'playerNoteInput' }, 'note from ledger sheet'))

  await page.savePlayerSheet()

  assert.deepStrictEqual(createdPlayerNotePayload, {
    name: 'new-player',
    note: 'note from ledger sheet',
    type: '职业',
    leakTags: []
  })
  assert.strictEqual(page.data.players[slot].playerNoteId, 'note-created-1')
  assert.strictEqual(page.data.players[slot].playerName, 'new-player')
  assert.strictEqual(page.data.players[slot].playerType, '职业')
  restoreMocks()
}

async function testTapCurrentActionSeatOpensSeatMenu() {
  const page = await createPage()
  enterHeroCards(page)
  const active = page.data.activeSlot
  tapSeat(page, active)
  assert.strictEqual(page.data.activeSlot, active, 'tapping current actor should not change action state')
  assert.strictEqual(page.data.seatMenuVisible, true, 'current actor tap should open player options')
  assert.strictEqual(page.data.seatMenuSlot, active)
  restoreMocks()
}

async function testLongPressSeatDuringPlayOpensMenuWithoutJumpingAction() {
  const page = await createPage()
  enterHeroCards(page)
  const active = page.data.activeSlot
  const target = page.slotForPosition('BTN')
  longPressSeat(page, target)
  assert.strictEqual(page.data.activeSlot, active, 'long press should not jump action to the target seat')
  assert.strictEqual(page.data.seatMenuVisible, true, 'long press should open player options')
  assert.strictEqual(page.data.seatMenuSlot, target)
  assert.strictEqual(page.data.actions.filter(item => item.action === 'Fold').length, 0, 'long press should not auto-fold skipped players')
  restoreMocks()
}

async function testPostflopChecksDoNotSkipPlayers() {
  const page = await createPage()
  enterHeroCards(page)
  tapSeat(page, page.slotForPosition('BTN'))
  amountAction(page, 'R', 1000)
  action(page, 'C')
  action(page, 'C')
  assert.strictEqual(page.data.street, 'Flop')
  board(page, ['Th', '9h', '8h'])
  const first = page.data.activeLabel
  action(page, 'X')
  assert.strictEqual(page.data.street, 'Flop', 'flop must not end after only first check')
  assert.notStrictEqual(page.data.activeLabel, first, 'action should move to next player after check')
  action(page, 'X')
  assert.strictEqual(page.data.street, 'Flop', 'flop must not end until all live players checked')
  action(page, 'X')
  assert.strictEqual(page.data.street, 'Turn')
  assert(page.data.cardPickerVisible, 'turn board picker should open automatically')
  restoreMocks()
}

async function testSeatTapAfterClosedPreflopKeepsBoardPickerInsteadOfReopeningOpenerAction() {
  const page = await createPage()
  enterHeroCards(page)
  const opener = page.slotForPosition('BTN')
  tapSeat(page, opener)
  amountAction(page, 'R', 1000)
  action(page, 'F')
  action(page, 'C')
  assert.strictEqual(page.data.street, 'Flop')
  assert.strictEqual(page.data.cardPickerVisible, true, 'closed preflop should open the flop picker')
  const pendingActor = page.data.activeSlot
  tapSeat(page, opener)
  assert.strictEqual(page.data.street, 'Flop', 'tapping the opener after a closing call must not return to preflop')
  assert.strictEqual(page.data.cardPickerVisible, true, 'board picker should remain the required next step')
  assert.strictEqual(page.data.activeSlot, pendingActor, 'opener seat tap should not steal action before board selection')
  restoreMocks()
}

async function testFiveCardBoardDoesNotReopenTurnOrRiverPicker() {
  const page = await createPage()
  enterHeroCards(page)
  tapSeat(page, page.slotForPosition('BTN'))
  amountAction(page, 'R', 1000)
  action(page, 'C')
  action(page, 'C')
  assert.strictEqual(page.data.street, 'Flop')
  board(page, ['Th', '9h', '8h', '5d', '2c'])
  action(page, 'X')
  action(page, 'X')
  action(page, 'X')
  assert.strictEqual(page.data.street, 'Turn')
  assert.strictEqual(page.data.cardPickerVisible, false, 'turn picker should not reopen when turn card is already selected')
  assert(page.data.trail.some(item => item.sub === 'Turn' && item.main.indexOf('5') > -1), 'turn node should show the selected turn card')
  action(page, 'X')
  action(page, 'X')
  action(page, 'X')
  assert.strictEqual(page.data.street, 'River')
  assert.strictEqual(page.data.cardPickerVisible, false, 'river picker should not reopen when river card is already selected')
  assert(page.data.trail.some(item => item.sub === 'River' && item.main.indexOf('2') > -1), 'river node should show the selected river card')
  restoreMocks()
}

async function testJumpingTrailStreetUpdatesVisibleBoard() {
  const page = await createPage()
  enterHeroCards(page)
  tapSeat(page, page.slotForPosition('BTN'))
  amountAction(page, 'R', 1000)
  action(page, 'C')
  action(page, 'C')
  board(page, ['Th', '9h', '8h', '5d', '2c'])
  action(page, 'X')
  action(page, 'X')
  action(page, 'X')
  action(page, 'X')
  action(page, 'X')
  action(page, 'X')
  assert.strictEqual(page.data.street, 'River')
  const flopIndex = page.data.trail.findIndex(item => item.sub === 'Flop')
  assert(flopIndex >= 0, 'flop start node should exist')
  page.jumpToAction(event({ index: flopIndex }))
  assert.strictEqual(page.data.street, 'Flop')
  assert.deepStrictEqual(page.data.boardSlots.map(item => !!item.card), [true, true, true, true, true])
  assert.deepStrictEqual(page.data.boardSlots.map(item => !!item.dim), [false, false, false, true, true])
  assert.strictEqual(page.data.actions.some(item => item.street === 'Turn'), false, 'jumping to flop should truncate editable replay actions for re-entry')
  assert.strictEqual(page.data.trail.some(item => item.sub === 'Turn'), true, 'full timeline should remain visible while editing a previous node')
  restoreMocks()
}

async function testJumpingTrailReplaysPotAndBetsToSelectedNode() {
  const page = await createPage()
  enterHeroCards(page)
  tapSeat(page, page.slotForPosition('BTN'))
  amountAction(page, 'R', 1000)
  action(page, 'C')
  action(page, 'C')
  board(page, ['Qd', 'Td', '5d', '9c', 'Tc'])
  action(page, 'X')
  action(page, 'X')
  amountAction(page, 'B', 1600)
  action(page, 'C')
  action(page, 'C')
  assert.strictEqual(page.data.street, 'Turn')
  amountAction(page, 'B', 4163)
  action(page, 'C')
  action(page, 'C')
  assert.strictEqual(page.data.street, 'River')
  amountAction(page, 'B', 29829)
  action(page, 'C')
  const riverPot = page.data.pot
  assert(riverPot > 0)
  const flopStartIndex = page.data.trail.findIndex(item => item.sub === 'Flop')
  page.jumpToAction(event({ index: flopStartIndex }))
  assert.strictEqual(page.data.street, 'Flop')
  assert(page.data.pot < riverPot, 'pot should replay back to flop instead of keeping river amount')
  assert.strictEqual(Object.values(page.data.players).some(player => Number(player.paid) === 29829), false, 'river bet labels should disappear after jumping back to flop')
  restoreMocks()
}

async function testJumpingActionNodeReopensEditableActionState() {
  const page = await createPage()
  enterHeroCards(page)
  const btnSlot = page.slotForPosition('BTN')
  tapSeat(page, btnSlot)
  amountAction(page, 'R', 1000)
  action(page, 'C')
  assert(page.data.actions.some(item => item.action === 'Raise' && item.pos === btnSlot), 'button raise should be recorded before jumping')
  const raiseIndex = page.data.trail.findIndex(item => item.sub === 'BTN' && item.main.indexOf('Raise') > -1)
  assert(raiseIndex >= 0, 'button raise node should exist in timeline')
  page.jumpToAction(event({ index: raiseIndex }))
  assert.strictEqual(page.data.phase, 'play', 'jumping to an action node should show editable action controls')
  assert.strictEqual(page.data.activeSlot, btnSlot, 'selected action actor should become the active editable seat')
  assert.strictEqual(page.data.actions.some(item => item.action === 'Raise' && item.pos === btnSlot), false, 'selected action should be removed so it can be changed')
  assert(page.data.trail.some(item => item.sub === 'BTN' && item.main.indexOf('Raise') > -1), 'full timeline should remain visible while editing the selected node')
  assert.strictEqual(page.data.trail.find(item => item.sub === 'BTN' && item.main.indexOf('Raise') > -1).active, true, 'selected node should be highlighted as the current timeline node')
  assert(page.data.actionOptions.some(item => item.action === 'R'), 'editable raise option should be available for the selected node')
  restoreMocks()
}

async function testJumpingShowdownNodeKeepsShowdownChoices() {
  const page = await createPage()
  enterHeroCards(page, ['As', 'Kh'])
  const bbSlot = page.slotForPosition('BB')
  page.setData({
    phase: 'play',
    street: 'River',
    activeSlot: bbSlot,
    saved: true,
    showdownMode: false,
    actions: [
      { street: 'River', pos: bbSlot, position: 'BB', action: 'Show', cards: 'ThTd' }
    ],
    timelineActions: null
  })
  page.updateAll()
  const showIndex = page.data.trail.findIndex(item => item.sub === 'BB' && item.main === 'Show')
  assert(showIndex >= 0, 'show node should exist in timeline')

  page.jumpToAction(event({ index: showIndex }))

  assert.strictEqual(page.data.activeSlot, bbSlot, 'selected showdown actor should remain active')
  assert.strictEqual(page.data.showdownMode, true, 'selecting a Show node must restore showdown mode')
  assert.deepStrictEqual(page.data.actionOptions.map(item => item.action), ['MUCK', 'SHOW'])
  restoreMocks()
}

async function testNextNodeMovesToFollowingRecordedTimelineNode() {
  const page = await createPage()
  enterHeroCards(page)
  const btnSlot = page.slotForPosition('BTN')
  tapSeat(page, btnSlot)
  amountAction(page, 'R', 1000)
  action(page, 'C')
  const raiseIndex = page.data.trail.findIndex(item => item.sub === 'BTN' && item.main.indexOf('Raise') > -1)
  assert(raiseIndex >= 0, 'button raise node should exist before forward navigation')
  page.jumpToAction(event({ index: raiseIndex }))
  const nextNode = page.data.trail[raiseIndex + 1]
  assert(nextNode, 'a following recorded action should remain visible')
  page.goToNextNode()
  assert.strictEqual(page.data.selectedTrailIndex, raiseIndex + 1, 'next node should select the following recorded timeline node')
  assert.strictEqual(page.data.activeSlot, page.slotForPosition(nextNode.sub), 'following recorded actor should become editable')
  assert.strictEqual(page.data.street, 'Pre', 'next node must not force the next street')
  restoreMocks()
}

async function testNextNodeAtTimelineEndDoesNotSkipActionOrStreet() {
  const page = await createPage()
  enterHeroCards(page)
  tapSeat(page, page.slotForPosition('BTN'))
  amountAction(page, 'R', 1000)
  const streetBefore = page.data.street
  const actorBefore = page.data.activeSlot
  const actionsBefore = page.data.actions.length
  page.goToNextNode()
  assert.strictEqual(page.data.street, streetBefore, 'last node navigation must not force the next street')
  assert.strictEqual(page.data.activeSlot, actorBefore, 'last node navigation must not skip the player whose action is pending')
  assert.strictEqual(page.data.actions.length, actionsBefore, 'last node navigation must not invent a poker action')
  assert(lastToast && lastToast.title.indexOf('最后节点') > -1, 'last node navigation should explain why it cannot move forward')
  restoreMocks()
}

async function testJumpingLaterRaiseNodeUsesSelectedActorNotPreviousActor() {
  const page = await createPage()
  tapSeat(page, 'BB')
  page.pickSeatMenu(event({ action: 'sit' }))
  enterHeroCards(page, ['Kh', 'Kc'])
  const hjSlot = page.slotForPosition('HJ')
  const bbSlot = page.slotForPosition('BB')
  page.setData({ activeSlot: page.slotForPosition('BTN') })
  amountAction(page, 'R', 1600)
  page.setData({ activeSlot: page.slotForPosition('SB') })
  action(page, 'F')
  page.setData({ activeSlot: bbSlot })
  amountAction(page, 'R', 8500)
  page.setData({ activeSlot: hjSlot })
  amountAction(page, 'R', 22000)
  page.updateAll()
  const hjRaiseIndex = page.data.trail.findIndex(item => item.sub === 'HJ' && item.main.indexOf('Raise 22,000') > -1)
  assert(hjRaiseIndex >= 0, 'HJ raise node should exist in timeline')
  page.jumpToAction(event({ index: hjRaiseIndex }))
  assert.strictEqual(page.data.activeSlot, hjSlot, 'editing HJ node should make HJ the active actor')
  assert.strictEqual(page.data.activeLabel, 'HJ')
  assert(page.data.seats.find(item => item.slot === hjSlot).current, 'table current marker should be on HJ')
  assert(page.data.actionOptions.length > 0, 'HJ should have editable action options')
  assert(page.data.actionOptions.every(item => item.label.indexOf('BTN') === -1), 'action options should not be built for BTN')
  assert(page.data.trail.find(item => item.sub === 'HJ' && item.main.indexOf('Raise 22,000') > -1).active, 'HJ node should remain visible and active')
  restoreMocks()
}

async function testCompleteBetCallMuckSaveFlow() {
  const page = await createPage()
  enterHeroCards(page)
  tapSeat(page, page.slotForPosition('BTN'))
  page.setData({
    seatMenuSlot: page.slotForPosition('BTN'),
    selectedPlayerNoteId: 'note-regular-1',
    selectedPlayerType: '常客',
    selectedPlayerLeakTags: ['跟注过宽'],
    playerNameInput: '老张',
    playerNoteInput: 'river 会 bluff catch'
  })
  page.savePlayerSheet()
  amountAction(page, 'R', 1000)
  action(page, 'C')
  action(page, 'C')
  board(page, ['Th', '9h', '8h'])
  action(page, 'X')
  action(page, 'X')
  amountAction(page, 'B', 1200)
  action(page, 'C')
  action(page, 'F')
  assert.strictEqual(page.data.street, 'Turn')
  board(page, ['Th', '9h', '8h', '5d'])
  action(page, 'X')
  action(page, 'X')
  assert.strictEqual(page.data.street, 'River')
  board(page, ['Th', '9h', '8h', '5d', '2c'])
  action(page, 'X')
  action(page, 'X')
  assert.strictEqual(page.data.showdownMode, true)
  await action(page, 'MUCK')
  assert.strictEqual(page.data.saved, true)
  assert(savedPayload, 'save payload should be created')
  assert.strictEqual(savedPayload.heroPosition, page.data.heroPosition)
  assert.strictEqual(savedPayload.flop, 'Th9h8h')
  assert.strictEqual(savedPayload.turn, '5d')
  assert.strictEqual(savedPayload.river, '2c')
  assert.deepStrictEqual(savedPayload.board, { flop: 'Th9h8h', turn: '5d', river: '2c' })
  assert.strictEqual(savedPayload.currentProfit, 5400)
  assert.strictEqual(savedPayload.detailBackfilled, true)
  assert.strictEqual(savedPayload.reviewStatus, 'reviewed')
  assert.strictEqual(savedPayload.aiReviewStatus, 'generating')
  assert.strictEqual(savedPayload.inputMode, 'ledger_full')
  assert.strictEqual(savedPayload.reviewSource, 'ledger_full')
  assert.strictEqual(savedPayload.opponentPlayerNoteId, 'note-regular-1')
  assert.strictEqual(savedPayload.opponentName, '老张')
  assert.strictEqual(savedPayload.opponentType, '常客')
  assert.strictEqual(savedPayload.effectiveStack, 40000)
  assert(savedPayload.ledgerState, 'ledger state should be saved for future editing')
  assert.strictEqual(savedPayload.ledgerState.heroCardsInput, savedPayload.heroCardsInput)
  assert(Array.isArray(savedPayload.ledgerState.actions), 'ledger state should retain raw actions')
  assert(savedPayload.streetInputs.preflop.actionLine.includes('BTN raise 1000'))
  assert(savedPayload.streetInputs.flop.actionLine.includes('BTN bet 1200'))
  await flushAsyncWork()
  assert(aiAdvicePayload, 'AI advice should be requested after full ledger save')
  assert.strictEqual(aiAdvicePayload.mode, 'advice')
  assert.strictEqual(aiAdvicePayload.hand.heroCardsInput, savedPayload.heroCardsInput)
  assert(updatedHandPatch, 'AI advice result should update the saved hand')
  assert.strictEqual(updatedHandPatch.aiReviewStatus, 'ready')
  restoreMocks()
}

async function testAllInSettlementUsesEffectiveStack() {
  const page = await createPage()
  tapSeat(page, 'BTN')
  page.pickSeatMenu(event({ action: 'sit' }))
  enterHeroCards(page, ['Ah', 'Ad'])
  tapSeat(page, page.slotForPosition('BTN'))
  amountAction(page, 'R', 1000)
  action(page, 'F')
  action(page, 'C')
  assert.strictEqual(page.data.street, 'Flop')
  board(page, ['Th', '9h', '8h', '5d', '2c'])
  const heroSlot = page.data.heroSlot
  const villainSlot = page.slotForPosition('BB')
  const players = Object.assign({}, page.data.players)
  players[heroSlot] = Object.assign({}, players[heroSlot], { initialStack: 40000, stack: 39000, paid: 0 })
  players[villainSlot] = Object.assign({}, players[villainSlot], { initialStack: 6000, stack: 5000, paid: 0 })
  page.setData({ players, pot: 2000, lastRaise: 0, activeSlot: heroSlot })
  action(page, 'AI')
  action(page, 'C')
  assert.strictEqual(page.data.showdownMode, true)
  await action(page, 'MUCK')
  assert.strictEqual(page.data.saved, true)
  assert(savedPayload, 'save payload should be created')
  assert.strictEqual(savedPayload.currentProfit, 6000, 'hero win should be capped by villain effective stack already invested in the hand')
  restoreMocks()
}

async function testMultiwayHeroFoldLosesEveryContribution() {
  const page = await createPage()
  const actions = [
    { action: 'Post', amount: 300, pos: 'SB', street: 'Pre' },
    { action: 'Post', amount: 600, pos: 'BB', street: 'Pre' },
    { action: 'Raise', amount: 1500, pos: 'UTG1', street: 'Pre' },
    { action: 'Raise', amount: 5000, pos: 'MP', street: 'Pre' },
    { action: 'Call', amount: 5000, pos: 'CO', street: 'Pre' },
    { action: 'All-in', amount: 57000, pos: 'BTN', street: 'Pre' },
    { action: 'Call', amount: 56700, pos: 'SB', street: 'Pre' },
    { action: 'Call', amount: 52000, pos: 'MP', street: 'Pre' },
    { action: 'Call', amount: 52000, pos: 'CO', street: 'Pre' },
    { action: 'Start', pos: 'Flop', street: 'Flop' },
    { action: 'Start', pos: 'Turn', street: 'Turn' },
    { action: 'Bet', amount: 5000, pos: 'SB', street: 'Turn' },
    { action: 'Call', amount: 5000, pos: 'MP', street: 'Turn' },
    { action: 'Call', amount: 5000, pos: 'CO', street: 'Turn' },
    { action: 'Start', pos: 'River', street: 'River' },
    { action: 'Bet', amount: 40000, pos: 'CO', street: 'River' },
    { action: 'Fold', pos: 'SB', street: 'River' },
    { action: 'Fold', pos: 'MP', street: 'River' },
    { action: 'Show', cards: 'AdKc', pos: 'BTN', street: 'River' }
  ]
  page.setData({
    heroSlot: 'MP',
    heroCardsInput: '',
    villainCards: 'AdKc',
    actions
  })
  const result = page.calculateAutoProfit('Show', actions)
  assert.strictEqual(result.winner, 'villain', 'Hero cannot win or tie after folding in a multiway pot')
  assert.strictEqual(result.currentProfit, -62000, 'Hero loss must include preflop and turn contributions')
  restoreMocks()
}

async function testShowdownShowCalculatesWinnerFromCards() {
  const page = await createPage()
  tapSeat(page, 'BTN')
  page.pickSeatMenu(event({ action: 'sit' }))
  enterHeroCards(page, ['Ah', 'Ad'])
  tapSeat(page, page.slotForPosition('BTN'))
  amountAction(page, 'R', 1000)
  action(page, 'F')
  action(page, 'C')
  board(page, ['Th', '9h', '8h', '5d', '2c'])
  action(page, 'X')
  action(page, 'X')
  action(page, 'X')
  action(page, 'X')
  action(page, 'X')
  action(page, 'X')
  assert.strictEqual(page.data.showdownMode, true)
  action(page, 'SHOW')
  page.setData({ pickedTokens: ['Kh', 'Kd'] })
  await page.doneCards()
  assert.strictEqual(page.data.saved, true)
  assert(savedPayload, 'save payload should be created')
  assert(savedPayload.currentProfit > 0, 'hero aces should beat villain kings on this board')
  assert.strictEqual(savedPayload.showdownReason, 'hero')
  restoreMocks()
}

async function testShowUsesCardsAlreadySetOnActivePlayer() {
  const page = await createPage()
  enterHeroCards(page, ['Kh', 'Kc'])
  const villainSlot = page.slotForPosition('BTN')
  const players = Object.assign({}, page.data.players)
  players[villainSlot] = Object.assign({}, players[villainSlot], {
    live: true,
    cards: 'AhAd'
  })
  page.setData({
    players,
    activeSlot: villainSlot,
    showdownMode: true,
    street: 'River',
    board: { flop: '2h3d4c', turn: '5s', river: '9h' },
    villainCards: ''
  })
  await action(page, 'SHOW')
  assert.strictEqual(page.data.cardPickerVisible, false, 'Show should not reopen the picker when that player already has cards')
  assert.strictEqual(page.data.villainCards, 'AhAd', 'preset player cards should become the showdown cards')
  assert(savedPayload, 'preset player cards should allow immediate showdown save')
  assert(savedPayload.streetSummary.includes('BTN show AA'), 'saved action line should include the preset shown cards')
  restoreMocks()
}

async function testStraddleInitialState() {
  const page = await createPage()
  page.setStraddle(event({ value: '1' }))
  assert.strictEqual(page.data.hasStraddle, true)
  assert.strictEqual(page.data.pot, 1400)
  assert.strictEqual(page.data.lastRaise, 800)
  assert.strictEqual(page.data.activeLabel, 'UTG+1')
  restoreMocks()
}

async function testHeadsUpAllInMovesToShowdownChoices() {
  const page = await createPage()
  enterHeroCards(page)
  tapSeat(page, page.slotForPosition('BTN'))
  amountAction(page, 'R', 1000)
  action(page, 'F')
  action(page, 'C')
  assert.strictEqual(page.data.street, 'Flop')
  board(page, ['Th', '9h', '8h'])
  action(page, 'X')
  action(page, 'AI')
  action(page, 'C')
  assert.strictEqual(page.data.showdownMode, true)
  assert.deepStrictEqual(page.data.actionOptions.map(item => item.action), ['MUCK', 'SHOW'])
  restoreMocks()
}

async function testPreflopAllInCallMovesDirectlyToShowdown() {
  const page = await createPage()
  tapSeat(page, 'BTN')
  page.pickSeatMenu(event({ action: 'sit' }))
  enterHeroCards(page, ['Ah', 'Ad'])
  tapSeat(page, page.slotForPosition('HJ'))
  amountAction(page, 'R', 10500)
  tapSeat(page, page.slotForPosition('BTN'))
  amountAction(page, 'AI')
  action(page, 'F')
  action(page, 'F')
  action(page, 'C')
  assert.strictEqual(page.data.street, 'Pre', 'preflop all-in call should not advance to flop action')
  assert.strictEqual(page.data.showdownMode, true)
  assert.deepStrictEqual(page.data.actionOptions.map(item => item.action), ['MUCK', 'SHOW'])
  restoreMocks()
}

async function testShortAllInBelowRaiseTargetSettlesAsCall() {
  const page = await createPage()
  enterHeroCards(page, ['Kh', 'Kc'])
  const heroSlot = page.slotForPosition('UTG')
  const villainSlot = page.slotForPosition('BB')
  const players = Object.assign({}, page.data.players)
  Object.keys(players).forEach(slot => {
    players[slot] = Object.assign({}, players[slot], { live: slot === heroSlot || slot === villainSlot })
  })
  players[heroSlot] = Object.assign({}, players[heroSlot], {
    live: true,
    initialStack: 117500,
    stack: 95500,
    paid: 22000,
    allIn: false
  })
  players[villainSlot] = Object.assign({}, players[villainSlot], {
    live: true,
    initialStack: 109000,
    stack: 106500,
    paid: 2500,
    allIn: false
  })
  page.setData({
    heroSlot,
    players,
    activeSlot: heroSlot,
    street: 'Pre',
    phase: 'play',
    pot: 24500,
    lastRaise: 22000,
    actions: []
  })

  amountAction(page, 'R', 110000)
  assert.strictEqual(page.data.activeSlot, villainSlot, 'short stack should act after the 110k raise')
  action(page, 'AI')

  assert.strictEqual(page.data.showdownMode, true, 'short all-in below the raise target should settle heads-up action immediately')
  assert.strictEqual(page.data.street, 'Pre', 'settled preflop all-in should remain on preflop for board runout')
  assert.strictEqual(page.data.players[heroSlot].paid, 109000, 'uncalled 1k should be returned to the covering player')
  assert.strictEqual(page.data.players[heroSlot].stack, 8500, 'covering player should retain chips beyond the effective all-in')
  assert.strictEqual(page.data.players[villainSlot].paid, 109000)
  assert.strictEqual(page.data.players[villainSlot].stack, 0)
  assert.strictEqual(page.data.pot, 218000, 'heads-up pot should use the 109k effective contribution from both players')
  restoreMocks()
}

async function testPreflopAllInRequiresFullBoardBeforeShowdownSave() {
  const page = await createPage()
  tapSeat(page, 'BTN')
  page.pickSeatMenu(event({ action: 'sit' }))
  enterHeroCards(page, ['Ah', 'Ad'])
  tapSeat(page, page.slotForPosition('HJ'))
  amountAction(page, 'R', 10500)
  tapSeat(page, page.slotForPosition('BTN'))
  amountAction(page, 'AI')
  action(page, 'F')
  action(page, 'F')
  action(page, 'C')
  assert.strictEqual(page.data.showdownMode, true)
  action(page, 'SHOW')
  assert.strictEqual(page.data.cardPickerVisible, true, 'pre-river all-in should require board before showdown cards')
  assert.strictEqual(page.data.cardPickerTarget, 'board')
  assert.strictEqual(savedPayload, null)
  assert(lastToast && /公共牌/.test(lastToast.title), 'user should be told to fill board first')
  restoreMocks()
}

async function testPreflopAllInSaveIncludesDerivedDetailFields() {
  const page = await createPage()
  enterHeroCards(page, ['Ah', 'Ad'])
  tapSeat(page, page.slotForPosition('HJ'))
  amountAction(page, 'R', 10500)
  tapSeat(page, page.slotForPosition('BTN'))
  amountAction(page, 'AI')
  action(page, 'F')
  action(page, 'F')
  action(page, 'C')
  action(page, 'SHOW')
  board(page, ['Th', '9h', '8h', '5d', '2c'])
  page.setData({ pickedTokens: ['Kh', 'Kd'] })
  await page.doneCards()
  assert(savedPayload, 'save payload should be created')
  assert.strictEqual(savedPayload.villainPosition, 'BTN')
  assert.strictEqual(savedPayload.isAllIn, true)
  assert.strictEqual(savedPayload.allInStreet, 'preflop')
  assert.strictEqual(savedPayload.allInEvEligible, true)
  assert.strictEqual(savedPayload.allInEvStatus, 'calculated')
  assert.strictEqual(typeof savedPayload.allInEv, 'number')
  assert(savedPayload.allInPot > 0)
  assert(savedPayload.aiReviewStatus === 'generating')
  await flushAsyncWork()
  assert(aiAdvicePayload, 'AI advice should receive derived fields')
  assert.strictEqual(aiAdvicePayload.hand.villainPosition, 'BTN')
  assert.strictEqual(aiAdvicePayload.hand.isAllIn, true)
  assert.strictEqual(aiAdvicePayload.hand.allInStreet, 'preflop')
  restoreMocks()
}

async function testPreflopAllInUsesEffectiveStackAndPositiveEvAfterPriorRaise() {
  const page = await createPage()
  tapSeat(page, 'BB')
  page.pickSeatMenu(event({ action: 'sit' }))
  enterHeroCards(page, ['Kh', 'Kc'])
  const heroSlot = page.data.heroSlot
  const hjSlot = page.slotForPosition('HJ')
  const players = Object.assign({}, page.data.players)
  players[heroSlot] = Object.assign({}, players[heroSlot], { initialStack: 219100, stack: 219100, paid: 400 })
  players[hjSlot] = Object.assign({}, players[hjSlot], { initialStack: 50000, stack: 50000, paid: 0, cards: 'JhJc' })
  page.setData({
    players,
    heroCardsInput: 'KhKc',
    activeSlot: page.slotForPosition('UTG'),
    villainCards: 'JhJc'
  })
  action(page, 'F')
  page.setData({ activeSlot: page.slotForPosition('UTG+1') })
  action(page, 'F')
  page.setData({ activeSlot: page.slotForPosition('MP') })
  action(page, 'F')
  page.setData({ activeSlot: hjSlot })
  amountAction(page, 'R', 1600)
  tapSeat(page, heroSlot)
  action(page, 'AI')
  assert(page.data.actions[page.data.actions.length - 1].amount > 200000, 'hero over-shove should store the visible all-in amount')
  tapSeat(page, hjSlot)
  action(page, 'C')
  assert.strictEqual(page.data.actions[page.data.actions.length - 1].amount, 48400, 'short-stack all-in call should only invest remaining stack')
  assert.strictEqual(page.data.players[heroSlot].paid, 50000, 'deep-stack over-shove should be capped to the effective called amount on the table')
  assert.strictEqual(page.data.players[heroSlot].stack, 169100, 'uncalled over-shove chips should be returned to the deep stack')
  assert.strictEqual(page.data.players[hjSlot].stack, 0, 'short all-in caller should have zero stack behind')
  assert.strictEqual(page.data.seats.find(seat => seat.slot === hjSlot).stackText, '0', 'short all-in caller should visibly show zero chips behind')
  assert.strictEqual(page.data.pot, 100200, 'visible pot should use effective all-in chips, not the uncalled over-shove')
  const replay = page.replayActions(page.data.actions)
  assert.strictEqual(replay.players[heroSlot].paid, 50000, 'timeline replay should also cap deep-stack over-shove to the effective all-in amount')
  assert.strictEqual(replay.players[heroSlot].stack, 169100, 'timeline replay should return uncalled chips to the deep stack')
  assert.strictEqual(replay.players[hjSlot].stack, 0, 'timeline replay should keep the short all-in caller at zero behind')
  assert.strictEqual(replay.pot, 100200, 'timeline replay pot should use effective all-in chips')
  action(page, 'SHOW')
  page.setData({ pickedTokens: ['8h', '9c', '6s', '3h', '2d'] })
  await page.doneCards()
  assert.strictEqual(page.data.players[hjSlot].cards, 'JhJc', 'preset Show cards should remain visible on the table seat')
  assert(savedPayload, 'save payload should be created')
  assert(lastLoading, 'selecting Show should immediately surface a saving loading state')
  assert(lastLoading && lastLoading.title === '保存中', 'selecting Show should immediately surface a saving loading state')
  assert.strictEqual(hideLoadingCalled, true, 'successful save should close the saving loading state')
  assert(lastToast && lastToast.title === '手牌已保存', 'successful save should immediately toast completion')
  assert.strictEqual(savedPayload.effectiveStack, 50000)
  assert.strictEqual(savedPayload.potSize, 100200)
  assert.strictEqual(savedPayload.allInPot, 100200)
  assert.strictEqual(savedPayload.heroInvested, 50000)
  assert(savedPayload.rawAllInPot > savedPayload.allInPot, 'raw over-shove pot should be preserved separately')
  assert(savedPayload.rawHeroInvested > savedPayload.heroInvested, 'raw hero over-shove should be preserved separately')
  assert.strictEqual(savedPayload.allInStreet, 'preflop')
  assert(savedPayload.allInEv > 25000, 'KK vs JJ preflop all-in EV should use effective pot, not over-shove chips')
  assert(savedPayload.streetInputs.preflop.actionLine.includes('Hero BB all-in'), 'action line should mark Hero next to the hero position')
  assert(savedPayload.streetInputs.preflop.actionLine.includes('HJ show JJ'), 'showdown action line should include the showing position and cards')
  assert.strictEqual((savedPayload.streetInputs.preflop.actionLine.match(/show/g) || []).length, 1, 'showdown action line should include one show action')
  assert.strictEqual((savedPayload.streetSummary.match(/show/g) || []).length, 1, 'street summary should include one show action')
  assert.strictEqual(savedPayload.ledgerState.actions.filter(item => item.action === 'Show').length, 1, 'ledger snapshot should not duplicate show nodes')
  assert.strictEqual(savedPayload.streetInputs.preflop.actionLine.includes('UTG F'), false, 'preflop folded players should be hidden')
  assert.strictEqual(savedPayload.streetInputs.preflop.actionLine.includes('UTG+1 F'), false, 'preflop folded players should be hidden')
  assert.strictEqual(savedPayload.streetInputs.preflop.actionLine.includes('MP F'), false, 'preflop folded players should be hidden')
  assert.strictEqual(savedPayload.streetSummary.includes('UTG F'), false, 'street summary should hide preflop folds')
  assert(aiAdvicePayload, 'AI advice should receive full ledger payload')
  assert.strictEqual(aiAdvicePayload.hand.effectiveStack, 50000)
  assert.strictEqual(aiAdvicePayload.hand.potSize, 100200)
  assert.strictEqual(aiAdvicePayload.hand.allInPot, 100200)
  assert.strictEqual(aiAdvicePayload.hand.heroInvested, 50000)
  assert.strictEqual(aiAdvicePayload.hand.allInStreet, 'preflop')
  assert.strictEqual(aiAdvicePayload.hand.terminalStreet, 'preflop')
  assert.strictEqual(aiAdvicePayload.hand.postAllInRunoutOnly, true)
  assert.strictEqual(aiAdvicePayload.structuredHand.allInStreet, 'preflop')
  assert(aiAdvicePayload.question.includes('已经发生全下并终止后续决策'), 'AI request should explicitly constrain preflop all-in advice')
  assert(aiAdvicePayload.question.includes('不要给 flop/turn/river 后续行动建议'), 'AI request should prevent post-all-in street advice')
  assert(aiAdvicePayload.question.includes('Hero BB all-in'), 'AI request should include the canonical Hero-labeled action line')
  assert(aiAdvicePayload.hand.allInEv > 25000)
  restoreMocks()
}

async function testRepeatedShowdownSaveReplacesExistingShowNode() {
  const page = await createPage()
  tapSeat(page, 'BB')
  page.pickSeatMenu(event({ action: 'sit' }))
  enterHeroCards(page, ['Kh', 'Kc'])
  const heroSlot = page.data.heroSlot
  const hjSlot = page.slotForPosition('HJ')
  const players = Object.assign({}, page.data.players)
  players[heroSlot] = Object.assign({}, players[heroSlot], { initialStack: 219100, stack: 219100, paid: 400 })
  players[hjSlot] = Object.assign({}, players[hjSlot], { initialStack: 50000, stack: 0, paid: 50000, cards: 'JhJc' })
  page.setData({
    players,
    heroCardsInput: 'KhKc',
    villainCards: 'JhJc',
    street: 'Pre',
    activeSlot: hjSlot,
    actions: [
      { street: 'Pre', pos: hjSlot, position: 'HJ', action: 'Raise', amount: 22000 },
      { street: 'Pre', pos: heroSlot, position: 'BB', action: 'All-in', amount: 211000 },
      { street: 'Pre', pos: hjSlot, position: 'HJ', action: 'All-in', amount: 50000 },
      { street: 'Pre', pos: hjSlot, position: 'HJ', action: 'Show' }
    ]
  })
  await page.commitShowdown('Show')
  const showActions = savedPayload.ledgerState.actions.filter(item => item.action === 'Show')
  assert.strictEqual(showActions.length, 1, 're-saving a shown hand should replace the existing show node')
  assert.strictEqual(showActions[0].cards, 'JhJc', 'replacement show node should retain shown cards')
  assert(savedPayload.streetInputs.preflop.actionLine.includes('HJ show JJ'), 're-saved action line should include position and shown cards')
  assert.strictEqual((savedPayload.streetSummary.match(/show/g) || []).length, 1, 're-saved street summary should not duplicate show')
  restoreMocks()
}

async function testPreflopAllInWithDeadMoneyUsesEffectivePotForEvAndAdvice() {
  const page = await createPage()
  tapSeat(page, 'BB')
  page.pickSeatMenu(event({ action: 'sit' }))
  enterHeroCards(page, ['Kh', 'Kc'])
  const heroSlot = page.data.heroSlot
  const hjSlot = page.slotForPosition('HJ')
  const btnSlot = page.slotForPosition('BTN')
  const players = Object.assign({}, page.data.players)
  players[heroSlot] = Object.assign({}, players[heroSlot], { initialStack: 219100, stack: 219100, paid: 400 })
  players[hjSlot] = Object.assign({}, players[hjSlot], { initialStack: 50000, stack: 50000, paid: 0, cards: 'JhJc' })
  page.setData({
    players,
    heroCardsInput: 'KhKc',
    villainCards: 'JhJc'
  })
  action(page, 'F') // UTG
  action(page, 'F') // UTG+1
  action(page, 'F') // MP
  action(page, 'C') // HJ call 400
  action(page, 'F') // CO
  assert.strictEqual(page.data.activeSlot, btnSlot)
  amountAction(page, 'R', 1600)
  action(page, 'F') // SB
  amountAction(page, 'R', 8500) // Hero BB
  amountAction(page, 'R', 22000) // HJ
  action(page, 'F') // BTN
  action(page, 'AI') // Hero BB raw over-shove
  action(page, 'C') // HJ calls off to 50k
  assert.strictEqual(page.data.players[heroSlot].paid, 50000)
  assert.strictEqual(page.data.players[heroSlot].stack, 169100)
  assert.strictEqual(page.data.players[hjSlot].paid, 50000)
  assert.strictEqual(page.data.players[hjSlot].stack, 0)
  assert.strictEqual(page.data.pot, 101800, 'visible all-in pot should include effective heads-up stacks plus SB/BTN dead money')
  action(page, 'SHOW')
  page.setData({ pickedTokens: ['8c', '9c', '6s', '3h', '2h'] })
  await page.doneCards()
  await flushAsyncWork()
  assert(savedPayload, 'save payload should be created')
  assert.strictEqual(savedPayload.effectiveStack, 50000)
  assert.strictEqual(savedPayload.potSize, 101800)
  assert.strictEqual(savedPayload.allInPot, 101800)
  assert.strictEqual(savedPayload.heroInvested, 50000)
  assert(savedPayload.rawHeroInvested > 200000)
  assert(savedPayload.allInEv > 25000, 'KK vs JJ all-in EV should be based on effective risk, not the raw 211k over-shove')
  assert(aiAdvicePayload, 'AI advice should be requested after ledger save')
  assert.strictEqual(aiAdvicePayload.hand.analysisFocus, 'preflop_all_in')
  assert.strictEqual(aiAdvicePayload.hand.allInStreet, 'preflop')
  assert.strictEqual(aiAdvicePayload.hand.heroInvested, 50000)
  assert.strictEqual(aiAdvicePayload.hand.potSize, 101800)
  assert(aiAdvicePayload.question.includes('结构化行动线'), 'AI question should include ledger actions in the main prompt text')
  assert(aiAdvicePayload.question.includes('All-in EV'), 'AI question should include all-in EV context in the main prompt text')
  assert(aiAdvicePayload.question.includes('不要给 flop/turn/river 后续行动建议'), 'AI question should constrain advice to the preflop all-in decision')
  restoreMocks()
}

async function testOpponentShortStackAllInDoesNotCreateHeroAllInEv() {
  const page = await createPage()
  enterHeroCards(page, ['As', 'Kh'])
  const heroSlot = page.data.heroSlot
  const btnSlot = page.slotForPosition('BTN')
  const players = Object.assign({}, page.data.players)
  players[heroSlot] = Object.assign({}, players[heroSlot], { initialStack: 100000, stack: 38000, cards: 'AsKh' })
  players[btnSlot] = Object.assign({}, players[btnSlot], { initialStack: 57000, stack: 0, cards: 'AdKc' })
  page.setData({
    players,
    heroCardsInput: 'AsKh',
    villainCards: 'AdKc',
    board: { flop: 'QhJd4c', turn: '9c', river: '8s' },
    actions: [
      { street: 'Pre', pos: heroSlot, action: 'Raise', amount: 5000 },
      { street: 'Pre', pos: btnSlot, action: 'All-in', amount: 57000 },
      { street: 'Pre', pos: 'SB', action: 'Call', amount: 56700 },
      { street: 'Pre', pos: heroSlot, action: 'Call', amount: 52000 },
      { street: 'Pre', pos: 'CO', action: 'Call', amount: 52000 },
      { street: 'Flop', action: 'Start' },
      { street: 'Flop', pos: 'SB', action: 'Check' },
      { street: 'Flop', pos: heroSlot, action: 'Check' },
      { street: 'Flop', pos: 'CO', action: 'Check' },
      { street: 'Turn', action: 'Start' },
      { street: 'Turn', pos: 'SB', action: 'Bet', amount: 5000 },
      { street: 'Turn', pos: heroSlot, action: 'Call', amount: 5000 },
      { street: 'Turn', pos: 'CO', action: 'Call', amount: 5000 },
      { street: 'River', action: 'Start' },
      { street: 'River', pos: 'SB', action: 'Check' },
      { street: 'River', pos: heroSlot, action: 'Check' },
      { street: 'River', pos: 'CO', action: 'Bet', amount: 40000 },
      { street: 'River', pos: 'SB', action: 'Fold' },
      { street: 'River', pos: heroSlot, action: 'Fold' },
      { street: 'River', pos: btnSlot, action: 'Show' }
    ],
    autoProfit: -62000
  })

  const payload = page.buildSavePayload()

  assert.strictEqual(payload.isAllIn, false, 'a non-terminal short-stack all-in must not mark Hero as all-in')
  assert.strictEqual(payload.allInStreet, '')
  assert.strictEqual(payload.allInEvEligible, false)
  assert.strictEqual(payload.allInEvStatus, 'all_in_not_terminal')
  assert.strictEqual(payload.allInEv, '')
  assert.strictEqual(payload.allInEvProfit, '')
  assert.strictEqual(payload.heroEquityPct, '')
  assert.strictEqual(payload.terminalStreet, 'river')
  assert.strictEqual(payload.postAllInRunoutOnly, false)
  assert.strictEqual(payload.analysisFocus, '')
  restoreMocks()
}

async function testLedgerEditRestoresSavedReplayState() {
  const page = await createPage({ handId: 'hand-ledger-edit' })
  assert.strictEqual(page.data.mode, 'edit')
  assert.strictEqual(page.data.phase, 'play')
  assert.strictEqual(page.data.heroSlot, 'SB')
  assert.strictEqual(page.data.heroCardsInput, 'AhAd')
  assert.strictEqual(page.data.villainCards, 'KhKd')
  assert.strictEqual(page.data.players.BTN.cards, 'KhKd', 'edit mode should display saved villain cards on the villain seat')
  assert.deepStrictEqual(page.data.board, { flop: 'Th9h8h', turn: '5d', river: '2c' })
  assert(page.data.actions.some(item => item.action === 'Raise' && item.position === 'BTN'), 'saved action nodes should be restored')
  assert.strictEqual(page.data.pot, 2400)
  restoreMocks()
}

async function testPreflopAllInAfterSeatJumpMovesDirectlyToShowdown() {
  const page = await createPage()
  tapSeat(page, 'BTN')
  page.pickSeatMenu(event({ action: 'sit' }))
  enterHeroCards(page, ['Ah', 'Ad'])
  tapSeat(page, page.slotForPosition('HJ'))
  amountAction(page, 'R', 10500)
  tapSeat(page, page.slotForPosition('BTN'))
  amountAction(page, 'AI')
  tapSeat(page, page.slotForPosition('HJ'))
  action(page, 'C')
  assert.strictEqual(page.data.street, 'Pre', 'preflop all-in call after seat jump should not advance to flop action')
  assert.strictEqual(page.data.showdownMode, true)
  assert.deepStrictEqual(page.data.actionOptions.map(item => item.action), ['MUCK', 'SHOW'])
  restoreMocks()
}

async function testStraddleBigBlindCallCompletesPreflopAndOpensFlopPicker() {
  const page = await createPage()
  page.setData({
    levelText: '100/200',
    levelIndex: -1,
    tableMax: '8',
    tableIndex: 1,
    hasStraddle: true,
    defaultStack: 60000,
    defaultOpponentStack: 20000
  })
  page.resetHandState()
  tapSeat(page, 'UTG')
  page.pickSeatMenu(event({ action: 'sit' }))
  enterHeroCards(page, ['6h', '6s'])
  const utgSlot = page.slotForPosition('UTG')
  const bbSlot = page.slotForPosition('BB')
  assert.strictEqual(page.data.activeSlot, page.slotForPosition('UTG+1'), 'straddle hand should start after UTG')
  tapSeat(page, utgSlot)
  amountAction(page, 'R', 500)
  tapSeat(page, bbSlot)
  action(page, 'C')
  assert.strictEqual(savedPayload, null, 'BB completing the preflop call should not save the hand')
  assert.strictEqual(page.data.street, 'Flop', 'BB completing the preflop call should advance to flop')
  assert.strictEqual(page.data.cardPickerVisible, true, 'advancing to flop should prompt for board cards')
  assert.strictEqual(page.data.cardPickerTarget, 'board', 'flop prompt should use the board picker')
  restoreMocks()
}

async function testPreflopCompletingCallAdvancesStreetEvenIfPriorRaiserLiveFlagIsStale() {
  const page = await createPage()
  page.setData({
    levelText: '100/200',
    levelIndex: -1,
    tableMax: '8',
    tableIndex: 1,
    hasStraddle: true,
    defaultStack: 60000,
    defaultOpponentStack: 20000
  })
  page.resetHandState()
  tapSeat(page, 'UTG')
  page.pickSeatMenu(event({ action: 'sit' }))
  enterHeroCards(page, ['6h', '6s'])
  const utgSlot = page.slotForPosition('UTG')
  const bbSlot = page.slotForPosition('BB')
  tapSeat(page, utgSlot)
  amountAction(page, 'R', 500)
  tapSeat(page, bbSlot)
  const players = Object.assign({}, page.data.players)
  players[utgSlot] = Object.assign({}, players[utgSlot], { live: false })
  page.setData({ players, activeSlot: bbSlot })
  action(page, 'C')
  assert.strictEqual(savedPayload, null, 'a completing call against a stale-live raiser should not auto-save the hand')
  assert.strictEqual(page.data.street, 'Flop', 'a completing call should still advance to the flop')
  assert.strictEqual(page.data.cardPickerVisible, true, 'flop board picker should open after the completing call')
  restoreMocks()
}

async function testNoStraddleBigBlindCompletingCallAdvancesToFlop() {
  const page = await createPage()
  page.setData({
    levelText: '100/200',
    levelIndex: -1,
    tableMax: '8',
    tableIndex: 1,
    hasStraddle: false,
    defaultStack: 60000,
    defaultOpponentStack: 20000
  })
  page.resetHandState()
  tapSeat(page, page.slotForPosition('UTG'))
  page.pickSeatMenu(event({ action: 'sit' }))
  enterHeroCards(page, ['6h', '6s'])
  const utgSlot = page.slotForPosition('UTG')
  const bbSlot = page.slotForPosition('BB')
  assert.strictEqual(page.data.activeSlot, utgSlot, 'no-straddle preflop should start from UTG')
  amountAction(page, 'R', 500)
  tapSeat(page, bbSlot)
  action(page, 'C')
  assert.strictEqual(savedPayload, null, 'BB call 300 against UTG open should not save the hand')
  assert.strictEqual(page.data.street, 'Flop', 'BB completing the preflop call should advance to flop')
  assert.strictEqual(page.data.cardPickerVisible, true, 'flop board picker should open after BB completes the call')
  assert.strictEqual(page.data.cardPickerTarget, 'board', 'flop prompt should use the board picker')
  restoreMocks()
}

async function testCompletingCallRestoresMisfoldedRaiserWithMatchingPaidAmount() {
  const page = await createPage()
  page.setData({
    levelText: '100/200',
    levelIndex: -1,
    tableMax: '8',
    tableIndex: 1,
    hasStraddle: false,
    defaultStack: 60000,
    defaultOpponentStack: 20000
  })
  page.resetHandState()
  tapSeat(page, page.slotForPosition('UTG'))
  page.pickSeatMenu(event({ action: 'sit' }))
  enterHeroCards(page, ['6h', '6s'])
  const utgSlot = page.slotForPosition('UTG')
  const bbSlot = page.slotForPosition('BB')
  amountAction(page, 'R', 500)
  tapSeat(page, bbSlot)
  const players = Object.assign({}, page.data.players)
  players[utgSlot] = Object.assign({}, players[utgSlot], { live: false })
  page.setData({
    players,
    activeSlot: bbSlot,
    actions: page.data.actions.concat({
      street: 'Pre',
      pos: utgSlot,
      position: page.displayLabel(utgSlot),
      action: 'Fold'
    })
  })
  action(page, 'C')
  assert.strictEqual(savedPayload, null, 'a completing call should not save even if the opener has a stale fold marker')
  assert.strictEqual(page.data.street, 'Flop', 'stale folded opener should be restored and the hand should advance to flop')
  assert.strictEqual(page.data.cardPickerVisible, true, 'flop board picker should open after restoring the opener')
  restoreMocks()
}

async function testRaiseForRemainingStackCountsAsAllIn() {
  const page = await createPage()
  tapSeat(page, 'BTN')
  page.pickSeatMenu(event({ action: 'sit' }))
  enterHeroCards(page, ['Ah', 'Ad'])
  tapSeat(page, page.slotForPosition('HJ'))
  amountAction(page, 'R', 10500)
  tapSeat(page, page.slotForPosition('BTN'))
  amountAction(page, 'R', page.data.players[page.data.activeSlot].stack)
  tapSeat(page, page.slotForPosition('HJ'))
  action(page, 'C')
  assert.strictEqual(page.data.street, 'Pre', 'raise for full stack should not advance to flop action')
  assert.strictEqual(page.data.showdownMode, true)
  assert(page.data.actions.some(item => item.action === 'All-in'), 'full-stack raise should be stored as all-in')
  restoreMocks()
}

async function testAmountSheetStartsAtZeroAndAcceptsImmediateDigits() {
  const page = await createPage()
  enterHeroCards(page)

  page.openAmountSheet('R')
  assert.strictEqual(page.data.amountInput, '0', 'amount sheet should start at zero instead of selecting the first preset')

  ;['2', '0', '0', '0'].forEach(digit => page.appendAmountDigit(event({ digit })))
  assert.strictEqual(page.data.amountInput, '2000', 'the first digit should replace zero and later digits should append')

  page.pickAmountPreset(event({ value: 1200 }))
  assert.strictEqual(page.data.amountInput, '1200', 'preset buttons should still replace the current amount directly')
}

async function testBetCreatesTransientChipFlightAnimation() {
  const page = await createPage()
  enterHeroCards(page)
  tapSeat(page, page.slotForPosition('BTN'))
  amountAction(page, 'R', 1000)
  assert(Array.isArray(page.data.chipFlights), 'chip flight list should exist')
  assert(page.data.lastChipFlight, 'investing chips should create a transient chip flight')
  assert(page.data.lastChipFlight.style.includes('left:'), 'chip flight should carry a start position')
  restoreMocks()
}

async function testStreetAdvanceCreatesCollectionAndDealAnimations() {
  const page = await createPage()
  enterHeroCards(page)
  tapSeat(page, page.slotForPosition('BTN'))
  amountAction(page, 'R', 1000)
  action(page, 'C')
  action(page, 'C')
  assert.strictEqual(page.data.street, 'Flop')
  assert(page.data.lastChipCollect, 'advancing street should animate collecting live bets into the pot')
  assert(page.data.lastChipCollect.count >= 1, 'chip collect animation should include at least one contribution')
  board(page, ['Th', '9h', '8h'])
  assert(page.data.lastDealAnimation, 'selecting board cards should trigger a deal animation')
  assert.strictEqual(page.data.lastDealAnimation.street, 'Flop')
  restoreMocks()
}

async function testActionFlowAndTimelineFollowCurrentNode() {
  const page = await createPage()
  enterHeroCards(page)
  assert(page.data.turnFlowStyle.includes('left:'), 'current action seat should expose a movable flow style')
  tapSeat(page, page.slotForPosition('BTN'))
  amountAction(page, 'R', 1000)
  assert(page.data.trail.length > 0, 'timeline should include action nodes')
  assert.strictEqual(page.data.trail[page.data.trail.length - 1].active, true, 'latest timeline node should be active for auto-follow')
  restoreMocks()
}

function testTimelineIsSharedAbovePhaseDocks() {
  const wxml = fs.readFileSync(wxmlPath, 'utf8')
  const wxss = fs.readFileSync(path.resolve(__dirname, '../pages/hand-ledger-input/hand-ledger-input.wxss'), 'utf8')
  const streetIndex = wxml.indexOf('class="street-tabs"')
  const trailIndex = wxml.indexOf('class="trail"')
  const setupIndex = wxml.indexOf("phase === 'setup'")
  const playIndex = wxml.indexOf('class="play-dock"')
  assert(streetIndex > -1, 'street tabs should exist')
  assert(trailIndex > -1, 'timeline should exist')
  assert(setupIndex > -1, 'setup dock should exist')
  assert(playIndex > -1, 'play dock should exist')
  assert(trailIndex > streetIndex, 'timeline should render directly after street tabs')
  assert(trailIndex < setupIndex, 'timeline should render before setup dock instead of inside play dock')
  assert(playIndex > trailIndex, 'play dock should render after shared timeline')
  assert(wxml.includes('show-scrollbar="{{false}}"'), 'timeline scroll-view should not show a horizontal scrollbar')
  assert(wxml.includes('enhanced="true"'), 'timeline should use enhanced scroll-view behavior on mobile')
  assert(/\.timeline-zone\s*\{[^}]*min-height:\s*1(?:0[4-9]|[1-9][0-9])rpx/.test(wxss), 'timeline zone should be tall enough that active nodes are not clipped')
  assert(/\.trail-card\s*\{[^}]*height:\s*(?:6[4-9]|[7-9][0-9])rpx/.test(wxss), 'timeline cards should leave room for main and sub labels')
  assert(/\.trail::\-webkit-scrollbar\s*\{[^}]*display:\s*none/.test(wxss), 'timeline scrollbar fallback must target the scroll-view itself')
  assert(/\.trail-inner\s*\{[^}]*padding:\s*[^;}]*2[4-9]rpx/.test(wxss), 'timeline should keep enough horizontal edge padding for first and last nodes')
  assert(/\.timeline-zone\s*\{[^}]*overflow:\s*hidden/.test(wxss), 'timeline zone should clip native scrollbar artifacts without clipping nodes')
}

function testCardsRenderInsideStableSeatUnits() {
  const wxml = fs.readFileSync(wxmlPath, 'utf8')
  const wxss = fs.readFileSync(path.resolve(__dirname, '../pages/hand-ledger-input/hand-ledger-input.wxss'), 'utf8')
  assert(wxml.includes('class="seat-unit seat-unit-{{item.sizeClass}}'), 'each player should render as a stable seat unit')
  assert(wxml.includes('class="seat-cards-inline"'), 'known cards should render inside the seat unit')
  assert(wxml.includes('class="seat-avatar-img"'), 'linked player avatars should render inside the seat unit')
  assert(wxml.includes('avatar-badge'), 'avatar seats should keep the position visible as an in-seat badge')
  assert.strictEqual(wxml.includes('class="seat-cards seat-cards-'), false, 'opponent cards should not use a floating table layer')
  assert.strictEqual(wxml.includes('class="hero-cards hero-cards-'), false, 'Hero cards should not use a floating table layer')
  assert(/\.seat-player-name\s*\{[^}]*text-overflow:\s*ellipsis/.test(wxss), 'long player names should stay inside the fixed seat width')
  assert(/\.seat-avatar-wrap\s*\{[^}]*border-radius:\s*50%/.test(wxss), 'player avatars should be clipped to the circular seat')
  assert(/\.seat-position\.avatar-badge\s*\{/.test(wxss), 'avatar seats should have a dedicated position badge style')
}

function testIntegratedSeatsPreserveCenterAndBetSafety() {
  const wxml = fs.readFileSync(wxmlPath, 'utf8')
  const wxss = fs.readFileSync(path.resolve(__dirname, '../pages/hand-ledger-input/hand-ledger-input.wxss'), 'utf8')
  assert(wxml.includes('catchtap="openHeroPicker"'), 'Hero cards should remain directly editable inside the Hero seat')
  assert(/\.center\s*\{[^}]*z-index:\s*5/.test(wxss), 'center pot and board content should keep an explicit layer')
  assert(/\.bet\s*\{[^}]*max-width:\s*(?:1[7-9][0-9]|200)rpx/.test(wxss), 'bet labels should keep a stable but readable width bound')
  assert.strictEqual(/\.bet\s*\{[^}]*text-overflow:\s*ellipsis/.test(wxss), false, 'bet amounts should never be truncated')
  assert(/\.table\s*\{[^}]*overflow:\s*hidden/.test(wxss), 'seat metadata must not create a table scrollbar')
}

function testLedgerUsesSharedAmountSheetsAndExpandedActiveSeatLayout() {
  const wxml = fs.readFileSync(wxmlPath, 'utf8')
  const wxss = fs.readFileSync(path.resolve(__dirname, '../pages/hand-ledger-input/hand-ledger-input.wxss'), 'utf8')
  assert.strictEqual((wxml.match(/<numeric-amount-sheet/g) || []).length, 2, 'stack and action amounts should share one reusable component')
  assert.strictEqual(wxml.includes('class="amount-keypad"'), false, 'page should not keep a duplicate inline keypad')
  assert.strictEqual(wxml.includes('class="turn-flow"'), false, 'current action should highlight the seat instead of using a floating dot')
  assert(/\.page\s*\{[^}]*padding:[^;}]*calc\((?:2[4-9][0-9]|3[0-1][0-9])rpx\s*\+\s*env\(safe-area-inset-bottom\)\)/.test(wxss), 'page should reserve only the actual play dock height')
  assert(/\.ring\s*\{[^}]*height:\s*calc\(100%\s*-\s*(?:[0-9]|1[0-2])rpx\)/.test(wxss), 'table ring should use the newly available vertical space')
  assert(/\.seat-unit-large\s*\{[^}]*width:\s*1(?:2[8-9]|[3-9][0-9])rpx/.test(wxss), 'large seats should be visibly larger')
  assert(/\.seat-unit-large\s*\{[^}]*width:\s*1(?:4[0-9]|[5-9][0-9])rpx/.test(wxss), 'large seats should use more of the available table edge')
  assert(/\.seat-unit-large\s+\.seat-card\s*\{[^}]*width:\s*(?:5[0-9]|[6-9][0-9])rpx/.test(wxss), 'cards inside large seats should scale with the enlarged seat')
  assert(/\.seat-unit\.current\s+\.seat-body::before\s*\{/.test(wxss), 'current seat should have a stable inner cyan-green lock ring')
  assert(/\.seat-unit\.current\s+\.seat-body::after\s*\{/.test(wxss), 'current action seat should own an independent outer highlight ring')
  assert(/@keyframes\s+activeSeatPulse/.test(wxss), 'current action highlight should animate without moving the seat')
  assert(/@keyframes\s+activeSeatRipple/.test(wxss), 'current action seat should have a separate expanding ripple')
}

function testLedgerViewportAndTimelineDoNotExposeScrollbars() {
  const wxml = fs.readFileSync(wxmlPath, 'utf8')
  const wxss = fs.readFileSync(path.resolve(__dirname, '../pages/hand-ledger-input/hand-ledger-input.wxss'), 'utf8')
  assert(wxml.includes('scroll-into-view="{{trailIntoView}}"'), 'timeline should keep the selected node fully in view')
  assert(/page\s*\{[^}]*height:\s*100%[^}]*overflow:\s*hidden/.test(wxss), 'miniapp page should not expose a vertical scrollbar')
  assert(/\.page\s*\{[^}]*height:\s*100vh[^}]*display:\s*flex[^}]*overflow:\s*hidden/.test(wxss), 'ledger should fit table, streets, and timeline into one viewport')
  assert(/\.table\s*\{[^}]*flex:\s*1[^}]*min-height:\s*0/.test(wxss), 'table should consume remaining viewport height instead of forcing page scroll')
}

function testPlayDockUsesCompactNodeNavigationAndNoActionSubLabels() {
  const wxml = fs.readFileSync(wxmlPath, 'utf8')
  const wxss = fs.readFileSync(path.resolve(__dirname, '../pages/hand-ledger-input/hand-ledger-input.wxss'), 'utf8')
  assert.strictEqual(wxml.includes('class="action-sub"'), false, 'action buttons should not repeat the active position label')
  assert(wxml.includes('bindtap="goToNextNode"'), 'forward navigation should follow recorded nodes rather than force the next street')
  assert.strictEqual(wxml.includes('bindtap="manualNextStreet"'), false, 'next node control must not keep the old force-street binding')
  assert(wxml.includes('class="prompt-live-dot"'), 'current actor prompt should include a visible live-state marker')
  assert(wxml.includes('class="small-btn" bindtap="closeCardPicker">←</view>'), 'card picker back control should use a plain left arrow')
  assert(wxml.includes('←上一节点'), 'back navigation should use compact left-arrow copy')
  assert(wxml.includes('下一节点→'), 'forward navigation should use compact right-arrow copy')
  assert(/\.prompt\s*\{[^}]*grid-template-columns:\s*150rpx\s+1fr\s+150rpx/.test(wxss), 'back and next node buttons should use matching widths')
  assert(/\.prompt-text\s*\{[^}]*text-align:\s*center/.test(wxss), 'current actor label should be centered')
  assert(/\.prompt-text\.live\s*\{[^}]*border:\s*none/.test(wxss), 'current actor prompt should not render an outer green frame')
  assert(/\.prompt-text\.live\s*\{[^}]*background:\s*transparent/.test(wxss), 'current actor prompt should keep only its live dot and text')
  assert(/\.prompt-text\.live\s*\{[^}]*color:\s*#fff(?:fff)?/.test(wxss), 'current actor prompt text should be white')
  assert(/\.prompt-live-dot\s*\{[^}]*animation:\s*activePromptPulse/.test(wxss), 'current actor prompt should pulse without moving its label')
  assert(/\.trail-card\.active\s*\{[^}]*height:\s*(?:7[4-9]|[8-9][0-9])rpx/.test(wxss), 'selected timeline node should be visibly taller')
}

function testCompactLedgerHeaderIsRemovedForTableSpace() {
  const wxml = fs.readFileSync(wxmlPath, 'utf8')
  assert.strictEqual(wxml.includes('class="topbar"'), false, 'in-page duplicate topbar should be removed')
  assert.strictEqual(wxml.includes('class="meta"'), false, 'in-page meta chips should be removed to give table more room')
}

function testSavingStateHasVisibleOverlay() {
  const wxml = fs.readFileSync(wxmlPath, 'utf8')
  assert(wxml.includes('wx:if="{{saving}}"'), 'saving state should have visible in-page feedback, not only a hidden header')
  assert(wxml.includes('saving-mask'), 'saving state should show an overlay so users do not feel Show/Muck is unresponsive')
}

function testPlayerLibraryEntryBelongsToPlayerSheet() {
  const wxml = fs.readFileSync(wxmlPath, 'utf8')
  const playerSheetIndex = wxml.indexOf('class="player-sheet"')
  const stackSheetIndex = wxml.indexOf('class="stack-sheet"')
  const libraryIndex = wxml.indexOf('player-library-block')
  assert(libraryIndex > playerSheetIndex, 'player library entry should be inside the player sheet')
  assert(libraryIndex > stackSheetIndex, 'player library entry should not be inside the stack sheet')
}

function testPlayerLibraryUsesReadableAvatarRows() {
  const wxml = fs.readFileSync(wxmlPath, 'utf8')
  const wxss = fs.readFileSync(path.resolve(__dirname, '../pages/hand-ledger-input/hand-ledger-input.wxss'), 'utf8')
  assert(wxml.includes('class="player-library-scroll"'), 'player search results should keep a bounded scroll container')
  assert(wxml.includes('scroll-y="true"'), 'player search results should scroll vertically')
  assert(wxml.includes('show-scrollbar="{{false}}"'), 'player search results should hide the native scrollbar')
  assert.strictEqual(wxml.includes('class="player-library-scroll" scroll-x="true"'), false, 'player results should not use truncated horizontal chips')
  assert(wxml.includes('class="player-library-avatar-img"'), 'player result should render the saved avatar')
  assert(wxml.includes('class="player-library-avatar-text"'), 'player result should keep a readable avatar fallback')
  assert(wxml.includes('class="player-library-selected"'), 'selected player result should have an explicit indicator')
  assert(/\.player-library-scroll\s*\{[^}]*max-height:\s*(?:3[0-9]{2}|4[0-4][0-9])rpx/.test(wxss), 'player result list should be tall enough for multiple identifiable rows')
  assert(/\.player-library-name\s*\{[^}]*white-space:\s*normal/.test(wxss), 'full player names should wrap instead of ellipsizing horizontally')
  assert(/\.player-library-name\s*\{[^}]*-webkit-line-clamp:\s*2/.test(wxss), 'long player names should use two readable lines')
}

function percentFromStyle(style, key) {
  const match = String(style || '').match(new RegExp(key + ':([0-9.]+)%'))
  return match ? Number(match[1]) : 0
}

function pointDistanceFromStyles(leftStyle, rightStyle) {
  const dx = percentFromStyle(leftStyle, 'left') - percentFromStyle(rightStyle, 'left')
  const dy = percentFromStyle(leftStyle, 'top') - percentFromStyle(rightStyle, 'top')
  return Math.sqrt(dx * dx + dy * dy)
}

function distanceFromTableCenter(style) {
  const dx = percentFromStyle(style, 'left') - 50
  const dy = percentFromStyle(style, 'top') - 50
  return Math.sqrt(dx * dx + dy * dy)
}

async function testTableLayoutUsesEdgeSeatsAndSeparatedBetLane() {
  const page = await createPage()
  const activeSeats = page.data.seats.filter(seat => seat.active)
  const co = activeSeats.find(seat => seat.slot === 'CO')
  const sb = activeSeats.find(seat => seat.slot === 'SB')
  const bb = activeSeats.find(seat => seat.slot === 'BB')
  assert(co && sb && bb, 'layout test needs representative edge seats')
  assert(percentFromStyle(co.seatStyle, 'top') <= 10, 'top seat should sit on the table edge with status-bar clearance')
  assert(percentFromStyle(sb.seatStyle, 'left') > 88, 'right seat should sit near the table edge')
  assert(percentFromStyle(sb.betStyle, 'left') < percentFromStyle(sb.seatStyle, 'left'), 'bet labels should stay on the inner betting lane')
  assert(percentFromStyle(co.betStyle, 'top') > percentFromStyle(co.seatStyle, 'top'), 'top bet labels should stay below the top seat and away from the status bar')
  activeSeats.forEach(seat => {
    assert(pointDistanceFromStyles(seat.seatStyle, seat.betStyle) >= 12, seat.slot + ' bet should stay on a separate inner lane')
    assert(distanceFromTableCenter(seat.betStyle) < distanceFromTableCenter(seat.seatStyle), seat.slot + ' bet should stay closer to the table center than its seat')
  })
  restoreMocks()
}

async function testBetAnchorsAvoidAvatarAndCardSeats() {
  const page = await createPage()
  const players = Object.assign({}, page.data.players, {
    SB: Object.assign({}, page.data.players.SB, {
      paid: 300,
      playerName: 'mgm wg 大鱼',
      playerAvatarUrl: 'cloud://avatar-sb'
    }),
    BB: Object.assign({}, page.data.players.BB, {
      paid: 600,
      cards: '5s5c',
      playerName: 'Hero'
    })
  })
  page.setData({ players })
  page.updateAll()
  const smallBlind = page.data.seats.find(seat => seat.slot === 'SB')
  const bigBlind = page.data.seats.find(seat => seat.slot === 'BB')
  assert.strictEqual(smallBlind.betPlacement, 'seat-right', 'SB amount should attach to the left of its right-edge avatar')
  assert.strictEqual(bigBlind.betPlacement, 'seat-right', 'BB amount should attach to the left of its right-edge cards')
  assert(pointDistanceFromStyles(smallBlind.seatStyle, smallBlind.betStyle) >= 17, 'avatar amount should clear the circular seat and name')
  assert(pointDistanceFromStyles(bigBlind.seatStyle, bigBlind.betStyle) >= 17, 'card amount should clear the circular seat and cards')
  restoreMocks()
}

async function testSeatViewOwnsCardsAndUsesIndependentBetAnchor() {
  const page = await createPage()
  const heroSlot = page.data.heroSlot
  const players = Object.assign({}, page.data.players, {
    BTN: Object.assign({}, page.data.players.BTN, {
      cards: 'QsQd',
      playerName: 'Long Player Name'
    })
  })
  page.setData({ heroCardsInput: 'AhKd', players })
  page.updateAll()
  const hero = page.data.seats.find(item => item.slot === heroSlot)
  const button = page.data.seats.find(item => item.slot === 'BTN')
  assert.strictEqual(hero.cardsVisual.length, 2, 'Hero cards should belong to the Hero seat view')
  assert.strictEqual(button.cardsVisual.length, 2, 'opponent cards should belong to the opponent seat view')
  assert.strictEqual(Object.prototype.hasOwnProperty.call(button, 'cardsStyle'), false, 'seat cards should not own an independent table coordinate')
  assert.notStrictEqual(button.seatStyle, button.betStyle, 'bet anchor should stay separate from the seat component')
  restoreMocks()
}

async function testSeatCardPickerUsesReadableTitle() {
  const page = await createPage()
  page.openSeatCardsPicker('SB')
  assert.strictEqual(page.data.cardPickerTitle, 'SB 手牌', 'seat card picker title should not contain mojibake')
  restoreMocks()
}

async function testExistingHandKeepsItsRecordedTableContextAfterSessionTableChange() {
  const page = await createPage({ handId: 'hand-before-table-change' })
  assert.strictEqual(page.data.levelText, '200/400', 'full entry should inherit the hand stake snapshot, not the session final stake')
  assert.strictEqual(page.data.tableMax, '8', 'full entry should inherit the hand table size snapshot')
  assert.strictEqual(page.data.hasStraddle, false, 'an explicit hand-level false must not be overwritten by the session current straddle')
  restoreMocks()
}

async function run() {
  const tests = [
    testExistingHandKeepsItsRecordedTableContextAfterSessionTableChange,
    testSeatViewOwnsCardsAndUsesIndependentBetAnchor,
    testSeatCardPickerUsesReadableTitle,
    testButtonKeepsHeroSeatAndSeatOrder,
    testSessionEditReturnAndHistoricalPlayedTime,
    testInheritedHeroCardsSkipPickerStep,
    testQuickRecordedPositionSeedsFullEntryHeroSeat,
    testSitHereMovesHeroDuringSetup,
    testSeatMenuHidesInvalidActionsForHeroSeat,
    testLedgerInheritsSessionStackSnapshotNotFinalCashout,
    testLedgerEditUsesHeroStackBeforeSelectedHandResult,
    testStackSheetUsesSingleEffectiveStackAndBulkExcludesHero,
    testStackSheetStartsAtZeroAndKeepsBbPresets,
    testStackSecondaryActionSyncsOpponentsWithoutOverwritingHero,
    testPlayerSheetCanBindExistingPlayerNote,
    testPlayerSheetSearchesPlayerLibraryByName,
    testPlayerSheetCanCreateAndBindPlayerNote,
    testPlayerSheetSaveCreatesPlayerNoteWhenNoExistingPlayerSelected,
    testTapCurrentActionSeatOpensSeatMenu,
    testLongPressSeatDuringPlayOpensMenuWithoutJumpingAction,
    testPostflopChecksDoNotSkipPlayers,
    testSeatTapAfterClosedPreflopKeepsBoardPickerInsteadOfReopeningOpenerAction,
    testFiveCardBoardDoesNotReopenTurnOrRiverPicker,
    testJumpingTrailStreetUpdatesVisibleBoard,
    testJumpingTrailReplaysPotAndBetsToSelectedNode,
    testJumpingActionNodeReopensEditableActionState,
    testJumpingShowdownNodeKeepsShowdownChoices,
    testNextNodeMovesToFollowingRecordedTimelineNode,
    testNextNodeAtTimelineEndDoesNotSkipActionOrStreet,
    testJumpingLaterRaiseNodeUsesSelectedActorNotPreviousActor,
    testCompleteBetCallMuckSaveFlow,
    testAllInSettlementUsesEffectiveStack,
    testMultiwayHeroFoldLosesEveryContribution,
    testShowdownShowCalculatesWinnerFromCards,
    testShowUsesCardsAlreadySetOnActivePlayer,
    testStraddleInitialState,
    testHeadsUpAllInMovesToShowdownChoices,
    testPreflopAllInCallMovesDirectlyToShowdown,
    testShortAllInBelowRaiseTargetSettlesAsCall,
    testPreflopAllInRequiresFullBoardBeforeShowdownSave,
    testPreflopAllInSaveIncludesDerivedDetailFields,
    testPreflopAllInUsesEffectiveStackAndPositiveEvAfterPriorRaise,
    testRepeatedShowdownSaveReplacesExistingShowNode,
    testPreflopAllInWithDeadMoneyUsesEffectivePotForEvAndAdvice,
    testOpponentShortStackAllInDoesNotCreateHeroAllInEv,
    testLedgerEditRestoresSavedReplayState,
    testPreflopAllInAfterSeatJumpMovesDirectlyToShowdown,
    testStraddleBigBlindCallCompletesPreflopAndOpensFlopPicker,
    testPreflopCompletingCallAdvancesStreetEvenIfPriorRaiserLiveFlagIsStale,
    testNoStraddleBigBlindCompletingCallAdvancesToFlop,
    testCompletingCallRestoresMisfoldedRaiserWithMatchingPaidAmount,
    testRaiseForRemainingStackCountsAsAllIn,
    testAmountSheetStartsAtZeroAndAcceptsImmediateDigits,
    testBetCreatesTransientChipFlightAnimation,
    testStreetAdvanceCreatesCollectionAndDealAnimations,
    testActionFlowAndTimelineFollowCurrentNode,
    testTimelineIsSharedAbovePhaseDocks,
    testCardsRenderInsideStableSeatUnits,
    testIntegratedSeatsPreserveCenterAndBetSafety,
    testLedgerUsesSharedAmountSheetsAndExpandedActiveSeatLayout,
    testLedgerViewportAndTimelineDoNotExposeScrollbars,
    testPlayDockUsesCompactNodeNavigationAndNoActionSubLabels,
    testCompactLedgerHeaderIsRemovedForTableSpace,
    testSavingStateHasVisibleOverlay,
    testPlayerLibraryEntryBelongsToPlayerSheet,
    testPlayerLibraryUsesReadableAvatarRows,
    testTableLayoutUsesEdgeSeatsAndSeparatedBetLane,
    testBetAnchorsAvoidAvatarAndCardSeats
  ]
  for (const test of tests) {
    try {
      await test()
      console.log('PASS', test.name)
    } catch (error) {
      restoreMocks()
      console.error('FAIL', test.name)
      console.error(error.stack || error.message)
      process.exitCode = 1
      return
    }
  }
}

run()
