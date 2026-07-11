Component({
  properties: {
    visible: {
      type: Boolean,
      value: false
    },
    step: {
      type: Object,
      value: null
    }
  },
  data: {
    measuredHighlightStyle: '',
    measuredCardStyle: ''
  },
  observers: {
    'visible, step': function () {
      this.scheduleMeasureTarget()
    }
  },
  lifetimes: {
    attached() {
      this.scheduleMeasureTarget()
    }
  },
  methods: {
    noop() {},
    scheduleMeasureTarget() {
      if (!this.data.visible || !this.data.step) return
      this.setData({
        measuredHighlightStyle: this.data.step.highlightStyle || '',
        measuredCardStyle: this.data.step.cardStyle || ''
      })
      clearTimeout(this.measureTimer)
      this.measureTimer = setTimeout(() => {
        this.measureTarget()
      }, 80)
      clearTimeout(this.measureRetryTimer)
      this.measureRetryTimer = setTimeout(() => {
        this.measureTarget()
      }, 260)
    },
    measureTarget() {
      const step = this.data.step || {}
      const targetClass = String(step.targetClass || '').trim()
      if (!this.data.visible || !targetClass || typeof wx === 'undefined' || !wx.createSelectorQuery) return
      const query = wx.createSelectorQuery()
      query.select('.' + targetClass).boundingClientRect()
      query.selectViewport().boundingClientRect()
      query.exec(res => {
        const rect = res && res[0]
        const viewport = res && res[1]
        if (!rect || !viewport || rect.width <= 0 || rect.height <= 0) return
        const padding = 8
        const left = Math.max(12, rect.left - padding)
        const top = Math.max(12, rect.top - padding)
        const width = Math.min(viewport.width - left - 12, rect.width + padding * 2)
        const height = rect.height + padding * 2
        const cardWidth = Math.min(viewport.width - 32, 360)
        const cardLeft = Math.max(16, Math.min(viewport.width - cardWidth - 16, left))
        const spaceBelow = viewport.height - (top + height)
        const cardTop = spaceBelow > 270
          ? top + height + 14
          : Math.max(18, top - 310)
        this.setData({
          measuredHighlightStyle: [
            'left:' + left + 'px',
            'top:' + top + 'px',
            'width:' + width + 'px',
            'height:' + height + 'px'
          ].join(';') + ';',
          measuredCardStyle: [
            'left:' + cardLeft + 'px',
            'top:' + cardTop + 'px',
            'width:' + cardWidth + 'px'
          ].join(';') + ';'
        })
      })
    },
    onSkip() {
      this.triggerEvent('skip')
    },
    onNext() {
      this.triggerEvent('next')
    }
  }
})
