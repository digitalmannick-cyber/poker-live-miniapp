const FRIEND_NAMES = ['银狼', '赤狐', '黑猫', '幻蝶', '灰隼', '绿蛇', '白鸦', '蓝鲨', '夜兔', '金狮']
const TITLES = ['不眠赌徒', '河牌猎手', '读牌专家', '冷静观察者', '价值捕手', '范围拆解师', '桌面指挥官', '翻牌圈先锋', '逆风行者', '筹码守卫']
const TYPES = ['激进常客', '紧凶玩家', '松凶玩家', '稳健型', '娱乐玩家', '被动跟注型', '短码选手', '深码玩家', '诈唬型', '价值型']
const COLORS = ['#9b5de5', '#f15b5d', '#475cff', '#b44cff', '#30a5d8', '#18b7a0', '#8891a7', '#3478f6', '#d55f9a', '#d5a72e']

function isEnabled() {
  try {
    if (typeof wx === 'undefined' || typeof wx.getSystemInfoSync !== 'function') return false
    return String(wx.getSystemInfoSync().platform || '').toLowerCase() === 'devtools'
  } catch (error) {
    return false
  }
}

function getFriends() {
  return FRIEND_NAMES.slice(0, 8).map((nickname, index) => ({
    remote: {
      socialUserId: 'demo_friend_' + (index + 1),
      friendshipId: 'demo_friendship_' + (index + 1),
      nickname,
      avatarUrl: '',
      avatarText: nickname.slice(0, 1),
      title: TITLES[index],
      statsVisible: index !== 6,
      durationMinutes: 900 - index * 74,
      recordedHandCount: 138 - index * 11
    },
    note: {
      name: nickname,
      avatarText: nickname.slice(0, 1),
      type: TYPES[index],
      typeColor: COLORS[index],
      leakTags: index % 2 === 0 ? ['河牌跟注偏宽', '3Bet 偏低'] : ['转牌弃牌偏高', '盲注防守宽'],
      note: index % 2 === 0 ? '偏爱用小尺寸持续下注，河牌价值下注较直接。' : '深码时会扩大按钮位开池范围，受压后偏谨慎。',
      battleHandIds: Array.from({ length: 2 + (index % 5) }, (_, handIndex) => 'demo_battle_' + index + '_' + handIndex)
    }
  }))
}

function getFeed() {
  const now = Date.now()
  const cards = [
    { heroCards: ['A♠', 'K♠'], flop: ['Q♠', 'J♦', '6♣'], turn: ['10♠'], river: ['2♥'], potBb: 86.5, stackBb: 142, actions: 7 },
    { heroCards: ['Q♥', 'Q♣'], flop: ['9♣', '7♦', '3♠'], turn: ['K♥'], river: ['4♣'], potBb: 44, stackBb: 100, actions: 5 },
    { heroCards: ['8♦', '7♦'], flop: ['J♦', '6♠', '5♦'], turn: ['2♣'], river: ['9♥'], potBb: 63.5, stackBb: 176, actions: 8 }
  ]
  return cards.map((card, index) => ({
    shareId: 'demo_share_' + (index + 1),
    publisher: {
      socialUserId: 'demo_friend_' + (index + 1),
      nickname: FRIEND_NAMES[index],
      avatarUrl: '',
      avatarText: FRIEND_NAMES[index].slice(0, 1)
    },
    scope: index === 0 ? 'square' : index === 1 ? 'friends' : 'selected',
    scopeLabel: index === 0 ? '广场' : index === 1 ? '全部好友' : '指定好友',
    summary: {
      heroCards: card.heroCards,
      board: { flop: card.flop, turn: card.turn, river: card.river },
      potBb: card.potBb,
      effectiveStackBb: card.stackBb,
      actionCount: card.actions,
      playerCount: 6
    },
    likedByMe: index === 1,
    likeCount: 12 - index * 3,
    commentCount: 5 - index,
    createdAt: now - (index + 1) * 37 * 60 * 1000
  }))
}

function getRanking(rangeKey) {
  const scale = rangeKey === 'week' ? 1 : rangeKey === 'month' ? 3.4 : 12
  const top10 = FRIEND_NAMES.map((nickname, index) => ({
    socialUserId: 'demo_rank_' + (index + 1),
    nickname,
    avatarUrl: '',
    avatarText: nickname.slice(0, 1),
    title: TITLES[index],
    rank: index + 1,
    durationMinutes: Math.round((756 - index * 47) * scale),
    recordedHandCount: Math.round((164 - index * 9) * scale)
  }))
  return {
    top10,
    myRank: {
      socialUserId: 'demo_me', nickname: '我的账号', avatarUrl: '', avatarText: '我', title: '牌桌旅人', rank: 14,
      durationMinutes: Math.round(286 * scale), recordedHandCount: Math.round(61 * scale)
    }
  }
}

module.exports = { isEnabled, getFriends, getFeed, getRanking }
