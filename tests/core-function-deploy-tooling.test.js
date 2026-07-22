const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const source = fs.readFileSync(path.resolve(__dirname, '../tools/deploy-core-function-code.ps1'), 'utf8')

test('core function deployment is fixed-environment, commit-bound and allowlisted', () => {
  assert.match(source, /ValidateSet\('poker_data', 'poker_review'\)/)
  assert.match(source, /cloud1-d3ggy9aq3be912e34/)
  assert.match(source, /ExpectedCommit does not exactly match HEAD/)
  assert.match(source, /Remote function is not active and available/)
})

test('core function deployment preserves secrets without printing environment values', () => {
  assert.match(source, /EnvironmentMap \$before/)
  assert.match(source, /envVariables = \$expectedEnvironment/)
  assert.match(source, /Function environment variables changed unexpectedly/)
  assert.doesNotMatch(source, /Write-(Host|Output).*expectedEnvironment/)
  assert.match(source, /New-SecureTemporaryDirectory/)
  assert.match(source, /Refusing to remove an unexpected temporary path/)
})

test('core function deployment verifies a source marker after CloudBase becomes available', () => {
  assert.match(source, /MANAGED_PRIVATE_FILE_PREFIXES/)
  assert.match(source, /pseudonymousAgentUserId/)
  assert.match(source, /Deployed source marker verification failed/)
})
