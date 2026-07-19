const assert = require('node:assert/strict')

const layout = require('../utils/hand-table-layout')

function distance(left, right) {
  const dx = Number(left.x) - Number(right.x)
  const dy = Number(left.y) - Number(right.y)
  return Math.sqrt(dx * dx + dy * dy)
}

for (const size of [6, 8, 9]) {
  const slots = layout.getActiveSlots(size)
  assert.equal(slots.length, size)
  const seats = slots.map(slot => layout.getSeatLayout(size, slot))
  seats.forEach(item => {
    assert(item.seat.x >= 7 && item.seat.x <= 93)
    assert(item.seat.y >= 7 && item.seat.y <= 92)
    assert(item.bet.x >= 17 && item.bet.x <= 83)
    assert(item.bet.y >= 17 && item.bet.y <= 83)
    assert(distance(item.seat, item.bet) >= 12)
    assert(distance(item.bet, { x: 50, y: 50 }) >= 13)
  })
  for (let i = 0; i < seats.length; i += 1) {
    for (let j = i + 1; j < seats.length; j += 1) {
      assert(
        distance(seats[i].seat, seats[j].seat) >= (size === 9 ? 23 : 25),
        `${size}max seats ${slots[i]} and ${slots[j]} are too close`
      )
    }
  }
}

assert.equal(layout.getSeatLayout(6, 'BTN').size, 'large')
assert.equal(layout.getSeatLayout(8, 'BTN').size, 'medium')
assert.equal(layout.getSeatLayout(9, 'BTN').size, 'compact')
assert.throws(() => layout.getSeatLayout(8, 'LJ'), /Unsupported active seat/)

for (const size of [6, 8, 9]) {
  layout.getActiveSlots(size).forEach(slot => {
    const seat = layout.getSeatLayout(size, slot).seat
    const candidates = layout.getBetAnchorCandidates(size, slot, {
      amountText: 'HK$123456',
      hasCards: true,
      hasAvatar: true,
      hasPlayerName: true
    })
    assert(candidates.length >= 3, `${size}max ${slot} should expose fallback bet anchors`)
    candidates.forEach(candidate => {
      assert(candidate.x >= 10 && candidate.x <= 90, `${size}max ${slot} bet candidate should stay inside the table width`)
      assert(candidate.y >= 7 && candidate.y <= 93, `${size}max ${slot} bet candidate should stay inside the table height`)
      assert(distance(seat, candidate) >= 14, `${size}max ${slot} bet candidate should clear its seat footprint`)
      assert(distance(candidate, { x: 50, y: 50 }) >= 13, `${size}max ${slot} bet candidate should clear the center board`)
    })
  })
}

const avatarSmallBlind = layout.resolveBetAnchor(8, 'SB', {
  amountText: 'HK$300',
  hasAvatar: true,
  hasPlayerName: true
})
const cardBigBlind = layout.resolveBetAnchor(8, 'BB', {
  amountText: 'HK$600',
  hasCards: true,
  hasPlayerName: true
})
const rightSeat = layout.getSeatLayout(8, 'SB').seat
assert.equal(avatarSmallBlind.placement, 'seat-right', 'right-edge avatar amount should point back to the seat on its right')
assert.equal(cardBigBlind.placement, 'seat-right', 'right-edge card amount should point back to the seat on its right')
assert(avatarSmallBlind.x < rightSeat.x, 'right-edge amount should sit immediately inside the seat')
assert.notDeepEqual(avatarSmallBlind, cardBigBlind, 'different seat occupancy should retain independently resolved anchors')

const longAmount = layout.resolveBetAnchor(8, 'BB', {
  amountText: 'HK$123456789',
  hasCards: true
})
assert.equal(longAmount.compact, true, 'long amount should retain full text through a compact presentation class')
