const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const wxml = fs.readFileSync(path.join(root, 'pages/review-list/review-list.wxml'), 'utf8')
const wxss = fs.readFileSync(path.join(root, 'pages/review-list/review-list.wxss'), 'utf8')
const js = fs.readFileSync(path.join(root, 'pages/review-list/review-list.js'), 'utf8')

assert.ok(
  wxml.includes('class="review-voice-entry"') && wxml.includes('bindtap="handleVoiceEntry"'),
  'review detail should expose a visible voice review entry button'
)

assert.ok(
  js.includes('handleVoiceEntry()') && js.includes('voicePanelVisible: true'),
  'voice review entry should expand the voice input panel'
)

assert.ok(
  /\.review-voice-entry\s*\{[\s\S]*display:\s*flex;[\s\S]*min-height:\s*88rpx;/.test(wxss),
  'voice review entry should be styled as a clear tappable row'
)

console.log('review voice entry tests passed')
