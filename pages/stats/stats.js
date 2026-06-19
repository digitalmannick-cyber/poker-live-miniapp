const dataService = require('../../services/data-service')
const tabBar = require('../../utils/tab-bar')

const RANGE_OPTIONS = [
  { key: 'all', label: '全部' },
  { key: 'last30', label: '近30天' },
  { key: 'last7', label: '近7天' }
]

const PROTOTYPE_ANALYTICS = {
  all: {
    rangeLabel: '全部样本',
    statusText: '盈利中',
    statusTone: 'positive',
    hero: {
      totalProfit: '+HKD 186,400',
      hourlyRate: '+HKD 3,120/h',
      sessions: '18',
      hands: '246',
      winRate: '61%',
      bankroll: 'HKD 198,400'
    },
    metrics: [
      { label: '平均每场', value: '+HKD 10,356', tone: 'positive' },
      { label: '平均时长', value: '3.3h', tone: 'neutral' },
      { label: '最佳场次', value: '+HKD 72,000', tone: 'positive' },
      { label: '最差场次', value: '-HKD 38,000', tone: 'negative' }
    ],
    venueRows: [
      { label: 'MGM', meta: '8 场 · 3.6h/场', value: '+HKD 128,000', tone: 'positive', barWidth: 100 },
      { label: '永利', meta: '5 场 · 3.1h/场', value: '+HKD 64,400', tone: 'positive', barWidth: 62 },
      { label: 'Home Game', meta: '5 场 · 2.7h/场', value: '-HKD 6,000', tone: 'negative', barWidth: 18 }
    ],
    stakeRows: [
      { label: '200/400', meta: '126 手牌', value: '+HKD 116,800', tone: 'positive', barWidth: 100 },
      { label: '100/200', meta: '88 手牌', value: '+HKD 51,600', tone: 'positive', barWidth: 54 },
      { label: '500/1000', meta: '32 手牌', value: '+HKD 18,000', tone: 'positive', barWidth: 28 }
    ],
    intelCards: [
      { label: '最赚钱位置', value: 'BTN', sub: '+HKD 74,200 · 52 手牌', tone: 'positive' },
      { label: '最大漏洞', value: 'River Overcall', sub: '-HKD 42,000 · 5 次', tone: 'negative' },
      { label: '优势对手', value: '松弱', sub: '+HKD 96,500 · 71 手牌', tone: 'positive' }
    ],
    diagnosisRows: [
      { label: 'BTN', meta: '位置 · 52 手牌', value: '+HKD 74,200', tone: 'positive', barWidth: 100 },
      { label: 'CO', meta: '位置 · 44 手牌', value: '+HKD 38,400', tone: 'positive', barWidth: 56 },
      { label: 'BB', meta: '位置 · 46 手牌', value: '-HKD 21,800', tone: 'negative', barWidth: 34 },
      { label: '跟注站', meta: '对手类型 · 39 手牌', value: '+HKD 58,000', tone: 'positive', barWidth: 78 }
    ],
    volatility: {
      biggestWin: '+HKD 80,000',
      biggestLoss: '-HKD 50,000',
      averagePot: 'HKD 24,800',
      bigPotCount: '17',
      profitFactor: '2.6',
      distribution: [
        { label: '盈利手', value: '94', tone: 'positive', barWidth: 49 },
        { label: '亏损手', value: '71', tone: 'negative', barWidth: 37 },
        { label: '打平/小波动', value: '81', tone: 'neutral', barWidth: 42 }
      ]
    },
    reviewItems: [
      { title: '优先复盘大额亏损', meta: '4 手牌 · 合计 -HKD 96,000', tone: 'negative' },
      { title: 'River 决策标签偏贵', meta: '5 次 · 平均 -HKD 8,400', tone: 'negative' },
      { title: '补全细节后再跑 AI 建议', meta: '12 手牌缺少行动线', tone: 'neutral' }
    ]
  },
  last30: {
    rangeLabel: '近30天',
    statusText: '高波动盈利',
    statusTone: 'positive',
    hero: {
      totalProfit: '+HKD 72,600',
      hourlyRate: '+HKD 2,710/h',
      sessions: '7',
      hands: '94',
      winRate: '57%',
      bankroll: 'HKD 198,400'
    },
    metrics: [
      { label: '平均每场', value: '+HKD 10,371', tone: 'positive' },
      { label: '平均时长', value: '3.8h', tone: 'neutral' },
      { label: '最佳场次', value: '+HKD 48,000', tone: 'positive' },
      { label: '最差场次', value: '-HKD 31,000', tone: 'negative' }
    ],
    venueRows: [
      { label: 'MGM', meta: '3 场 · 4.1h/场', value: '+HKD 65,000', tone: 'positive', barWidth: 100 },
      { label: '永利', meta: '2 场 · 3.0h/场', value: '+HKD 18,600', tone: 'positive', barWidth: 36 },
      { label: 'Home Game', meta: '2 场 · 4.2h/场', value: '-HKD 11,000', tone: 'negative', barWidth: 26 }
    ],
    stakeRows: [
      { label: '200/400', meta: '51 手牌', value: '+HKD 58,200', tone: 'positive', barWidth: 100 },
      { label: '500/1000', meta: '18 手牌', value: '+HKD 19,400', tone: 'positive', barWidth: 42 },
      { label: '100/200', meta: '25 手牌', value: '-HKD 5,000', tone: 'negative', barWidth: 18 }
    ],
    intelCards: [
      { label: '最赚钱位置', value: 'CO', sub: '+HKD 31,600 · 18 手牌', tone: 'positive' },
      { label: '最大漏洞', value: '薄价值跟注', sub: '-HKD 25,000 · 3 次', tone: 'negative' },
      { label: '优势对手', value: '娱乐玩家', sub: '+HKD 44,000 · 22 手牌', tone: 'positive' }
    ],
    diagnosisRows: [
      { label: 'CO', meta: '位置 · 18 手牌', value: '+HKD 31,600', tone: 'positive', barWidth: 100 },
      { label: 'BTN', meta: '位置 · 21 手牌', value: '+HKD 28,800', tone: 'positive', barWidth: 92 },
      { label: 'SB', meta: '位置 · 13 手牌', value: '-HKD 12,000', tone: 'negative', barWidth: 38 },
      { label: '松凶', meta: '对手类型 · 14 手牌', value: '-HKD 8,400', tone: 'negative', barWidth: 28 }
    ],
    volatility: {
      biggestWin: '+HKD 48,000',
      biggestLoss: '-HKD 31,000',
      averagePot: 'HKD 28,200',
      bigPotCount: '8',
      profitFactor: '2.1',
      distribution: [
        { label: '盈利手', value: '38', tone: 'positive', barWidth: 53 },
        { label: '亏损手', value: '29', tone: 'negative', barWidth: 40 },
        { label: '打平/小波动', value: '27', tone: 'neutral', barWidth: 38 }
      ]
    },
    reviewItems: [
      { title: '本月先看 SB 防守', meta: '13 手牌 · -HKD 12,000', tone: 'negative' },
      { title: '大底池需要补行动线', meta: '6 手牌缺少街道细节', tone: 'neutral' },
      { title: '松凶对手样本偏亏', meta: '14 手牌 · -HKD 8,400', tone: 'negative' }
    ]
  },
  last7: {
    rangeLabel: '近7天',
    statusText: '等待样本',
    statusTone: 'neutral',
    hero: {
      totalProfit: '+HKD 9,800',
      hourlyRate: '+HKD 1,225/h',
      sessions: '2',
      hands: '27',
      winRate: '50%',
      bankroll: 'HKD 198,400'
    },
    metrics: [
      { label: '平均每场', value: '+HKD 4,900', tone: 'positive' },
      { label: '平均时长', value: '4.0h', tone: 'neutral' },
      { label: '最佳场次', value: '+HKD 18,800', tone: 'positive' },
      { label: '最差场次', value: '-HKD 9,000', tone: 'negative' }
    ],
    venueRows: [
      { label: 'MGM', meta: '1 场 · 4.5h', value: '+HKD 18,800', tone: 'positive', barWidth: 100 },
      { label: 'Home Game', meta: '1 场 · 3.5h', value: '-HKD 9,000', tone: 'negative', barWidth: 48 }
    ],
    stakeRows: [
      { label: '200/400', meta: '19 手牌', value: '+HKD 12,400', tone: 'positive', barWidth: 100 },
      { label: '100/200', meta: '8 手牌', value: '-HKD 2,600', tone: 'negative', barWidth: 22 }
    ],
    intelCards: [
      { label: '最赚钱位置', value: 'BTN', sub: '+HKD 12,000 · 5 手牌', tone: 'positive' },
      { label: '最大漏洞', value: '样本不足', sub: '先记录更多手牌', tone: 'neutral' },
      { label: '优势对手', value: '松弱', sub: '+HKD 9,600 · 6 手牌', tone: 'positive' }
    ],
    diagnosisRows: [
      { label: 'BTN', meta: '位置 · 5 手牌', value: '+HKD 12,000', tone: 'positive', barWidth: 100 },
      { label: 'HJ', meta: '位置 · 4 手牌', value: '+HKD 3,200', tone: 'positive', barWidth: 34 },
      { label: 'BB', meta: '位置 · 6 手牌', value: '-HKD 5,400', tone: 'negative', barWidth: 45 },
      { label: '松弱', meta: '对手类型 · 6 手牌', value: '+HKD 9,600', tone: 'positive', barWidth: 82 }
    ],
    volatility: {
      biggestWin: '+HKD 18,800',
      biggestLoss: '-HKD 9,000',
      averagePot: 'HKD 18,600',
      bigPotCount: '2',
      profitFactor: '1.7',
      distribution: [
        { label: '盈利手', value: '11', tone: 'positive', barWidth: 51 },
        { label: '亏损手', value: '9', tone: 'negative', barWidth: 42 },
        { label: '打平/小波动', value: '7', tone: 'neutral', barWidth: 32 }
      ]
    },
    reviewItems: [
      { title: '样本少，先看最大输手', meta: '1 手牌 · -HKD 9,000', tone: 'negative' },
      { title: '补齐本周行动线', meta: '3 手牌缺少 turn/river 细节', tone: 'neutral' },
      { title: '继续跟踪 BB 防守', meta: '6 手牌 · -HKD 5,400', tone: 'negative' }
    ]
  }
}

function buildPrototype(rangeKey) {
  return PROTOTYPE_ANALYTICS[rangeKey] || PROTOTYPE_ANALYTICS.all
}

Page({
  data: {
    loading: false,
    selectedRangeKey: 'all',
    rangeOptions: RANGE_OPTIONS,
    prototype: buildPrototype('all')
  },
  async onShow() {
    tabBar.syncCustomTabBar('/pages/stats/stats')
    this.setData({ loading: true })
    try {
      await dataService.getStatsData()
    } catch (error) {
      console.warn('stats prototype data warmup failed', error)
    }
    this.setData({
      prototype: buildPrototype(this.data.selectedRangeKey),
      loading: false
    })
  },
  onRangeTap(event) {
    const key = event.currentTarget.dataset.key || 'all'
    this.setData({
      selectedRangeKey: key,
      prototype: buildPrototype(key)
    })
  }
})
