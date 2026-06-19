function parseSessionDateTime(value) {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2]) - 1
  const day = Number(match[3])
  const hours = Number(match[4])
  const minutes = Number(match[5])
  const date = new Date(year, month, day, hours, minutes)
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month ||
    date.getDate() !== day ||
    date.getHours() !== hours ||
    date.getMinutes() !== minutes
  ) return null
  return date
}

function formatDurationMinutes(minutes) {
  const total = Math.max(0, Math.floor(Number(minutes) || 0))
  const hours = String(Math.floor(total / 60)).padStart(2, '0')
  const remainder = String(total % 60).padStart(2, '0')
  return hours + ':' + remainder
}

function buildDurationView(session, now) {
  const finished = !!(session && session.status === 'finished')
  const label = finished ? 'TOTAL DURATION' : 'SESSION TIME'
  const start = parseSessionDateTime(session && session.startTime)
  const endText = finished
    ? session && session.endTime
    : session && session.timerPausedAt
  const end = endText ? parseSessionDateTime(endText) : (now || new Date())
  if (!start || !end || end.getTime() < start.getTime()) {
    return { display: '--:--', label }
  }
  return {
    display: formatDurationMinutes((end.getTime() - start.getTime()) / 60000),
    label
  }
}

module.exports = {
  parseSessionDateTime,
  formatDurationMinutes,
  buildDurationView
}
