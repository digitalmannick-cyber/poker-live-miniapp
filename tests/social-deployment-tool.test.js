const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const deployment = require('../tools/lib/social-deployment-plan')

test('deployment plan owns only the 20 fail-closed social collections', () => {
  const plan = deployment.buildPlan(root)
  assert.equal(plan.envId, deployment.EXPECTED_ENV_ID)
  assert.equal(plan.functionName, 'poker_social')
  assert.equal(plan.managedCollections.length, 20)
  assert.deepEqual(plan.externalCollections, ['hand_actions'])
  assert.equal(plan.indexes.length, 31)
  assert.equal(plan.indexes.filter(index => index.ownership === 'external').length, 2)
  assert(plan.indexes.filter(index => index.ownership === 'external')
    .every(index => index.collection === 'hand_actions'))
})

test('deployment index names and API shapes are deterministic and CloudBase-compatible', () => {
  const plan = deployment.buildPlan(root)
  const names = new Set()
  for (const index of plan.indexes) {
    assert.match(index.name, /^idx_[A-Za-z0-9_]+_[a-f0-9]{16}$/)
    assert(index.name.length <= 64)
    assert(!names.has(index.name), `duplicate generated name: ${index.name}`)
    names.add(index.name)
    assert.equal(deployment.stableIndexName(index.collection, index.fields), index.name)

    const body = deployment.createIndexBody(plan, index, 'tnt-test')
    assert.equal(body.TableName, index.collection)
    assert.equal(body.Tag, 'tnt-test')
    assert.equal(body.EnvId, plan.envId)
    assert.deepEqual(body.CreateIndexes[0].MgoKeySchema.MgoIndexKeys,
      index.fields.map(field => ({ Name: field.name, Direction: field.direction })))
    assert.equal(body.CreateIndexes[0].MgoKeySchema.MgoIsUnique, false)
    assert.equal(body.CreateIndexes[0].MgoKeySchema.MgoIsSparse, false)
  }

  const arrayIndex = plan.indexes.find(index => index.canonical.includes('targetUserIds:1'))
  assert(arrayIndex)
  assert.equal(arrayIndex.fields.find(field => field.name === 'targetUserIds').direction, '1')
})

test('create-table API is restricted to managed collections and starts ADMINONLY', () => {
  const plan = deployment.buildPlan(root)
  const body = deployment.createTableBody(plan, 'social_users', 'tnt-test')
  assert.deepEqual(body, {
    TableName: 'social_users',
    Tag: 'tnt-test',
    EnvId: deployment.EXPECTED_ENV_ID,
    PermissionInfo: { AclTag: 'ADMINONLY', EnvId: deployment.EXPECTED_ENV_ID }
  })
  assert.throws(
    () => deployment.createTableBody(plan, 'hand_actions', 'tnt-test'),
    /refusing to create an external collection/
  )
})

test('PowerShell entrypoint is read-only by default and fail-closed for writes', () => {
  const source = fs.readFileSync(path.join(root, 'tools', 'social-deploy.ps1'), 'utf8')
  assert.match(source, /DefaultParameterSetName = 'Preflight'/)
  assert.match(source, /ParameterSetName = 'Apply', Mandatory = \$true[\s\S]*\[string\]\$PlanId/)
  assert.match(source, /ConfirmEnvironmentId does not exactly match/)
  assert.match(source, /ExpectedCommit does not exactly match HEAD/)
  assert.match(source, /PlanId is stale/)
  assert.match(source, /External dependency .* this tool will not create it or change its ACL/)
  assert.match(source, /Read-only preflight complete\. No cloud resources were changed\./)

  const readOnlyExit = source.indexOf("Read-only preflight complete. No cloud resources were changed.")
  const createTable = source.indexOf("Invoke-TcbApi 'CreateTable'")
  assert(readOnlyExit > 0 && createTable > readOnlyExit)
})

