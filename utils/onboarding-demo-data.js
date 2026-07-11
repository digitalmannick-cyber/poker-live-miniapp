const statsAnalytics = require('./stats-analytics')

const DEMO_SOURCE = {
  type: 'onboarding_demo',
  readonly: true,
  sync: false
}

const DEMO_SESSION_ID = 'demo_session_macau_300_600'
const DEMO_HAND_IDS = ['demo_hand_macau_qq_river']
const sessionDate = '2026-06-29'

const demoAiReview = {
  verdict: 'optimize',
  keyTakeaway: '河牌面对接近满池的大注，先列价值组合和诈唬组合，再决定是否 bluff-catch。',
  summary: 'QdQs 在翻牌顶暗三条后价值很高，但转牌同花完成后需要重新评估对手 check 的范围；河牌面对 42000 大注，应该重点比较对手诈唬组合和成花组合。',
  goodPoints: ['翻前 CO open 尺寸清晰', '翻牌面对 check-raise 没有过度加注，保留了对手诈唬'],
  issues: ['转牌同花完成后缺少范围重估', '河牌跟注前没有明确计算对手价值组合'],
  clearMistakes: ['河牌跟注前没有先拆对手成花价值组合和错过听牌组合。'],
  optimizations: ['转牌同花完成后，即使对手 check，也要重新降低暗三条的相对牌力。'],
  exploitAdjustments: ['如果 SB 在湿面河牌很少诈唬，面对 42000 大注可以更多弃牌。'],
  trainingPlan: ['复盘同花面河牌大注：列出价值组合、错过听牌组合，再决定是否 bluff-catch。']
}

const demoHand = {
  _id: DEMO_HAND_IDS[0],
  sessionId: DEMO_SESSION_ID,
  playedDate: sessionDate,
  createdAt: sessionDate + ' 22:40',
  updatedAt: sessionDate + ' 22:55',
  stakeLevel: '300/600',
  heroPosition: 'CO',
  heroCardsInput: 'QdQs',
  opponentType: '紧凶',
  opponentPosition: 'SB',
  villainPosition: 'SB',
  tableSize: '8max',
  playerCount: 8,
  currentProfit: -42000,
  potSize: 96000,
  cumulativeHours: 2.4,
  showdownType: 'showdown',
  showdownReason: 'both_show_cards',
  opponentCards: 'AdJd',
  tags: ['River 决策', '可优化'],
  detailBackfilled: true,
  reviewStatus: 'reviewed',
  aiReview: demoAiReview,
  aiReviewStatus: 'ready',
  actionLine: 'CO QdQs open，SB 跟注。翻牌顶暗三条被 check-raise 后控池，转牌同花完成后 check back，河牌面对满池下注选择跟注，摊牌输给 A 高同花。',
  streetInputs: {
    preflop: { actionLine: 'Hero CO open 1500，SB call，BB fold。', pot: 3900 },
    flop: { actionLine: 'Qd7d3c，SB check，Hero bet 2500，SB raise 7800，Hero call。', pot: 14600 },
    turn: { actionLine: '8d，SB check，Hero check back。', pot: 29200 },
    river: { actionLine: '2s，SB bet 42000，Hero call。', pot: 96000 }
  },
  board: {
    flop: 'Qd7d3c',
    turn: '8d',
    river: '2s'
  },
  voiceNote: '我在 CO 拿 QdQs，澳门 300/600，8人桌无 Straddle。翻前 open 1500，SB call。翻牌 Qd7d3c，我下注 2500，被 SB raise 到 7800 后 call。转牌 8d，我 check back。河牌 2s，SB bet 42000，我 call，摊牌输给 AdJd 同花。',
  mindJourney: '河牌觉得对手可能有错过的听牌，但忽略了转牌同花已经完成。',
  demo: true,
  source: DEMO_SOURCE
}

const demoDataset = {
  sessions: [
    {
      _id: DEMO_SESSION_ID,
      title: '澳门 300/600 试用场',
      venue: '澳门',
      smallBlind: 300,
      bigBlind: 600,
      stakeLevel: '300/600',
      status: 'finished',
      date: sessionDate,
      startTime: sessionDate + ' 20:10',
      endTime: sessionDate + ' 23:00',
      durationMinutes: 170,
      buyIn: 300000,
      cashOut: 258000,
      totalProfit: -42000,
      notes: '新手引导演示数据，只读展示，不写入真实账号。',
      handCount: 1,
      demo: true,
      source: DEMO_SOURCE
    }
  ],
  hands: [demoHand],
  handActions: [
    { _id: 'demo_action_qq_1', handId: DEMO_HAND_IDS[0], street: 'flop', actorLabel: 'SB', actionType: 'raise', amount: 7800, potAfter: 14600, order: 1, demo: true, source: DEMO_SOURCE },
    { _id: 'demo_action_qq_2', handId: DEMO_HAND_IDS[0], street: 'river', actorLabel: 'SB', actionType: 'bet', amount: 42000, potAfter: 96000, order: 2, demo: true, source: DEMO_SOURCE }
  ],
  bankrollLogs: [
    {
      _id: 'demo_bankroll_macau_300_600',
      sessionId: DEMO_SESSION_ID,
      date: sessionDate,
      type: 'session_settlement',
      amount: -42000,
      note: '澳门 300/600 试用场结算',
      demo: true,
      source: DEMO_SOURCE
    }
  ],
  settings: {
    chipUnit: 'HKD',
    venues: ['澳门', 'MGM', '永利', '威尼斯人'],
    blindPresets: ['100/200', '200/400', '300/600', '500/1000'],
    lastBlindPreset: '300/600'
  },
  bankrollCurrent: 258000
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function getDemoDataset() {
  return clone(demoDataset)
}

function getDemoStats(rangeKey) {
  const data = getDemoDataset()
  return statsAnalytics.buildStatsAnalytics({
    sessions: data.sessions,
    hands: data.hands,
    settings: data.settings,
    bankrollCurrent: data.bankrollCurrent,
    rangeKey: rangeKey || 'all',
    nowMs: new Date(sessionDate + 'T12:00:00+08:00').getTime()
  })
}

module.exports = {
  DEMO_SOURCE,
  DEMO_SESSION_ID,
  DEMO_HAND_IDS,
  getDemoDataset,
  getDemoStats
}
