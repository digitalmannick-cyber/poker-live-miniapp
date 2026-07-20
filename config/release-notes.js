module.exports = {
  version: '3.22',
  eyebrow: 'VERSION UPDATE',
  title: '好友邀请流程补全',
  summary: '修复个人邀请二维码，并补全新用户从邀请进入后的登录、资料初始化与申请流程。',
  items: [
    { title: '个人邀请二维码', description: '修复新页面尚未发布时的小程序码路径校验失败' },
    { title: '首次使用流程', description: '新用户从邀请进入后完成微信登录和玩家资料初始化，再继续发送好友申请' },
    { title: '邀请信息不中断', description: '登录过程保留当前邀请人和邀请 token，无需重新扫码或打开卡片' },
    { title: '拉新奖励规划', description: '明确注册归因、首月实付和邀请人会员奖励的后续扩展规则' }
  ],
  imageUrl: '',
  acknowledgeText: '我知道了'
}
