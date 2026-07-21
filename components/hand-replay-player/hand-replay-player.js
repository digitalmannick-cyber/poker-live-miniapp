Component({
  properties: {
    replay: {
      type: Object,
      value: null,
      observer: 'resetReplay'
    },
    closable: {
      type: Boolean,
      value: true
    },
    autoPlay: {
      type: Boolean,
      value: true
    },
    compact: {
      type: Boolean,
      value: false
    },
    stepDuration: {
      type: Number,
      value: 1400
    }
  },
  data: {
    stepIndex: 0,
    playing: false,
    progressPercent: 0,
    currentStep: null,
    displayPlayers: [],
    timelineItems: [],
    currentStreetLabel: 'PF',
    motionClass: 'motion-even',
    streetMotionClass: '',
    privacyLabel: '',
    tableAssetReady: false
  },
  lifetimes: {
    detached() {
      this.clearTimer()
    }
  },
  methods: {
    noop() {},
    resetReplay() {
      this.clearTimer()
      const replay = this.properties.replay || {}
      const handId = replay.handId || ''
      const shouldAutoPlay = !!(this.properties.autoPlay && handId && this.autoPlayedHandId !== handId)
      if (shouldAutoPlay) this.autoPlayedHandId = handId
      this.setData({
        stepIndex: 0,
        playing: false
      }, () => {
        this.renderStep()
        if (shouldAutoPlay && this.getSteps().length > 1) this.play()
      })
    },
    getSteps() {
      return (this.properties.replay && this.properties.replay.steps) || []
    },
    renderStep() {
      const steps = this.getSteps()
      const max = Math.max(0, steps.length - 1)
      const index = Math.min(Math.max(0, Number(this.data.stepIndex) || 0), max)
      const step = steps[index] || null
      const boardCards = step && step.boardCards || []
      const players = (this.properties.replay && this.properties.replay.players) || []
      const activePosition = step && step.actorPosition
      const foldedPositions = {}
      steps.slice(0, index + 1).forEach(function (candidate) {
        if (candidate && candidate.actionType === 'fold' && candidate.actorPosition) foldedPositions[candidate.actorPosition] = true
      })
      const start = Math.max(0, Math.min(index - 2, Math.max(0, steps.length - 5)))
      const timelineItems = steps.slice(start, start + 5).map(function (candidate, offset) {
        const absoluteIndex = start + offset
        return Object.assign({}, candidate, {
          timelineIndex: absoluteIndex,
          timelineClass: absoluteIndex === index ? 'is-current' : (absoluteIndex < index ? 'is-past' : 'is-future')
        })
      })
      const previousStreet = this.data.currentStep && this.data.currentStep.street
      this.setData({
        stepIndex: index,
        currentStep: step ? Object.assign({}, step, {
          actorPositionClass: String(step.actorPosition || '').toLowerCase().replace(/\+/, 'plus').replace(/\W+/g, '-'),
          boardSlots: new Array(Math.max(0, 5 - boardCards.length)).fill(0).map(function (_, slotIndex) {
            return { id: slotIndex }
          })
        }) : null,
        displayPlayers: players.map(function (player) {
          const isActive = !!(activePosition && player.position === activePosition)
          const heroCards = (this.properties.replay && this.properties.replay.heroCards) || []
          const holeCards = player.isHero
            ? heroCards.slice(0, 2).map(function (card, cardIndex) { return Object.assign({ id: 'hero-' + cardIndex, hidden: false }, card) })
            : [{ id: player.id + '-back-1', hidden: true }, { id: player.id + '-back-2', hidden: true }]
          return Object.assign({}, player, {
            activeClass: isActive ? 'active' : '',
            foldedClass: foldedPositions[player.position] ? 'folded' : '',
            actionType: isActive && step && step.actionType ? step.actionType : '',
            actionChipText: isActive && step && step.actionChipText ? step.actionChipText : '',
            holeCards
          })
        }, this),
        timelineItems,
        currentStreetLabel: step && step.streetLabel ? step.streetLabel : 'PF',
        motionClass: index % 2 ? 'motion-odd' : 'motion-even',
        streetMotionClass: previousStreet && step && previousStreet !== step.street ? 'street-change' : '',
        privacyLabel: this.properties.replay && this.properties.replay.privacyMode ? '匿名 · BB' : '',
        progressPercent: max ? Math.round(index / max * 100) : 0
      })
      if (this.streetMotionTimer) clearTimeout(this.streetMotionTimer)
      if (previousStreet && step && previousStreet !== step.street) {
        this.streetMotionTimer = setTimeout(() => this.setData({ streetMotionClass: '' }), 360)
      }
    },
    clearTimer() {
      if (this.replayTimer) {
        clearTimeout(this.replayTimer)
        this.replayTimer = null
      }
      if (this.streetMotionTimer) {
        clearTimeout(this.streetMotionTimer)
        this.streetMotionTimer = null
      }
    },
    onTableAssetLoad() {
      this.setData({ tableAssetReady: true })
    },
    onTableAssetError() {
      this.setData({ tableAssetReady: false })
    },
    play() {
      const steps = this.getSteps()
      if (!steps.length) return
      this.clearTimer()
      const max = steps.length - 1
      const nextIndex = this.data.stepIndex >= max ? 0 : this.data.stepIndex
      this.setData({ playing: true, stepIndex: nextIndex }, () => {
        this.renderStep()
        this.replayTimer = setTimeout(() => {
          if (!this.data.playing) return
          if (this.data.stepIndex >= max) {
            this.pause()
            return
          }
          this.setData({ stepIndex: this.data.stepIndex + 1 }, () => {
            this.renderStep()
            this.play()
          })
        }, Math.max(900, Number(this.properties.stepDuration) || 1400))
      })
    },
    pause() {
      this.clearTimer()
      this.setData({ playing: false }, () => this.renderStep())
    },
    togglePlay() {
      if (this.data.playing) {
        this.pause()
      } else {
        this.play()
      }
    },
    prevStep() {
      this.pause()
      this.setData({ stepIndex: Math.max(0, this.data.stepIndex - 1) }, () => this.renderStep())
    },
    nextStep() {
      const steps = this.getSteps()
      this.pause()
      this.setData({ stepIndex: Math.min(Math.max(0, steps.length - 1), this.data.stepIndex + 1) }, () => this.renderStep())
    },
    jumpToStep(event) {
      const index = Number(event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.index)
      if (!Number.isInteger(index) || index < 0 || index >= this.getSteps().length) return
      this.pause()
      this.setData({ stepIndex: index }, () => this.renderStep())
    },
    close() {
      this.pause()
      this.triggerEvent('close')
    }
  }
})
