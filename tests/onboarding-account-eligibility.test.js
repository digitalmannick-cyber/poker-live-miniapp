const test = require('node:test')
const assert = require('node:assert/strict')

const storage = {}
global.wx = {
  getStorageSync(key) {
    return storage[key]
  },
  setStorageSync(key, value) {
    storage[key] = value
  },
  removeStorageSync(key) {
    delete storage[key]
  }
}

const onboardingGuide = require('../utils/onboarding-guide')

function resetStorage() {
  Object.keys(storage).forEach(key => delete storage[key])
  onboardingGuide.setGuideContext({ accountId: '', hasRealData: false })
}

test('new account with no real data auto shows onboarding', () => {
  resetStorage()
  onboardingGuide.setGuideContext({ accountId: 'WX-NEW', hasRealData: false })

  assert.equal(onboardingGuide.shouldAutoShowGuide(), true)
})

test('account with real data does not auto show onboarding', () => {
  resetStorage()
  onboardingGuide.setGuideContext({ accountId: 'WX-EXISTING', hasRealData: true })

  assert.equal(onboardingGuide.shouldAutoShowGuide(), false)
})

test('dismissed onboarding is stored per account', () => {
  resetStorage()
  onboardingGuide.setGuideContext({ accountId: 'WX-A', hasRealData: false })
  onboardingGuide.dismissGuide()
  assert.equal(onboardingGuide.shouldAutoShowGuide(), false)

  onboardingGuide.setGuideContext({ accountId: 'WX-B', hasRealData: false })
  assert.equal(onboardingGuide.shouldAutoShowGuide(), true)
})

test('manual restart can show onboarding even when account has real data', () => {
  resetStorage()
  onboardingGuide.setGuideContext({ accountId: 'WX-EXISTING', hasRealData: true })

  onboardingGuide.resetGuide()

  assert.equal(onboardingGuide.shouldAutoShowGuide(), true)
})

test('started onboarding continues if user creates first real record during the flow', () => {
  resetStorage()
  onboardingGuide.setGuideContext({ accountId: 'WX-NEW', hasRealData: false })
  assert.equal(onboardingGuide.shouldAutoShowGuide(), true)

  onboardingGuide.advanceGuide()
  onboardingGuide.setGuideContext({ accountId: 'WX-NEW', hasRealData: true })

  assert.equal(onboardingGuide.shouldAutoShowGuide(), true)
})
