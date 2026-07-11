const TITLE_LEVELS = [
  { hours: 0, title: '愚者启程' },
  { hours: 10, title: '天鹅绒访客' },
  { hours: 30, title: '潜入见习生' },
  { hours: 60, title: '暗夜侦察员' },
  { hours: 100, title: '怪盗新星' },
  { hours: 200, title: '牌桌执行者' },
  { hours: 300, title: '战局策士' },
  { hours: 500, title: '心之怪盗' },
  { hours: 750, title: '夜幕王牌' },
  { hours: 1000, title: '殿堂攻略者' },
  { hours: 1500, title: '命运操盘手' },
  { hours: 2000, title: '怪盗团参谋' },
  { hours: 3000, title: '天鹅绒贵宾' },
  { hours: 5000, title: '魅影统帅' },
  { hours: 7500, title: '无双王牌' },
  { hours: 10000, title: '传奇怪盗' }
]

function normalizeHours(value) {
  const hours = Number(value)
  return Number.isFinite(hours) && hours > 0 ? hours : 0
}

function formatHoursLabel(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function resolvePlayerTitle(value) {
  const hours = normalizeHours(value)
  let currentIndex = 0

  TITLE_LEVELS.forEach((level, index) => {
    if (hours >= level.hours) currentIndex = index
  })

  const current = TITLE_LEVELS[currentIndex]
  const next = TITLE_LEVELS[currentIndex + 1] || null
  const progressPercent = next
    ? Math.max(0, Math.min(100, Math.round(((hours - current.hours) / (next.hours - current.hours)) * 1000) / 10))
    : 100

  return {
    hours,
    hoursDisplay: hours.toFixed(1),
    current,
    next,
    remainingHours: next ? Math.max(0, Math.ceil(next.hours - hours)) : 0,
    progressPercent,
    rangeLabel: next ? current.hours + 'h - ' + next.hours + 'h' : '最高称号',
    levels: TITLE_LEVELS.map((level, index) => Object.assign({}, level, {
      hoursLabel: formatHoursLabel(level.hours),
      state: index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'locked',
      stateLabel: index < currentIndex ? '已解锁' : index === currentIndex ? '当前' : '未解锁'
    }))
  }
}

module.exports = {
  TITLE_LEVELS,
  resolvePlayerTitle
}
