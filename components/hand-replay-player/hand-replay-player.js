Component({
  properties: {
    replay: {
      type: Object,
      value: null,
      observer: 'resetReplay'
    }
  },
  data: {
    stepIndex: 0,
    playing: false,
    progressPercent: 0,
    currentStep: null,
    displayPlayers: []
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
      const shouldAutoPlay = !!(handId && this.autoPlayedHandId !== handId)
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
      this.setData({
        stepIndex: index,
        currentStep: step ? Object.assign({}, step, {
          boardSlots: new Array(Math.max(0, 5 - boardCards.length)).fill(0).map(function (_, slotIndex) {
            return { id: slotIndex }
          })
        }) : null,
        displayPlayers: players.map(function (player) {
          const isActive = !!(activePosition && player.position === activePosition)
          return Object.assign({}, player, {
            activeClass: isActive ? 'active' : '',
            actionType: isActive && step && step.actionType ? step.actionType : '',
            actionChipText: isActive && step && step.actionChipText ? step.actionChipText : ''
          })
        }),
        progressPercent: max ? Math.round(index / max * 100) : 0
      })
    },
    clearTimer() {
      if (this.replayTimer) {
        clearTimeout(this.replayTimer)
        this.replayTimer = null
      }
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
        }, 1000)
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
    close() {
      this.pause()
      this.triggerEvent('close')
    }
  }
})
