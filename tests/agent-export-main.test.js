const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')

process.env.AGENT_EXPORT_TOKEN = 'secret-token'
process.env.AGENT_EXPORT_OWNER_OPENID = 'owner-openid'

const collections = {
  profiles: [
    { _id: 'profile_owner', ownerOpenId: 'owner-openid', playerId: 'WX-AGENT01', name: 'Hero', updatedAt: 10 }
  ],
  user_settings: [
    { _id: 'settings_owner', ownerOpenId: 'owner-openid', playerId: 'WX-AGENT01', chipUnit: 'HKD', updatedAt: 10 }
  ],
  sessions: [
    {
      _id: 'session_1',
      ownerOpenId: 'owner-openid',
      playerId: 'WX-AGENT01',
      title: 'Wynn 100/200',
      date: '2026-06-30',
      startTime: '2026-06-30 20:00',
      venue: 'Wynn',
      smallBlind: 100,
      bigBlind: 200,
      buyIn: 50000,
      cashOut: 64000,
      totalProfit: 14000,
      durationMinutes: 180,
      handCount: 2,
      status: 'finished'
    }
  ],
  hands: [
    {
      _id: 'hand_best',
      ownerOpenId: 'owner-openid',
      playerId: 'WX-AGENT01',
      sessionId: 'session_1',
      playedDate: '2026-06-30',
      heroCardsInput: 'AhAd',
      currentProfit: 20000,
      potSize: 38000,
      createdAt: 100
    },
    {
      _id: 'hand_worst',
      ownerOpenId: 'owner-openid',
      playerId: 'WX-AGENT01',
      sessionId: 'session_1',
      playedDate: '2026-06-30',
      heroCardsInput: 'KsQs',
      currentProfit: -6000,
      potSize: 22000,
      createdAt: 200
    }
  ],
  hand_actions: [
    { _id: 'action_1', ownerOpenId: 'owner-openid', playerId: 'WX-AGENT01', handId: 'hand_best', street: 'preflop', actorLabel: 'Hero', actionType: 'raise', amount: 600, potAfter: 1500, sequence: 1 }
  ],
  bankroll_logs: []
}

function matches(doc, filters) {
  return Object.keys(filters || {}).every(key => doc && doc[key] === filters[key])
}

function createCollection(name) {
  let filters = {}
  let offset = 0
  let limit = 100
  return {
    where(nextFilters) {
      filters = nextFilters || {}
      return this
    },
    skip(nextOffset) {
      offset = Number(nextOffset) || 0
      return this
    },
    limit(nextLimit) {
      limit = Number(nextLimit) || 100
      return this
    },
    async get() {
      const items = (collections[name] || []).filter(item => matches(item, filters))
      return { data: items.slice(offset, offset + limit) }
    },
    doc(id) {
      return {
        async get() {
          return { data: (collections[name] || []).find(item => item._id === id) || null }
        }
      }
    }
  }
}

test('external agent_export request returns cloud data through main entrypoint', async () => {
  const originalLoad = Module._load
  Module._load = function load(request, parent, isMain) {
    if (request === 'wx-server-sdk') {
      return {
        DYNAMIC_CURRENT_ENV: 'test',
        init() {},
        database() {
          return {
            collection: createCollection
          }
        },
        getWXContext() {
          return {}
        }
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }

  const modulePath = require.resolve('../cloudfunctions/poker_data/index')
  delete require.cache[modulePath]
  const pokerData = require('../cloudfunctions/poker_data/index')
  Module._load = originalLoad

  const result = await pokerData.main({
    body: JSON.stringify({
      action: 'agent_export',
      playerId: 'WX-AGENT01',
      rangeKey: 'last7',
      nowMs: new Date('2026-07-01T12:00:00+08:00').getTime()
    }),
    headers: {
      authorization: 'Bearer secret-token'
    }
  })

  assert.equal(result.code, 0)
  assert.equal(result.data.profile.playerId, 'WX-AGENT01')
  assert.equal(result.data.summary.totalProfit, 14000)
  assert.equal(result.data.summary.handProfit, 14000)
  assert.equal(result.data.extremes.biggestWinningHand.id, 'hand_best')
  assert.equal(result.data.extremes.biggestLosingHand.id, 'hand_worst')
  assert.deepEqual(result.data.hands.find(hand => hand.id === 'hand_best').actions.map(action => action.id), ['action_1'])
})
