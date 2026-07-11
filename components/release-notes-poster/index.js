Component({
  properties: {
    visible: {
      type: Boolean,
      value: false
    },
    notes: {
      type: Object,
      value: null
    }
  },

  data: {
    imageFailed: false
  },

  observers: {
    visible(value) {
      if (value) this.setData({ imageFailed: false })
    }
  },

  methods: {
    noop() {},

    onImageError() {
      this.setData({ imageFailed: true })
    },

    onAcknowledge() {
      this.triggerEvent('acknowledge')
    }
  }
})
