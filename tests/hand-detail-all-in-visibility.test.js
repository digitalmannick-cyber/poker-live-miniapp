const assert = require('node:assert/strict')
const test = require('node:test')

const handDetailFields = require('../utils/hand-detail-fields')

test('hides River pre-all-in and All-in EV for a non-terminal short-stack all-in', () => {
  const view = handDetailFields.buildHandDetailViewModel({
    isAllIn: true,
    allInStreet: 'preflop',
    allInEvEligible: false,
    allInEvStatus: 'all_in_not_terminal',
    allInEv: 83134.03,
    terminalStreet: 'river',
    handEndedStreet: 'river',
    postAllInRunoutOnly: false
  }, { mode: 'readonly', backfilled: true })

  assert.equal(view.form.isAllIn, false)
  assert.equal(view.form.allInEv, '')
  assert.equal(view.rows.some(row => row.key === 'allInEv'), false)
})
