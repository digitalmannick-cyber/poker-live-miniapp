const assert = require('node:assert/strict')
const pbtBankroll = require('../utils/pbt-bankroll-import')

const csv = [
  '"---PBT Bankroll Export---",,,,,',
  'id,starttime,endtime,breakminutes,playingminutes,variant,game,limit,tablesize,location,type,currency,exchangerate,buyin,cashout,netprofit,grossprofit,rebuys,rebuycosts,smallblind,bigblind,3rdblind,sessionnote,tags,notes',
  '8682484,2025-09-12 17:31:29,2025-09-12 20:52:00,60,141,Cash Game,Texas Holdem,No Limit,Full-Ring,Venetian Macau,Casino,HKD,0.91394,60000,42000,-18000,-18000,0,0,100,200,0,第一场,tagA,备注',
  '8709651,2025-09-16 16:08:20,2025-09-16 22:06:00,0,358,Cash Game,Texas Holdem,No Limit,Full-Ring,Venetian Macau,Casino,HKD,0.91499,70000,56000,-44000,-44000,1,30000,100,200,0,,,',
  'bad,2025-09-16 16:08:20,2025-09-16 22:06:00,0,358,Cash Game,Texas Holdem,No Limit,Full-Ring,Venetian Macau,Casino,HKD,0.91499,70000,56000,-1,-1,1,30000,100,200,0,,,'
].join('\n')

const parsed = pbtBankroll.parsePbtBankrollCsv(csv)
assert.equal(parsed.ok, true)
assert.equal(parsed.markerFound, true)
assert.equal(parsed.rows.length, 3)

const plan = pbtBankroll.buildImportPlan(csv, [], [], { nowMs: 1000 })
assert.equal(plan.createSessions.length, 1)
assert.equal(plan.updateSessions.length, 0)
assert.equal(plan.bankrollLogs.length, 1)
assert.equal(plan.skipped.length, 2)

const first = plan.createSessions[0]
assert.equal(first._id, 'pbt_session_8682484')
assert.equal(first.venue, 'Venetian Macau')
assert.equal(first.tableSize, 9)
assert.equal(first.durationMinutes, 141)
assert.equal(first.buyIn, 60000)
assert.equal(first.cashOut, 42000)
assert.equal(first.totalProfit, -18000)
assert.equal(first.handCount, 0)
assert.equal(first.status, 'finished')
assert.match(first.notes, /PBT ID: 8682484/)

assert.match(plan.skipped[0].reason, /NET_PROFIT_MISMATCH/, 'rebuy rows should not be imported when buyin does not reconcile with netprofit')

const existingPlan = pbtBankroll.buildImportPlan(csv, [{ _id: 'pbt_session_8682484', createdAt: 10 }], [], { nowMs: 1000 })
assert.equal(existingPlan.updateSessions.length, 1)
assert.equal(existingPlan.createSessions.length, 0)
assert.equal(existingPlan.updateSessions[0].createdAt, 10)

console.log('PBT bankroll import checks passed')
