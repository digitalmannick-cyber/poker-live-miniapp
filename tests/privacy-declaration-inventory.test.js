const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const inventory = fs.readFileSync(path.join(root, 'docs/superpowers/specs/2026-07-22-privacy-declaration-inventory.md'), 'utf8')

function source(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

test('privacy inventory covers every user-triggered sensitive mini-program capability', () => {
  const cases = [
    ['pages/profile/profile.js', /wx\.chooseImage\(/, '相册图片/拍照结果'],
    ['pages/player-note-detail/player-note-detail.js', /wx\.chooseMedia\(/, '相册图片/拍照结果'],
    ['pages/profile/profile.js', /wx\.getClipboardData\(/, '剪贴板'],
    ['pages/profile/profile.js', /wx\.chooseMessageFile\(/, '微信消息文件'],
    ['services/data-service.js', /wx\.requestSubscribeMessage\(/, '订阅消息授权'],
    ['pages/profile/profile.wxml', /open-type="chooseAvatar"/, '头像'],
    ['pages/profile/profile.wxml', /type="nickname"/, '昵称'],
    ['pages/profile/profile.wxml', /open-type="contact"/, '客服会话']
  ]
  for (const [file, usage, declaration] of cases) {
    assert.match(source(file), usage, `${file} should still contain the audited capability`)
    assert.match(inventory, new RegExp(declaration), `${declaration} must stay in the privacy inventory`)
  }
})

test('privacy inventory states current public/private and AI identity boundaries', () => {
  for (const phrase of [
    '不发送原始微信 OpenID',
    '不可逆的稳定匿名 ID',
    '当前正式候选界面不申请麦克风权限',
    '原始盈利/金额',
    '清除所有数据时删除本应用管理的云存储头像文件'
  ]) assert.match(inventory, new RegExp(phrase))
})
