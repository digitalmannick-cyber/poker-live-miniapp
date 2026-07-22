const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const source = fs.readFileSync(path.resolve(__dirname, '..', 'tools', 'harden-function-logging.ps1'), 'utf8')

test('function log hardening is read-only by default and fixed to user-data functions', () => {
  assert.match(source, /\[switch\]\$Apply/)
  assert.match(source, /@\('poker_social', 'poker_data', 'poker_review', 'doubao_asr'\)/)
  assert.match(source, /Read-only preflight only/)
  assert.doesNotMatch(source, /param\([\s\S]*\[switch\]\$Force/)
})

test('function log hardening requires exact environment and commit confirmations', () => {
  assert.match(source, /ConfirmEnvironmentId does not exactly match/)
  assert.match(source, /ExpectedCommit does not exactly match HEAD/)
  assert.match(source, /cloud1-d3ggy9aq3be912e34/)
  assert.match(source, /ap-shanghai/)
})

test('function log hardening disables platform response logs and verifies the remote result', () => {
  assert.match(source, /UpdateFunctionConfiguration/)
  assert.match(source, /IgnoreSysLog = \$true/)
  assert.match(source, /\$body\.Replace\('\"', '\\\"'\)/)
  assert.match(source, /Get-FunctionPrivacyState/)
  assert.match(source, /did not enable IgnoreSysLog/)
  assert.match(source, /attempt -lt 3/)
  assert.match(source, /CloudBase CLI operation failed after retries/)
  assert.doesNotMatch(source, /Write-Output \$raw|Write-Host \$raw/)
})
