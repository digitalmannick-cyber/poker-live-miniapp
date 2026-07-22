const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const reviewSurfaceFiles = [
  'utils/onboarding-demo-data.js',
  'utils/onboarding-guide.js',
  'pages/session-list/session-list.js',
  'pages/session-detail/session-detail.js',
  'pages/session-detail/session-detail.wxml',
  'pages/review-list/review-list.js',
  'pages/hand-record/hand-record.js',
  'pages/hand-detail/hand-detail.js'
]

test('first-use and review surfaces avoid gambling-like launch copy', () => {
  for (const relativePath of reviewSurfaceFiles) {
    const source = fs.readFileSync(path.join(root, relativePath), 'utf8')
    assert.doesNotMatch(source, /澳门|MGM|永利|威尼斯人|现金局教练|提现/, relativePath)
  }
})

test('session settlement is described as ending chips', () => {
  const markup = fs.readFileSync(path.join(root, 'pages/session-detail/session-detail.wxml'), 'utf8')
  const logic = fs.readFileSync(path.join(root, 'pages/session-detail/session-detail.js'), 'utf8')
  assert.match(markup, />结束筹码</)
  assert.match(logic, /请先填写结束筹码/)
})

test('prominent result surfaces explain that records are user-entered and not platform settlement', () => {
  for (const relativePath of ['pages/stats/stats.wxml', 'pages/profile/profile.wxml']) {
    const source = fs.readFileSync(path.join(root, relativePath), 'utf8')
    assert.match(source, /来自用户自行录入/)
    assert.match(source, /不代表真实资产或平台结算/)
  }
})
