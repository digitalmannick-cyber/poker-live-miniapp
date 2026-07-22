const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const source = fs.readFileSync(path.resolve(__dirname, '../tools/production-environment-switch.ps1'), 'utf8')

test('production switch defaults to read-only and requires explicit published confirmation', () => {
  assert.match(source, /DefaultParameterSetName = 'Check'/)
  assert.match(source, /\[switch\]\$ConfirmPublished/)
  assert.match(source, /ConfirmEnvironmentId does not exactly match the fixed production environment/)
  assert.match(source, /ConfirmVersion does not exactly match the release candidate/)
  assert.match(source, /no changes applied/)
})

test('production switch changes both WeChat environment enums together', () => {
  assert.match(source, /SOCIAL_INVITE_QR_ENV_VERSION = 'release'/)
  assert.match(source, /AI_REMINDER_MINIPROGRAM_STATE = 'formal'/)
  assert.match(source, /invite=release; reminder=formal/)
})

test('production switch preserves all existing variables and attempts rollback on partial failure', () => {
  assert.match(source, /foreach \(\$key in \$original\[\$functionName\]\.Keys\)/)
  assert.match(source, /Test-EnvironmentEqual \$next \$verified/)
  assert.match(source, /foreach \(\$functionName in \$updated\)/)
  assert.doesNotMatch(source, /Write-(Host|Output).*original|Write-(Host|Output).*Environment/)
  assert.match(source, /New-SecureTemporaryDirectory/)
})
