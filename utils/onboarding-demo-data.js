const statsAnalytics = require('./stats-analytics')

const DEMO_SOURCE = {
  type: 'onboarding_demo',
  readonly: true,
  sync: false
}

const DEMO_SESSION_ID = 'demo_session_training_1_2'
const DEMO_HAND_IDS = ['demo_hand_training_qq_river']
const sessionDate = '2026-06-29'

const demoAiReview = {
  verdict: 'optimize',
  keyTakeaway: '河牌面对接近满池的大注，先列价值组合和诈唬组合，再决定是否 bluff-catch。',
  summary: 'QdQs 在翻牌顶暗三条后价值很高，但转牌同花完成后需要重新评估对手 check 的范围；河牌面对 140 大注，应该重点比较对手诈唬组合和成花组合。',
  goodPoints: ['翻前 CO open 尺寸清晰', '翻牌面对 check-raise 没有过度加注，保留了对手诈唬'],
  issues: ['转牌同花完成后缺少范围重估', '河牌跟注前没有明确计算对手价值组合'],
  clearMistakes: ['河牌跟注前没有先拆对手成花价值组合和错过听牌组合。'],
  optimizations: ['转牌同花完成后，即使对手 check，也要重新降低暗三条的相对牌力。'],
  exploitAdjustments: ['如果 SB 在湿面河牌很少诈唬，面对 140 大注可以更多弃牌。'],
  trainingPlan: ['复盘同花面河牌大注：列出价值组合、错过听牌组合，再决定是否 bluff-catch。']
}

const demoHand = {
  _id: DEMO_HAND_IDS[0],
  sessionId: DEMO_SESSION_ID,
  playedDate: sessionDate,
  createdAt: sessionDate + ' 22:40',
  updatedAt: sessionDate + ' 22:55',
  stakeLevel: '1/2',
  heroPosition: 'CO',
  heroCardsInput: 'QdQs',
  opponentType: '紧凶',
  opponentPosition: 'SB',
  villainPosition: 'SB',
  tableSize: '8max',
  playerCount: 8,
  currentProfit: -140,
  potSize: 320,
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
    preflop: { actionLine: 'Hero CO open 5，SB call，BB fold。', pot: 13 },
    flop: { actionLine: 'Qd7d3c，SB check，Hero bet 8，SB raise 26，Hero call。', pot: 49 },
    turn: { actionLine: '8d，SB check，Hero check back。', pot: 97 },
    river: { actionLine: '2s，SB bet 140，Hero call。', pot: 320 }
  },
  board: {
    flop: 'Qd7d3c',
    turn: '8d',
    river: '2s'
  },
  voiceNote: '我在 CO 拿 QdQs，训练示例 1/2，8人桌无 Straddle。翻前 open 5，SB call。翻牌 Qd7d3c，我下注 8，被 SB raise 到 26 后 call。转牌 8d，我 check back。河牌 2s，SB bet 140，我 call，摊牌输给 AdJd 同花。',
  mindJourney: '河牌觉得对手可能有错过的听牌，但忽略了转牌同花已经完成。',
  demo: true,
  source: DEMO_SOURCE
}

const demoDataset = {
  sessions: [
    {
      _id: DEMO_SESSION_ID,
      title: '训练示例 1/2',
      venue: '训练场',
      smallBlind: 1,
      bigBlind: 2,
      stakeLevel: '1/2',
      status: 'finished',
      date: sessionDate,
      startTime: sessionDate + ' 20:10',
      endTime: sessionDate + ' 23:00',
      durationMinutes: 170,
      buyIn: 1000,
      cashOut: 860,
      totalProfit: -140,
      notes: '新手引导演示数据，只读展示，不写入真实账号。',
      handCount: 1,
      demo: true,
      source: DEMO_SOURCE
    }
  ],
  hands: [demoHand],
  handActions: [
    { _id: 'demo_action_qq_1', handId: DEMO_HAND_IDS[0], street: 'flop', actorLabel: 'SB', actionType: 'raise', amount: 26, potAfter: 49, order: 1, demo: true, source: DEMO_SOURCE },
    { _id: 'demo_action_qq_2', handId: DEMO_HAND_IDS[0], street: 'river', actorLabel: 'SB', actionType: 'bet', amount: 140, potAfter: 320, order: 2, demo: true, source: DEMO_SOURCE }
  ],
  bankrollLogs: [
    {
      _id: 'demo_bankroll_training_1_2',
      sessionId: DEMO_SESSION_ID,
      date: sessionDate,
      type: 'session_settlement',
      amount: -140,
      note: '训练示例 1/2 结算',
      demo: true,
      source: DEMO_SOURCE
    }
  ],
  settings: {
    chipUnit: 'BB',
    venues: ['训练场'],
    blindPresets: ['1/2', '2/5', '5/10'],
    lastBlindPreset: '1/2'
  },
  bankrollCurrent: 860
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
