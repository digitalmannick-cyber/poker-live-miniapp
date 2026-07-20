const socialService = require('../../services/social-service')
const socialMutation = require('../../utils/social-mutation')

function safeDecodeInviteToken(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  try {
    return decodeURIComponent(raw)
  } catch (error) {
    return raw
  }
}

function inviteErrorState(error) {
  const code = String(error && error.code || '')
  if (code === 'INVALID_INVITE' || code === 'INVITE_UNAVAILABLE') {
    return { status: 'expired', errorMessage: '邀请已失效，请联系对方重新分享。' }
  }
  if (code === 'SOCIAL_PROFILE_REQUIRED') {
    return { status: 'error', errorMessage: '请先完成社交资料初始化后再试。' }
  }
  return { status: 'error', errorMessage: '暂时无法处理邀请，请稍后重试。' }
}

function showToast(title) {
  if (typeof wx !== 'undefined' && wx.showToast) wx.showToast({ title, icon: 'none' })
}

function hideShareMenu() {
  if (typeof wx !== 'undefined' && wx.hideShareMenu) wx.hideShareMenu()
}

function showShareMenu() {
  if (typeof wx !== 'undefined' && wx.showShareMenu) wx.showShareMenu({ menus: ['shareAppMessage'] })
}

Page({
  data: {
    mode: 'mine',
    inviteToken: '',
    inviter: null,
    qrCodeUrl: '',
    qrUnavailable: false,
    expiresAt: 0,
    shareTitle: '邀请你一起记录牌局',
    status: 'loading',
    loading: false,
    generating: false,
    submitting: false,
    errorMessage: ''
  },

  async onLoad(options) {
    hideShareMenu()
    const input = options || {}
    const token = safeDecodeInviteToken(input.scene || input.token)
    this.setData({
      inviteToken: token,
      mode: token ? 'landing' : 'mine',
      errorMessage: ''
    })
    if (token) {
      await this.inspectInvite(true)
      return
    }
    await this.createMyInvite(true)
  },

  async createMyInvite(menuAlreadyHidden) {
    if (this.data.generating) return
    if (!menuAlreadyHidden) hideShareMenu()
    this.setData({ generating: true, loading: true, status: 'loading', errorMessage: '' })
    try {
      const invite = await socialService.createInvite({
        clientMutationId: socialMutation.createMutationId('create_invite')
      })
      const token = String(invite && invite.token || '')
      if (!token) throw new Error('invite token unavailable')
      this.setData({
        inviteToken: token,
        expiresAt: Number(invite && invite.expiresAt) || 0,
        status: 'ready'
      })
      try {
        const qr = await socialService.createInviteQr({
          token,
          clientMutationId: socialMutation.createMutationId('create_invite_qr')
        })
        this.setData({
          qrCodeUrl: String(qr && qr.qrCodeUrl || ''),
          qrUnavailable: !(qr && qr.qrCodeUrl)
        })
      } catch (error) {
        this.setData({ qrCodeUrl: '', qrUnavailable: true })
      }
      showShareMenu()
    } catch (error) {
      this.setData(inviteErrorState(error))
    } finally {
      this.setData({ generating: false, loading: false })
    }
  },

  async inspectInvite(menuAlreadyHidden) {
    const token = String(this.data.inviteToken || '')
    if (!token) return
    if (!menuAlreadyHidden) hideShareMenu()
    this.setData({ loading: true, status: 'loading', errorMessage: '' })
    try {
      const result = await socialService.inspectInvite({ token })
      this.setData({
        inviter: result && result.inviter || null,
        expiresAt: Number(result && result.expiresAt) || 0,
        status: 'ready'
      })
      showShareMenu()
    } catch (error) {
      this.setData(inviteErrorState(error))
    } finally {
      this.setData({ loading: false })
    }
  },

  retry() {
    if (this.data.mode === 'mine') return this.createMyInvite()
    return this.inspectInvite()
  },

  async sendFriendRequest() {
    if (this.data.submitting || !this.data.inviteToken) return
    this.setData({ submitting: true, errorMessage: '' })
    try {
      const result = await socialService.sendFriendRequest({
        token: this.data.inviteToken,
        clientMutationId: socialMutation.createMutationId('friend_request')
      })
      this.setData({
        status: 'sent',
        friendshipId: String(result && result.friendshipId || '')
      })
      hideShareMenu()
      showToast('好友申请已发送')
    } catch (error) {
      this.setData(inviteErrorState(error))
      hideShareMenu()
    } finally {
      this.setData({ submitting: false })
    }
  },

  onShareAppMessage() {
    const token = String(this.data.inviteToken || '')
    if (!token || this.data.status !== 'ready') return undefined
    return {
      title: this.data.shareTitle,
      path: '/pages/social-invite/social-invite?token=' + encodeURIComponent(token)
    }
  }
})
