const assert = require('node:assert/strict')
const pbtImport = require('../utils/pbt-notes-import')

const csv = [
  '"---PBT Notes Export---",,,,,',
  'id,name,note,hands,vpip,pfr,pf3bet,image',
  '61233,左耳钉男欧洲的a,"防守特别宽，多人池 donk中对|AQ 会 4b",12,41,18,7,61233_1685746266',
  '61250,日本小男生不爱说话a,喜欢操作。会利用桌面动态,5,55,20,0,61250_1685746118',
  '61250,日本小男生不爱说话a,重复行,5,55,20,0,61250_1685746118'
].join('\n')

const parsed = pbtImport.parsePbtCsv(csv)
assert.equal(parsed.ok, true)
assert.equal(parsed.markerFound, true)
assert.equal(parsed.rows.length, 3)
assert.equal(parsed.rows[0].name, '左耳钉男欧洲的a')

const plan = pbtImport.buildImportPlan(csv, [{
  _id: 'existing_note_1',
  name: '左耳钉男欧洲的a',
  type: '紧凶',
  leakTags: ['多人池宽防守'],
  note: '旧 note\n\n--- PBT 导入 ---\nPBT ID: 61233',
  createdAt: 100,
  updatedAt: 200
}], { nowMs: 1000 })

assert.equal(plan.update.length, 1)
assert.equal(plan.create.length, 1)
assert.equal(plan.skipped.length, 1)
assert.equal(plan.update[0]._id, 'existing_note_1')
assert.equal(plan.update[0].type, '紧凶')
assert.deepEqual(plan.update[0].leakTags, ['多人池宽防守'])
assert.match(plan.update[0].note, /旧 note/)
assert.match(plan.update[0].note, /防守特别宽/)
assert.match(plan.update[0].note, /AQ 会 4b/)
assert.match(plan.update[0].note, /PBT ID: 61233/)
assert.doesNotMatch(plan.update[0].note, /PBT统计/)
assert.doesNotMatch(plan.update[0].note, /PBT Image/)
assert.equal(plan.create[0]._id, 'pbt_note_61250')

const bad = pbtImport.parsePbtCsv('name only\nabc')
assert.equal(bad.ok, false)
assert.equal(bad.error, 'PBT_CSV_HEADER_NOT_FOUND')

console.log('PBT notes import checks passed')
