const FRIEND_NAMES = ['银狼', '赤狐', '黑猫', '幻蝶', '灰隼', '绿蛇', '白鸦', '蓝鲨', '夜兔', '金狮']
const TITLES = ['不眠赌徒', '河牌猎手', '读牌专家', '冷静观察者', '价值捕手', '范围拆解师', '桌面指挥官', '翻牌圈先锋', '逆风行者', '筹码守卫']
function isRankingEnabled() {
  try {
    if (typeof wx === 'undefined' || typeof wx.getSystemInfoSync !== 'function') return false
    return String(wx.getSystemInfoSync().platform || '').toLowerCase() === 'devtools'
  } catch (error) {
    return false
  }
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

module.exports = { isRankingEnabled, getRanking }
