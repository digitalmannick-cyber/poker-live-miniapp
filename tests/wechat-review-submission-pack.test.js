const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const pack = fs.readFileSync(path.join(root, 'docs/superpowers/specs/2026-07-22-wechat-review-submission-pack.md'), 'utf8')
const version = require('../config/app-version').displayVersion

test('review submission pack is bound to the current mini-program candidate', () => {
  assert.match(pack, new RegExp(`候选版本：\`${version.replace('.', '\\.')}\``))
  assert.match(pack, /1\.0\.20260722\.2325\.v3\.39/)
  assert.match(pack, /v3\.39-launch-ready\.2/)
})

test('review copy states the real product and excludes gambling or settlement claims', () => {
  for (const phrase of ['牌谱记录', '复盘', '不提供在线对局', '不提供扑克游戏', '不组织牌局', '不展示真实金额']) {
    assert.match(pack, new RegExp(phrase))
  }
})

test('review pack includes privacy, content safety, reviewer path and true-device evidence gates', () => {
  for (const phrase of ['内容安全接口', '清除所有数据', '审核员体验路径', '体验版真机验收记录', '公众平台截图证据']) {
    assert.match(pack, new RegExp(phrase))
  }
  assert.match(pack, /T01[\s\S]*T14/)
})
