const test = require('node:test')
const assert = require('node:assert/strict')

const client = require('../tools/agent-export-client')

test('agent export client builds bearer request payload', () => {
  const request = client.buildRequest({
    url: 'https://example.com/poker_data',
    token: 'secret',
    playerId: ' wx-agent01 ',
    rangeKey: 'last30'
  })

  assert.equal(request.url, 'https://example.com/poker_data')
  assert.equal(request.init.method, 'POST')
  assert.equal(request.init.headers.Authorization, 'Bearer secret')
  assert.deepEqual(JSON.parse(request.init.body), {
    action: 'agent_export',
    playerId: 'WX-AGENT01',
    rangeKey: 'last30'
  })
})

test('agent export client prefers explicit date range over rangeKey', () => {
  const payload = client.buildPayload({
    playerId: 'WX-AGENT01',
    rangeKey: 'last7',
    from: '2026-06-22',
    to: '2026-06-28'
  })

  assert.deepEqual(payload, {
    action: 'agent_export',
    playerId: 'WX-AGENT01',
    range: {
      from: '2026-06-22',
      to: '2026-06-28'
    }
  })
})

test('agent export client returns cloud function data body', async () => {
  const data = await client.fetchAgentExport({
    url: 'https://example.com/poker_data',
    token: 'secret',
    playerId: 'WX-AGENT01'
  }, async (url, init) => {
    assert.equal(url, 'https://example.com/poker_data')
    assert.equal(JSON.parse(init.body).action, 'agent_export')
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          code: 0,
          data: {
            summary: { handCount: 2 },
            extremes: {}
          }
        })
      }
    }
  })

  assert.deepEqual(data, {
    summary: { handCount: 2 },
    extremes: {}
  })
})