test('deployment never accepts secrets as parameters and never contains destructive cloud rollback', () => {
  const source = fs.readFileSync(path.join(root, 'tools', 'social-deploy.ps1'), 'utf8')
  const parameterBlock = source.slice(0, source.indexOf('Set-StrictMode'))
  assert.doesNotMatch(parameterBlock, /InviteTokenSecret|AdminOpenIds/)
  assert.match(source, /\$env:SOCIAL_INVITE_TOKEN_SECRET/)
  assert.match(source, /\$env:SOCIAL_ADMIN_OPENIDS/)
  assert.doesNotMatch(source, /DeleteTable|DropIndexes|fn['" ]+delete|--all/i)
  assert.match(source, /No collection, document, or index was deleted/)
  assert.match(source, /Get-FunctionEnvironmentMap/)
  assert.match(source, /implicit rotation is forbidden/)
})

test('administrator capability is enabled only after disabled staging and database verification', () => {
  const source = fs.readFileSync(path.join(root, 'tools', 'social-deploy.ps1'), 'utf8')
  const disabledStage = source.indexOf("$stagedEnvironment.Remove('SOCIAL_ADMIN_OPENIDS')")
  const permissionVerify = source.indexOf('$postPermissions =', disabledStage)
  const indexVerify = source.indexOf("Post-deploy index verification failed", permissionVerify)
  const stagedDeploy = source.indexOf('$stagedCheck = Deploy-AndWaitFunctionEnvironment', indexVerify)
  const enabledDeploy = source.indexOf('$enabledCheck = Deploy-AndWaitFunctionEnvironment', stagedDeploy)
  assert(disabledStage > 0)
  assert(permissionVerify > disabledStage)
  assert(indexVerify > permissionVerify)
  assert(stagedDeploy > indexVerify)
  assert(enabledDeploy > stagedDeploy)
  assert.match(source, /Administrator fail-close verified/)
})

test('PowerShell 5.1 compatibility and tracked-input gate are explicit', () => {
  const source = fs.readFileSync(path.join(root, 'tools', 'social-deploy.ps1'), 'utf8')
  assert.doesNotMatch(source, /Convert\]::ToHexString/)
  assert.match(source, /\[BitConverter\]::ToString/)
  assert.match(source, /git -C \$Root status --porcelain=v1/)
  assert.match(source, /differ from HEAD or are untracked/)
})

test('secrets use an ACL-restricted temporary config and never an API body argument', () => {
  const source = fs.readFileSync(path.join(root, 'tools', 'social-deploy.ps1'), 'utf8')
  assert.doesNotMatch(source, /UpdateFunctionConfiguration/)
  assert.match(source, /SetAccessRuleProtection\(\$true, \$false\)/)
  assert.match(source, /Secrets are read from the ACL-restricted config file/)
  assert.match(source, /Remove-Item -LiteralPath \$temporaryDirectory -Recurse -Force/)
  assert.match(source, /RedirectStandardOutput = \$true/)
  assert.match(source, /RedirectStandardError = \$true/)
  assert.match(source, /WaitForExit\(\$TimeoutMilliseconds\)/)
  assert.match(source, /'config', 'update', 'fn', 'poker_social'/)
})

test('planner rejects any external index collection other than hand_actions', () => {
  const os = require('node:os')
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'social-plan-test-'))
  try {
    const temporarySocialRoot = path.join(temporaryRoot, 'cloudfunctions', 'poker_social')
    fs.mkdirSync(temporarySocialRoot, { recursive: true })
    for (const file of ['cloudbaserc.social.json']) {
      fs.copyFileSync(path.join(root, file), path.join(temporaryRoot, file))
    }
    for (const file of ['database-security-rules.json', 'database-indexes.json']) {
      fs.copyFileSync(path.join(root, 'cloudfunctions', 'poker_social', file), path.join(temporarySocialRoot, file))
    }
    const indexesPath = path.join(temporarySocialRoot, 'database-indexes.json')
    const manifest = JSON.parse(fs.readFileSync(indexesPath, 'utf8'))
    manifest.indexes[0].collection = 'social_friendship_typo'
    fs.writeFileSync(indexesPath, JSON.stringify(manifest))
    assert.throws(() => deployment.buildPlan(temporaryRoot), /external index collections must be exactly hand_actions/)
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
  }
})

test('apply validates inputs before locking or mutating and supports a zero-write converged path', () => {
  const source = fs.readFileSync(path.join(root, 'tools', 'social-deploy.ps1'), 'utf8')
  const adminValidation = source.indexOf("$adminOpenIds = [string]$env:SOCIAL_ADMIN_OPENIDS")
  const mutex = source.indexOf("$mutexName = 'Global\\PokerLiveSocialDeploy_'")
  const createTable = source.indexOf("Invoke-TcbApi 'CreateTable'")
  assert(adminValidation > 0 && adminValidation < mutex)
  assert(mutex < createTable)
  assert.match(source, /Apply is already fully converged\. No cloud resources were changed\./)
  assert.match(source, /\$mutationStarted -and \$functionMayExist/)
})

test('single administrator validation keeps the unique result array-shaped under strict mode', () => {
  const source = fs.readFileSync(path.join(root, 'tools', 'social-deploy.ps1'), 'utf8')
  assert.match(source, /@\(\$adminIds \| Select-Object -Unique\)\.Count -ne \$adminIds\.Count/)
})

