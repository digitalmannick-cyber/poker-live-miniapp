const ACTIVE_SLOTS = {
  6: ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'],
  8: ['BTN', 'SB', 'BB', 'UTG', 'UTG1', 'MP', 'HJ', 'CO'],
  9: ['BTN', 'SB', 'BB', 'UTG', 'UTG1', 'MP', 'LJ', 'HJ', 'CO']
}

const SIZE_BY_TABLE = {
  6: 'large',
  8: 'medium',
  9: 'compact'
}

const LAYOUTS = {
  6: {
    BTN: { seat: [78, 13], bet: [70, 28], edge: 'top' },
    SB: { seat: [91, 49], bet: [76, 49], edge: 'right' },
    BB: { seat: [75, 88], bet: [68, 72], edge: 'bottom' },
    UTG: { seat: [25, 88], bet: [32, 72], edge: 'bottom' },
    HJ: { seat: [9, 49], bet: [24, 49], edge: 'left' },
    CO: { seat: [22, 13], bet: [30, 28], edge: 'top' }
  },
  8: {
    BTN: { seat: [74, 10], bet: [68, 26], edge: 'top' },
    SB: { seat: [91, 34], bet: [77, 38], edge: 'right' },
    BB: { seat: [91, 67], bet: [77, 62], edge: 'right' },
    UTG: { seat: [72, 90], bet: [67, 74], edge: 'bottom' },
    UTG1: { seat: [28, 90], bet: [33, 74], edge: 'bottom' },
    MP: { seat: [9, 67], bet: [23, 62], edge: 'left' },
    HJ: { seat: [9, 34], bet: [23, 38], edge: 'left' },
    CO: { seat: [26, 10], bet: [32, 26], edge: 'top' }
  },
  9: {
    BTN: { seat: [71, 9], bet: [66, 25], edge: 'top' },
    SB: { seat: [90, 28], bet: [76, 34], edge: 'right' },
    BB: { seat: [92, 58], bet: [77, 56], edge: 'right' },
    UTG: { seat: [79, 86], bet: [69, 72], edge: 'bottom' },
    UTG1: { seat: [50, 92], bet: [50, 75], edge: 'bottom' },
    MP: { seat: [21, 86], bet: [31, 72], edge: 'bottom' },
    LJ: { seat: [8, 58], bet: [23, 56], edge: 'left' },
    HJ: { seat: [10, 28], bet: [24, 34], edge: 'left' },
    CO: { seat: [29, 9], bet: [34, 25], edge: 'top' }
  }
}

function normalizeTableSize(tableSize) {
  const value = Number(String(tableSize || '').replace(/\D/g, ''))
  return ACTIVE_SLOTS[value] ? value : 8
}

function point(values) {
  return { x: values[0], y: values[1] }
}

function getActiveSlots(tableSize) {
  return ACTIVE_SLOTS[normalizeTableSize(tableSize)].slice()
}

function getSeatLayout(tableSize, slot) {
  const size = normalizeTableSize(tableSize)
  const source = LAYOUTS[size][slot]
  if (!source) throw new Error(`Unsupported active seat ${slot} for ${size}max`)
  return {
    seat: point(source.seat),
    bet: point(source.bet),
    edge: source.edge,
    size: SIZE_BY_TABLE[size]
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function betCandidate(x, y, placement, compact) {
  return {
    x: clamp(Number(x), 10, 90),
    y: clamp(Number(y), 7, 93),
    placement,
    compact: !!compact
  }
}

function getBetAnchorCandidates(tableSize, slot, options) {
  const layout = getSeatLayout(tableSize, slot)
  const seat = layout.seat
  const settings = options || {}
  const amountLength = String(settings.amountText || '').replace(/\s/g, '').length
  const compact = amountLength >= 11
  const horizontalGap = compact ? 18.5 : 18
  const verticalGap = compact ? 15.5 : 15

  if (layout.edge === 'right') {
    return [
      betCandidate(seat.x - horizontalGap, seat.y, 'seat-right', compact),
      betCandidate(seat.x - horizontalGap, seat.y - 8, 'seat-right', compact),
      betCandidate(seat.x - horizontalGap, seat.y + 8, 'seat-right', compact)
    ]
  }
  if (layout.edge === 'left') {
    return [
      betCandidate(seat.x + horizontalGap, seat.y, 'seat-left', compact),
      betCandidate(seat.x + horizontalGap, seat.y - 8, 'seat-left', compact),
      betCandidate(seat.x + horizontalGap, seat.y + 8, 'seat-left', compact)
    ]
  }
  if (layout.edge === 'bottom') {
    return [
      betCandidate(seat.x, seat.y - verticalGap, 'seat-bottom', compact),
      betCandidate(seat.x + 8, seat.y - verticalGap, 'seat-bottom', compact),
      betCandidate(seat.x - 8, seat.y - verticalGap, 'seat-bottom', compact)
    ]
  }
  return [
    betCandidate(seat.x, seat.y + verticalGap, 'seat-top', compact),
    betCandidate(seat.x + 8, seat.y + verticalGap, 'seat-top', compact),
    betCandidate(seat.x - 8, seat.y + verticalGap, 'seat-top', compact)
  ]
}

function resolveBetAnchor(tableSize, slot, options) {
  const settings = options || {}
  const candidates = getBetAnchorCandidates(tableSize, slot, settings)
  const occupied = !!(settings.hasCards || settings.hasAvatar || settings.hasPlayerName)
  const layout = getSeatLayout(tableSize, slot)

  // For top/bottom seats, cards and names use the centered lane. Move the amount
  // diagonally while keeping the connector pointed at the owning seat.
  if (occupied && (layout.edge === 'top' || layout.edge === 'bottom')) {
    return candidates[layout.seat.x <= 50 ? 1 : 2]
  }
  return candidates[0]
}

module.exports = {
  getActiveSlots,
  getSeatLayout,
  getBetAnchorCandidates,
  resolveBetAnchor
}
