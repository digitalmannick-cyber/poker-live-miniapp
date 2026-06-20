const assert = require('assert')
const fs = require('fs')

const sessionListJs = fs.readFileSync('pages/session-list/session-list.js', 'utf8')
const sessionListWxml = fs.readFileSync('pages/session-list/session-list.wxml', 'utf8')
const sessionListWxss = fs.readFileSync('pages/session-list/session-list.wxss', 'utf8')
const handRecordJs = fs.readFileSync('pages/hand-record/hand-record.js', 'utf8')
const sessionDetailJs = fs.readFileSync('pages/session-detail/session-detail.js', 'utf8')

assert.match(sessionListJs, /require\('\.\.\/\.\.\/utils\/session-rules'\)/)
assert.match(sessionListJs, /activeSession:/)
assert.match(sessionListJs, /goNewSession\(\)[\s\S]*ACTIVE_SESSION_MESSAGE/)
assert.match(sessionListWxml, /new-session-btn \{\{activeSession \? 'disabled' : ''\}\}/)
assert.match(sessionListWxss, /\.new-session-btn\.disabled/)

assert.match(handRecordJs, /require\('\.\.\/\.\.\/utils\/session-rules'\)/)
assert.match(handRecordJs, /goCreateSession\(\)[\s\S]*ACTIVE_SESSION_MESSAGE/)

assert.match(sessionDetailJs, /require\('\.\.\/\.\.\/utils\/session-rules'\)/)
assert.match(sessionDetailJs, /guardCreateMode\(\)/)
assert.match(sessionDetailJs, /ACTIVE_SESSION_ERROR_CODE/)
assert.match(sessionDetailJs, /创建失败，请稍后重试/)

console.log('session create entry guard tests passed')
