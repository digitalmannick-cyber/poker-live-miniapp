const dataService = require('../../services/data-service')
const voiceParser = require('../../utils/voice-parser')
const voiceService = require('../../services/voice-service')
const cardUi = require('../../utils/card-ui')
const tabBar = require('../../utils/tab-bar')
const display = require('../../utils/display')

function formatActionLine(summary) {
  const source = String(summary || '').trim()
  if (!source) return '暂无行动线'
  return source
    .replace(/翻前/gi, 'PF')
    .replace(/翻牌/gi, 'F')
    .replace(/转牌/gi, 'T')
    .replace(/河牌/gi, 'R')
    .replace(/preflop/gi, 'PF')
    .replace(/flop/gi, 'F')
    .replace(/turn/gi, 'T')
    .replace(/river/gi, 'R')
    .replace(/\s*[；;]\s*/g, '  /  ')
    .replace(/\s*,\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildBoardVisual(board) {
  return cardUi.parseBoardStreets(board)
}

function buildParsedVoicePreview(parsedVoice) {
  if (!parsedVoice) return null
  return Object.assign({}, parsedVoice, {
    heroCardsVisual: cardUi.parseHeroCardsInput(parsedVoice.heroCardsInput),
    boardVisual: buildBoardVisual(parsedVoice.board)
  })
}

function buildVoicePatch(detailHand, parsedVoice, voiceNote) {
  const current = detailHand || {}
  const baseNotes = String(current.notes || '').trim()
  const voiceSummary = String(parsedVoice.noteSummary || '').trim()
  const mergedNotes = [baseNotes, voiceSummary ? ('[语音复盘] ' + voiceSummary) : '']
    .filter(Boolean)
    .join('\n')

  return {
    heroPosition: parsedVoice.heroPosition || current.heroPosition,
    heroCardsInput: parsedVoice.heroCardsInput || current.heroCardsInput,
    effectiveStack: parsedVoice.effectiveStack || current.effectiveStack,
    potSize: parsedVoice.potSize || current.potSize,
    currentProfit: parsedVoice.currentProfit || current.currentProfit,
    board: {
      flop: parsedVoice.board?.flop || current.board?.flop || '',
      turn: parsedVoice.board?.turn || current.board?.turn || '',
      river: parsedVoice.board?.river || current.board?.river || ''
    },
    voiceNote: voiceNote || current.voiceNote || '',
    notes: mergedNotes || current.notes || ''
  }
}

Page({
  data: {
    hands: [],
    sessions: [],
    summary: {
      totalHands: 0,
      totalProfit: 0
    },
    chipUnit: 'BB',
    loading: false,
    selectedSessionId: '',
    detailVisible: false,
    detailLoading: false,
    detailHand: null,
    detailSession: null,
    detailActions: [],
    voicePanelVisible: false,
    voiceBusy: false,
    voiceRecording: false,
    voiceStatus: '',
    voiceNote: '',
    parsedVoice: null
  },
  recorderManager: null,
  recorderBound: false,
  onShow() {
    tabBar.syncCustomTabBar('/pages/review-list/review-list')
    this.refresh()
  },
  ensureRecorderReady() {
    if (this.recorderManager) return this.recorderManager
    if (!wx.getRecorderManager) return null
    this.recorderManager = wx.getRecorderManager()
    if (!this.recorderBound) {
      this.recorderBound = true
      this.recorderManager.onStart(() => {
        this.setData({
          voicePanelVisible: true,
          voiceRecording: true,
          voiceBusy: false,
          voiceStatus: '正在收音，请直接口述这手牌的行动、底池、公牌和输赢'
        })
      })
      this.recorderManager.onStop(async res => {
        this.setData({
          voiceRecording: false,
          voiceBusy: true,
          voiceStatus: '录音完成，正在调用豆包语音识别...'
        })
        try {
          const result = await voiceService.transcribeAudioFile(res.tempFilePath, {
            format: 'aac',
            sampleRate: 16000
          })
          const voiceNote = result.text || ''
          this.setData({
            voicePanelVisible: true,
            voiceBusy: false,
            voiceNote,
            parsedVoice: voiceNote ? buildParsedVoicePreview(voiceParser.parseVoiceText(voiceNote)) : null,
            voiceStatus: '豆包识别完成，已生成语音复盘建议'
          })
          wx.showToast({ title: '语音已识别', icon: 'success' })
        } catch (error) {
          console.warn('voice asr failed', error)
          this.setData({
            voicePanelVisible: true,
            voiceBusy: false,
            voiceStatus: '当前环境未完成豆包识别接入，可直接在下方文本里修正后继续语音复盘'
          })
          wx.showToast({ title: '语音转写未完成，可手动修正文本', icon: 'none' })
        }
      })
      this.recorderManager.onError(error => {
        console.warn('recorder error', error)
        this.setData({
          voiceRecording: false,
          voiceBusy: false,
          voiceStatus: '录音失败，请重新尝试'
        })
        wx.showToast({ title: '录音失败', icon: 'none' })
      })
    }
    return this.recorderManager
  },
  async refresh() {
    this.setData({ loading: true })
    await dataService.bootstrapCloudSync()
    const settings = dataService.getAppSettings()
    const chipUnit = settings.chipUnit
    const data = await dataService.getReviewData({
      sessionId: this.data.selectedSessionId
    })
    const hands = (data.hands || []).map(item => Object.assign({}, item, {
      actionLine: formatActionLine(item.streetSummary),
      currentProfitDisplay: display.formatAmount(item.currentProfit, chipUnit),
      heroCardsVisual: cardUi.parseHeroCardsInput(item.heroCardsInput),
      boardStreetVisual: cardUi.parseBoardStreets(item.board)
    }))
    this.setData(Object.assign({}, data, {
      hands,
      chipUnit,
      summary: Object.assign({}, data.summary, {
        totalProfitDisplay: display.formatAmount(data.summary.totalProfit, chipUnit)
      }),
      loading: false
    }))
  },
  selectSession(e) {
    const sessionId = e.currentTarget.dataset.id || ''
    this.setData({
      selectedSessionId: this.data.selectedSessionId === sessionId ? '' : sessionId
    })
    this.refresh()
  },
  async loadHandDetail(handId) {
    const hand = await dataService.getHandById(handId)
    if (!hand) {
      this.setData({ detailLoading: false, detailVisible: false })
      wx.showToast({ title: '未找到这手牌', icon: 'none' })
      return
    }
    const session = await dataService.getSessionById(hand.sessionId)
    const actions = await dataService.getActionsByHandId(handId)
    this.setData({
      detailLoading: false,
      detailHand: Object.assign({}, hand, {
        currentProfitDisplay: display.formatAmount(hand.currentProfit, this.data.chipUnit),
        actionLine: formatActionLine(hand.streetSummary),
        boardVisual: buildBoardVisual(hand.board),
        tagsText: (hand.tags || []).join(' · '),
        heroCardsVisual: cardUi.parseHeroCardsInput(hand.heroCardsInput)
      }),
      detailSession: session,
      detailActions: actions,
      voicePanelVisible: false,
      voiceBusy: false,
      voiceRecording: false,
      voiceStatus: '',
      voiceNote: hand.voiceNote || '',
      parsedVoice: null
    })
  },
  async openHandDetail(e) {
    const handId = e.currentTarget.dataset.id
    if (!handId) return
    this.setData({
      detailVisible: true,
      detailLoading: true,
      detailHand: null,
      detailSession: null,
      detailActions: []
    })
    await this.loadHandDetail(handId)
  },
  closeHandDetail() {
    if (this.data.voiceRecording && this.recorderManager) {
      try {
        this.recorderManager.stop()
      } catch (error) {
        console.warn('stop recorder on close failed', error)
      }
    }
    this.setData({
      detailVisible: false,
      detailLoading: false,
      detailHand: null,
      detailSession: null,
      detailActions: [],
      voicePanelVisible: false,
      voiceBusy: false,
      voiceRecording: false,
      voiceStatus: '',
      voiceNote: '',
      parsedVoice: null
    })
  },
  stopModalTap() {},
  onVoiceNoteInput(e) {
    this.setData({ voiceNote: e.detail.value })
  },
  requestRecordPermission() {
    return new Promise(resolve => {
      wx.authorize({
        scope: 'scope.record',
        success: () => resolve(true),
        fail: () => {
          wx.getSetting({
            success: setting => {
              if (setting.authSetting && setting.authSetting['scope.record']) {
                resolve(true)
                return
              }
              wx.showModal({
                title: '需要麦克风权限',
                content: '语音复盘需要使用麦克风，请在设置中允许录音权限后再试。',
                confirmText: '去设置',
                success: res => {
                  if (res.confirm) wx.openSetting()
                  resolve(false)
                },
                fail: () => resolve(false)
              })
            },
            fail: () => resolve(false)
          })
        }
      })
    })
  },
  async startVoiceInput() {
    if (this.data.voiceBusy || !this.data.detailHand) return
    const granted = await this.requestRecordPermission()
    if (!granted) return
    const recorder = this.ensureRecorderReady()
    if (!recorder) {
      wx.showToast({ title: '当前环境不支持录音', icon: 'none' })
      return
    }
    this.setData({
      voicePanelVisible: true,
      parsedVoice: null,
      voiceStatus: '正在准备录音...'
    })
    recorder.start({
      duration: 60000,
      sampleRate: 16000,
      numberOfChannels: 1,
      encodeBitRate: 96000,
      format: 'aac'
    })
  },
  stopVoiceInput() {
    if (!this.recorderManager) return
    this.setData({ voiceStatus: '正在结束录音...' })
    this.recorderManager.stop()
  },
  handleVoiceEntry() {
    if (this.data.voiceRecording) {
      this.stopVoiceInput()
      return
    }
    this.startVoiceInput()
  },
  parseVoiceNote() {
    if (!this.data.voiceNote) {
      wx.showToast({ title: '请先录音或输入文本', icon: 'none' })
      return
    }
    const parsedVoice = buildParsedVoicePreview(voiceParser.parseVoiceText(this.data.voiceNote))
    this.setData({
      voicePanelVisible: true,
      parsedVoice,
      voiceStatus: '已生成语音复盘建议，请确认后回填'
    })
    wx.showToast({ title: '语音复盘建议已生成', icon: 'success' })
  },
  async applyVoicePatch() {
    if (!this.data.detailHand || !this.data.parsedVoice) {
      wx.showToast({ title: '暂无可回填内容', icon: 'none' })
      return
    }
    this.setData({ voiceBusy: true, voiceStatus: '正在回填这手牌...' })
    await dataService.updateHand(
      this.data.detailHand._id,
      buildVoicePatch(this.data.detailHand, this.data.parsedVoice, this.data.voiceNote)
    )
    await this.refresh()
    await this.loadHandDetail(this.data.detailHand._id)
    this.setData({
      voicePanelVisible: true,
      voiceBusy: false,
      voiceStatus: '语音复盘已回填到这手牌'
    })
    wx.showToast({ title: '语音复盘已回填', icon: 'success' })
  },
  goHandDetailPage() {
    const handId = this.data.detailHand && this.data.detailHand._id
    if (!handId) return
    wx.navigateTo({ url: '/pages/hand-detail/hand-detail?id=' + handId })
  }
})