test('every planned index is verified with a hinted read before function staging', () => {
  const source = fs.readFileSync(path.join(root, 'tools', 'social-deploy.ps1'), 'utf8')
  const smoke = source.indexOf('Invoke-IndexSmokeQuery $index')
  const stage = source.indexOf('$stagedCheck = Deploy-AndWaitFunctionEnvironment', smoke)
  assert(smoke > 0 && stage > smoke)
  assert.match(source, /CommandType = 'QUERY'/)
  assert.match(source, /hint = \$RemoteIndexName/)
})

test('function convergence uses the remote code digest and a staged startup smoke', () => {
  const source = fs.readFileSync(path.join(root, 'tools', 'social-deploy.ps1'), 'utf8')
  assert.match(source, /GetFunctionAddress/)
  assert.match(source, /SOCIAL_DEPLOY_CODE_SHA256/)
  assert.match(source, /ResourceNotFound\\\.Function|ResourceNotFound\\.Function/)
  const digestAttestation = source.indexOf("$stagedEnvironment['SOCIAL_DEPLOY_CODE_SHA256'] = $deployedCodeSha256")
  const smoke = source.indexOf('Invoke-StagedFunctionSmoke $plan.envId', digestAttestation)
  const enable = source.indexOf('$enabledCheck = Deploy-AndWaitFunctionEnvironment', smoke)
  assert(digestAttestation > 0 && smoke > digestAttestation && enable > smoke)
  assert.match(source, /UNAUTHENTICATED/)
  assert.match(source, /\$invokeResult = \$result\.data/)
  assert.match(source, /\[int\]\$invokeResult\.InvokeResult -ne 0/)
  assert.match(source, /\$invokeResult\.RetMsg/)
  assert.match(source, /\$null -ne \$payload\.data/)
  assert.match(source, /Function code or environment changed after staged verification/)
  assert.match(source, /Function code changed while enabling administrators/)
})

function runSmokeFixture(fixture) {
  const encoded = Buffer.from(JSON.stringify(fixture), 'utf8').toString('base64')
  const command = String.raw`
$source = Get-Content -LiteralPath $env:SOCIAL_DEPLOY_SCRIPT -Raw
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors)
$definition = $ast.Find({
  param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Invoke-StagedFunctionSmoke'
}, $true)
if (-not $definition) { throw 'smoke function not found' }
Invoke-Expression $definition.Extent.Text
$fixtureJson = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:SOCIAL_SMOKE_FIXTURE))
$script:SmokeFixture = $fixtureJson | ConvertFrom-Json
function Invoke-TcbJson { return $script:SmokeFixture }
Invoke-StagedFunctionSmoke 'fixture-env'
`
  return spawnSync('powershell.exe', ['-NoProfile', '-Command', command], {
    cwd: root,
    env: Object.assign({}, process.env, {
      SOCIAL_DEPLOY_SCRIPT: path.join(root, 'tools', 'social-deploy.ps1'),
      SOCIAL_SMOKE_FIXTURE: encoded
    }),
    encoding: 'utf8'
  })
}

test('staged smoke parses the real tcb data wrapper and rejects misleading failure logs', () => {
  const success = runSmokeFixture({
    data: {
      InvokeResult: 0,
      RetMsg: JSON.stringify({ code: 'UNAUTHENTICATED', data: null, message: 'identity unavailable' }),
      ErrMsg: '',
      Log: ''
    }
  })
  assert.equal(success.status, 0, success.stderr)

  const platformFailure = runSmokeFixture({
    data: {
      InvokeResult: 1,
      RetMsg: '',
      ErrMsg: 'UNAUTHENTICATED identity unavailable',
      Log: 'UNAUTHENTICATED'
    }
  })
  assert.notEqual(platformFailure.status, 0)

  const wrongPayload = runSmokeFixture({
    data: { InvokeResult: 0, RetMsg: JSON.stringify({ code: 0, data: {} }), ErrMsg: '', Log: '' }
  })
  assert.notEqual(wrongPayload.status, 0)
})

test('emergency disable locks before reading the replace-style environment snapshot', () => {
  const source = fs.readFileSync(path.join(root, 'tools', 'social-deploy.ps1'), 'utf8')
  const disableBranch = source.indexOf('if ($DisableAdminModeration)')
  const lock = source.indexOf('$disableMutex.WaitOne(0)', disableBranch)
  const snapshot = source.indexOf('$emergencyFunction = Get-RemoteFunction', disableBranch)
  assert(disableBranch > 0 && lock > disableBranch && snapshot > lock)
})
