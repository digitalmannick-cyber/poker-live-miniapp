function normalizeAmount(value) {
  const amount = Math.max(0, Math.round(Number(value) || 0))
  return String(amount)
}

Component({
  properties: {
    visible: {
      type: Boolean,
      value: false,
      observer(visible) {
        if (visible) this.syncDraft(this.properties.value)
      }
    },
    title: { type: String, value: '' },
    value: {
      type: Number,
      value: 0,
      observer(value) {
        if (this.properties.visible) this.syncDraft(value)
      }
    },
    unit: { type: String, value: '' },
    presets: { type: Array, value: [] },
    max: { type: Number, value: 100000 },
    accent: { type: String, value: '#ffd429' },
    secondaryLabel: { type: String, value: '' }
  },

  data: {
    draft: '0',
    activePresetValue: 0
  },

  methods: {
    noop() {},

    syncDraft(value) {
      const draft = normalizeAmount(value)
      const amount = Number(draft)
      const active = (this.properties.presets || []).some(item => Number(item.value) === amount)
        ? amount
        : 0
      this.setData({ draft, activePresetValue: active })
    },

    appendDigit(e) {
      const digit = String(e.currentTarget.dataset.digit || '')
      if (!/^\d$/.test(digit)) return
      const current = String(this.data.draft || '0')
      const next = current === '0' ? digit : current + digit
      this.setData({ draft: next, activePresetValue: 0 })
    },

    applyPreset(e) {
      const amount = Math.max(0, Math.round(Number(e.currentTarget.dataset.value) || 0))
      this.setData({ draft: String(amount), activePresetValue: amount })
    },

    clearDraft() {
      this.setData({ draft: '0', activePresetValue: 0 })
    },

    backspaceDraft() {
      const current = String(this.data.draft || '0')
      const next = current.length > 1 ? current.slice(0, -1) : '0'
      this.setData({ draft: next, activePresetValue: 0 })
    },

    onSliderChange(e) {
      this.syncDraft(e.detail.value)
    },

    close() {
      this.triggerEvent('close')
    },

    validAmount() {
      const value = Math.round(Number(this.data.draft) || 0)
      const max = Math.max(0, Number(this.properties.max) || 0)
      return value > 0 && (!max || value <= max) ? value : 0
    },

    showInvalidAmount() {
      if (typeof wx !== 'undefined' && wx.showToast) {
        wx.showToast({ title: '请输入有效金额', icon: 'none' })
      }
    },

    confirm() {
      const value = this.validAmount()
      if (!value) return this.showInvalidAmount()
      this.triggerEvent('confirm', { value })
    },

    secondary() {
      const value = this.validAmount()
      if (!value) return this.showInvalidAmount()
      this.triggerEvent('secondary', { value })
    }
  }
})
