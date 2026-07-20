[CmdletBinding(DefaultParameterSetName = 'Preflight')]
param(
  [Parameter(ParameterSetName = 'Apply', Mandatory = $true)]
  [switch]$Apply,

  [Parameter(ParameterSetName = 'Disable', Mandatory = $true)]
  [switch]$DisableAdminModeration,

  [Parameter(ParameterSetName = 'Apply', Mandatory = $true)]
  [string]$PlanId,

  [Parameter(ParameterSetName = 'Apply', Mandatory = $true)]
  [Parameter(ParameterSetName = 'Disable', Mandatory = $true)]
  [string]$ConfirmEnvironmentId,

  [Parameter(ParameterSetName = 'Apply', Mandatory = $true)]
  [Parameter(ParameterSetName = 'Disable', Mandatory = $true)]
  [string]$ExpectedCommit,

  [string]$Root = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:SensitiveValues = New-Object 'System.Collections.Generic.List[string]'

function Add-SensitiveValue {
  param([string]$Value)
  if (-not [string]::IsNullOrEmpty($Value) -and -not $script:SensitiveValues.Contains($Value)) {
    $script:SensitiveValues.Add($Value)
  }
}

function Get-JsonFromOutput {
  param([string]$Text)
  foreach ($match in [regex]::Matches($Text, '(?m)^[ \t]*([\{\[])')) {
    $opener = [string]$match.Groups[1].Value
    $start = $match.Groups[1].Index
    $end = if ($opener -eq '[') { $Text.LastIndexOf(']') } else { $Text.LastIndexOf('}') }
    if ($end -le $start) { continue }
    try {
      return ($Text.Substring($start, $end - $start + 1) | ConvertFrom-Json)
    } catch {
      # CloudBase emits progress lines such as [poker_social] before its JSON body.
    }
  }
  throw 'CloudBase CLI did not return valid JSON'
}

function ConvertTo-WindowsProcessArgument {
  param([string]$Value)
  if ($null -eq $Value -or $Value.Length -eq 0) { return '""' }
  if ($Value -notmatch '[\s"]') { return $Value }
  $builder = New-Object Text.StringBuilder
  $null = $builder.Append('"')
  $backslashes = 0
  foreach ($character in $Value.ToCharArray()) {
    if ($character -eq '\') {
      $backslashes += 1
      continue
    }
    if ($character -eq '"') {
      $null = $builder.Append(('\' * ($backslashes * 2 + 1)))
      $null = $builder.Append('"')
    } else {
      if ($backslashes -gt 0) { $null = $builder.Append(('\' * $backslashes)) }
      $null = $builder.Append($character)
    }
    $backslashes = 0
  }
  if ($backslashes -gt 0) { $null = $builder.Append(('\' * ($backslashes * 2))) }
  $null = $builder.Append('"')
  return $builder.ToString()
}

function Invoke-TcbProcess {
  param([string[]]$Arguments, [int]$TimeoutMilliseconds = 600000)
  $tcbScript = (Get-Command tcb.ps1 -ErrorAction Stop).Source
  $tcbRoot = Split-Path -Parent $tcbScript
  $entry = Join-Path $tcbRoot 'node_modules/@cloudbase/cli/bin/tcb'
  if (-not (Test-Path -LiteralPath $entry)) { throw 'Unable to locate the CloudBase CLI Node entrypoint' }
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $allArguments = @($entry) + @($Arguments)
  $startInfo = New-Object Diagnostics.ProcessStartInfo
  $startInfo.FileName = $node
  $startInfo.Arguments = (($allArguments | ForEach-Object { ConvertTo-WindowsProcessArgument ([string]$_) }) -join ' ')
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $process = New-Object Diagnostics.Process
  $process.StartInfo = $startInfo
  try {
    if (-not $process.Start()) { throw 'Unable to start CloudBase CLI' }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit($TimeoutMilliseconds)) {
      try { $process.Kill() } catch {}
      throw "CloudBase CLI timed out after $TimeoutMilliseconds milliseconds"
    }
    $stdout = $stdoutTask.GetAwaiter().GetResult()
    $stderr = $stderrTask.GetAwaiter().GetResult()
    return @{ ExitCode = $process.ExitCode; Stdout = $stdout; Stderr = $stderr }
  } finally {
    $process.Dispose()
  }
}

function Invoke-TcbJson {
  param([string[]]$Arguments)
  $result = Invoke-TcbProcess $Arguments
  if ($result.ExitCode -ne 0) {
    $sanitized = "$($result.Stdout)`n$($result.Stderr)"
    $sensitive = @($env:SOCIAL_INVITE_TOKEN_SECRET, $env:SOCIAL_ADMIN_OPENIDS) + @($script:SensitiveValues)
    foreach ($secret in $sensitive) {
      if (-not [string]::IsNullOrEmpty($secret)) { $sanitized = $sanitized.Replace($secret, '[REDACTED]') }
    }
    $operation = if ($Arguments.Count -ge 3 -and $Arguments[0] -eq 'api') {
      "$($Arguments[1]).$($Arguments[2])"
    } elseif ($Arguments -contains 'fn') {
      $position = [Array]::IndexOf($Arguments, 'fn')
      'fn.' + $(if ($position + 1 -lt $Arguments.Count) { $Arguments[$position + 1] } else { 'unknown' })
    } elseif ($Arguments.Count -ge 2) {
      "$($Arguments[0]).$($Arguments[1])"
    } else {
      [string]$Arguments[0]
    }
    throw "CloudBase CLI operation $operation failed (exit $($result.ExitCode)): $sanitized"
  }
  return Get-JsonFromOutput $result.Stdout
}

function Invoke-TcbWrite {
  param([string[]]$Arguments)
  $result = Invoke-TcbProcess $Arguments
  if ($result.ExitCode -eq 0) { return }
  $sanitized = "$($result.Stdout)`n$($result.Stderr)"
  $sensitive = @($env:SOCIAL_INVITE_TOKEN_SECRET, $env:SOCIAL_ADMIN_OPENIDS) + @($script:SensitiveValues)
  foreach ($secret in $sensitive) {
    if (-not [string]::IsNullOrEmpty($secret)) { $sanitized = $sanitized.Replace($secret, '[REDACTED]') }
  }
  $operation = if ($Arguments -contains 'fn') {
    $position = [Array]::IndexOf($Arguments, 'fn')
    'fn.' + $(if ($position + 1 -lt $Arguments.Count) { $Arguments[$position + 1] } else { 'unknown' })
  } elseif ($Arguments.Count -ge 2) {
    "$($Arguments[0]).$($Arguments[1])"
  } else {
    [string]$Arguments[0]
  }
  throw "CloudBase CLI write operation $operation failed (exit $($result.ExitCode)): $sanitized"
}

function Invoke-TcbJsonReadWithRetry {
  param([string[]]$Arguments)
  for ($attempt = 1; $attempt -le 5; $attempt += 1) {
    try {
      return Invoke-TcbJson $Arguments
    } catch {
      if ($attempt -ge 5 -or -not (Test-TransientCloudReadFailure ([string]$_.Exception.Message))) { throw }
      Start-Sleep -Seconds 2
    }
  }
}

function ConvertTo-TcbBodyArgument {
  param([object]$Body)
  return ($Body | ConvertTo-Json -Depth 20 -Compress)
}

function Invoke-CloudApi {
  param(
    [string]$Service,
    [string]$Action,
    [string]$ApiVersion,
    [object]$Body,
    [string]$EnvId,
    [string]$Region
  )
  $bodyArg = ConvertTo-TcbBodyArgument $Body
  $arguments = @('api', $Service, $Action, '--api-version', $ApiVersion, '--body', $bodyArg,
    '--json', '-e', $EnvId, '-r', $Region)
  if ($Action -match '^(Describe|Get|RunCommands)') {
    return Invoke-TcbJsonReadWithRetry $arguments
  }
  return Invoke-TcbJson $arguments
}

function Invoke-TcbApi {
  param([string]$Action, [object]$Body, [string]$EnvId, [string]$Region)
  return Invoke-CloudApi 'tcb' $Action '2018-06-08' $Body $EnvId $Region
}

function Invoke-ScfApi {
  param([string]$Action, [object]$Body, [string]$EnvId, [string]$Region)
  return Invoke-CloudApi 'scf' $Action '2018-04-16' $Body $EnvId $Region
}

function Test-TransientCloudReadFailure {
  param([string]$Message)
  return $Message -match 'ETIMEDOUT|connect ETIMEDOUT|请求超时|temporarily unavailable'
}

function Get-Sha256Text {
  param([string]$Text)
  $bytes = [Text.Encoding]::UTF8.GetBytes($Text)
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $hash = $sha.ComputeHash($bytes)
    return ([BitConverter]::ToString($hash)).Replace('-', '').ToLowerInvariant()
  } finally {
    $sha.Dispose()
  }
}

function New-RandomInviteSecret {
  $bytes = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
    return ([Convert]::ToBase64String($bytes)).TrimEnd('=').Replace('+', '-').Replace('/', '_')
  } finally {
    $rng.Dispose()
    [Array]::Clear($bytes, 0, $bytes.Length)
  }
}

function Get-IndexSignatureFromRemote {
  param([object]$RemoteIndex)
  $keys = if ($RemoteIndex.Keys) { $RemoteIndex.Keys } elseif ($RemoteIndex.MgoKeySchema.MgoIndexKeys) {
    $RemoteIndex.MgoKeySchema.MgoIndexKeys
  } else { @() }
  return (($keys | ForEach-Object { "$($_.Name):$($_.Direction)" }) -join '|')
}

function Get-IndexSignatureFromPlan {
  param([object]$Index)
  return (($Index.fields | ForEach-Object { "$($_.name):$($_.direction)" }) -join '|')
}

function Test-RemoteIndexCompatible {
  param([object]$RemoteIndex, [object]$PlannedIndex)
  if ((Get-IndexSignatureFromRemote $RemoteIndex) -ne (Get-IndexSignatureFromPlan $PlannedIndex)) {
    return $false
  }
  $uniqueProperty = $RemoteIndex.PSObject.Properties['Unique']
  if ($uniqueProperty -and [bool]$uniqueProperty.Value) { return $false }
  $sparseProperty = $RemoteIndex.PSObject.Properties['Sparse']
  if ($sparseProperty -and [bool]$sparseProperty.Value) { return $false }
  return $true
}

function New-IndexSmokeCommand {
  param([object]$PlannedIndex, [object]$RemoteIndexHint)
  $hint = $RemoteIndexHint
  if ($null -eq $hint -or ([string]$hint).Length -eq 0) {
    $hint = [ordered]@{}
    foreach ($field in @($PlannedIndex.fields)) { $hint[[string]$field.name] = [int]$field.direction }
  }
  $command = [ordered]@{
    find = $PlannedIndex.collection
    filter = @{}
    projection = @{ _id = 1 }
    hint = $hint
    limit = 1
  } | ConvertTo-Json -Depth 10 -Compress
  return @{
    TableName = $PlannedIndex.collection
    CommandType = 'QUERY'
    Command = $command
  }
}

function Invoke-IndexSmokeBatches {
  param([object[]]$Commands, [string]$Tag, [string]$EnvId, [string]$Region)
  $batchSize = 10
  for ($offset = 0; $offset -lt $Commands.Count; $offset += $batchSize) {
    $last = [Math]::Min($offset + $batchSize - 1, $Commands.Count - 1)
    $batch = @($Commands[$offset..$last])
    $null = Invoke-TcbApi 'RunCommands' @{
      Tag = $Tag
      EnvId = $EnvId
      MgoCommands = $batch
    } $EnvId $Region
  }
}

function Get-RemoteFunction {
  param([string]$EnvId, [string]$Region)
  return (Invoke-ScfApi 'GetFunction' @{ FunctionName = 'poker_social'; Namespace = $EnvId } $EnvId $Region).data
}

function Try-GetRemoteFunction {
  param([string]$EnvId, [string]$Region)
  try {
    return Get-RemoteFunction $EnvId $Region
  } catch {
    if ($_.Exception.Message -match 'ResourceNotFound\.Function') { return $null }
    throw
  }
}

function Get-RemoteFunctionCodeSha256 {
  param([string]$EnvId, [string]$Region)
  $result = Invoke-ScfApi 'GetFunctionAddress' @{
    FunctionName = 'poker_social'
    Namespace = $EnvId
    Qualifier = '$LATEST'
  } $EnvId $Region
  $sha = [string]$result.data.CodeSha256
  if ([string]::IsNullOrWhiteSpace($sha)) { throw 'CloudBase did not return poker_social CodeSha256' }
  return $sha
}

function Invoke-StagedFunctionSmoke {
  param([string]$EnvId)
  $result = Invoke-TcbJsonReadWithRetry @('fn', 'invoke', 'poker_social', '-d', '{"action":"get_my_social_profile"}', '--json', '-e', $EnvId)
  $invokeResult = $result.data
  if (-not $invokeResult -or $null -eq $invokeResult.PSObject.Properties['InvokeResult'] -or
      [int]$invokeResult.InvokeResult -ne 0) {
    throw 'Staged poker_social invocation failed at the platform level'
  }
  $payload = if ($invokeResult.RetMsg -is [string]) {
    try { [string]$invokeResult.RetMsg | ConvertFrom-Json } catch { throw 'Staged poker_social returned malformed JSON' }
  } else {
    $invokeResult.RetMsg
  }
  if (-not $payload -or [string]$payload.code -ne 'UNAUTHENTICATED' -or $null -ne $payload.data) {
    throw 'Staged poker_social did not return the expected unauthenticated response'
  }
}

function Get-FunctionEnvironmentMap {
  param([object]$FunctionData)
  $map = [ordered]@{}
  if ($FunctionData -and $FunctionData.Environment -and $FunctionData.Environment.Variables) {
    foreach ($item in @($FunctionData.Environment.Variables)) {
      if (-not [string]::IsNullOrWhiteSpace([string]$item.Key)) { $map[[string]$item.Key] = [string]$item.Value }
    }
  }
  return $map
}

function Test-EnvironmentMapEqual {
  param([System.Collections.IDictionary]$Actual, [System.Collections.IDictionary]$Expected)
  if ($Actual.Count -ne $Expected.Count) { return $false }
  foreach ($key in $Expected.Keys) {
    if (-not $Actual.Contains($key) -or [string]$Actual[$key] -cne [string]$Expected[$key]) { return $false }
  }
  return $true
}

function Get-StableCollectionPermissionMap {
  param([string]$EnvId, [string[]]$Collections)
  $previousSignature = $null
  for ($attempt = 1; $attempt -le 5; $attempt += 1) {
    try {
      $result = Invoke-TcbJsonReadWithRetry @('permission', 'get', 'collection', '-e', $EnvId, '--json')
    } catch {
      if ($attempt -ge 5 -or -not (Test-TransientCloudReadFailure ([string]$_.Exception.Message))) { throw }
      Start-Sleep -Seconds 2
      continue
    }
    $map = @{}
    foreach ($item in @($result.data.PermissionList)) { $map[[string]$item.Resource] = [string]$item.Permission }
    $signature = (@($Collections | Sort-Object | ForEach-Object {
      $value = if ($map.ContainsKey($_)) { $map[$_] } else { '<missing>' }
      "$_=$value"
    }) -join '|')
    if ($null -ne $previousSignature -and $signature -ceq $previousSignature) { return $map }
    $previousSignature = $signature
    if ($attempt -lt 5) { Start-Sleep -Seconds 2 }
  }
  throw 'CloudBase collection permissions did not return two consecutive identical snapshots'
}

function Wait-FunctionActive {
  param([string]$EnvId, [string]$Region, [int]$TimeoutSeconds = 120)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    $function = Get-RemoteFunction $EnvId $Region
    if ([string]$function.Status -eq 'Active') { return $function }
    Start-Sleep -Seconds 3
  } while ([DateTime]::UtcNow -lt $deadline)
  throw 'Timed out waiting for poker_social to become Active'
}

function Wait-FunctionEnvironment {
  param(
    [System.Collections.IDictionary]$Expected,
    [string]$EnvId,
    [string]$Region,
    [int]$TimeoutSeconds = 120
  )
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    $function = Get-RemoteFunction $EnvId $Region
    $actual = Get-FunctionEnvironmentMap $function
    if ([string]$function.Status -eq 'Active' -and (Test-EnvironmentMapEqual $actual $Expected)) {
      return $function
    }
    Start-Sleep -Seconds 3
  } while ([DateTime]::UtcNow -lt $deadline)
  throw 'Timed out waiting for the exact poker_social environment configuration'
}

function New-SecureTemporaryDirectory {
  $path = Join-Path ([IO.Path]::GetTempPath()) ('poker-social-deploy-' + [Guid]::NewGuid().ToString('N'))
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $security = New-Object Security.AccessControl.DirectorySecurity
  $security.SetOwner($identity.User)
  $security.SetAccessRuleProtection($true, $false)
  $inheritance = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor `
    [Security.AccessControl.InheritanceFlags]::ObjectInherit
  $rule = New-Object -TypeName Security.AccessControl.FileSystemAccessRule -ArgumentList @(
    $identity.User,
    [Security.AccessControl.FileSystemRights]::FullControl,
    $inheritance,
    [Security.AccessControl.PropagationFlags]::None,
    [Security.AccessControl.AccessControlType]::Allow
  )
  $security.AddAccessRule($rule)
  $null = [IO.Directory]::CreateDirectory($path, $security)
  return $path
}

function Remove-StaleSocialDeploymentDirectories {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $cutoff = [DateTime]::UtcNow.AddHours(-1)
  foreach ($directory in @(Get-ChildItem -LiteralPath ([IO.Path]::GetTempPath()) -Directory -Filter 'poker-social-deploy-*' -ErrorAction SilentlyContinue)) {
    if ($directory.LastWriteTimeUtc -ge $cutoff) { continue }
    try {
      $acl = Get-Acl -LiteralPath $directory.FullName
      if ($acl.AreAccessRulesProtected -and $acl.Owner -eq $identity.Name) {
        Remove-Item -LiteralPath $directory.FullName -Recurse -Force
      }
    } catch {
      # Cleanup is best-effort and never broadens ACLs or blocks the deployment preflight.
    }
  }
}

function Deploy-AndWaitFunctionEnvironment {
  param(
    [System.Collections.IDictionary]$Map,
    [string]$BaseConfigPath,
    [string]$RepoRoot,
    [string]$EnvId,
    [string]$Region,
    [switch]$DeployCode
  )
  $temporaryDirectory = New-SecureTemporaryDirectory
  $temporaryConfig = Join-Path $temporaryDirectory 'cloudbaserc.json'
  try {
    if ($DeployCode) {
      $config = Get-Content -LiteralPath $BaseConfigPath -Raw | ConvertFrom-Json
      # CloudBase CLI resolves functionRoot from the current working directory even when
      # --config-file points at a temporary file. An absolute value is incorrectly joined
      # to the repository path by CLI 3.5.x, producing a duplicated Windows path.
      $config.functionRoot = 'cloudfunctions'
    } else {
      $config = [pscustomobject][ordered]@{
        envId = $EnvId
        functionRoot = 'cloudfunctions'
        functions = @([pscustomobject][ordered]@{ name = 'poker_social' })
      }
    }
    $environmentVariables = [ordered]@{}
    foreach ($key in $Map.Keys) {
      $value = [string]$Map[$key]
      if ([string]::IsNullOrEmpty($value)) { throw "Function environment value must not be empty: $key" }
      Add-SensitiveValue $value
      $environmentVariables[[string]$key] = $value
    }
    $config.functions[0] | Add-Member -Force -NotePropertyName envVariables -NotePropertyValue $environmentVariables
    [IO.File]::WriteAllText(
      $temporaryConfig,
      ($config | ConvertTo-Json -Depth 20),
      (New-Object Text.UTF8Encoding($false))
    )
    # Secrets are read from the ACL-restricted config file and never appear in child-process argv.
    if ($DeployCode) {
      Invoke-TcbWrite @('--config-file', $temporaryConfig, '--yes', 'fn', 'deploy', 'poker_social', '--force', '--json')
    } else {
      Invoke-TcbWrite @('--config-file', $temporaryConfig, '--yes', 'config', 'update', 'fn', 'poker_social', '--json')
    }
    return Wait-FunctionEnvironment $Map $EnvId $Region
  } finally {
    if (Test-Path -LiteralPath $temporaryDirectory) {
      Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force
    }
  }
}

if ([string]::IsNullOrWhiteSpace($Root)) { $Root = Split-Path -Parent $PSScriptRoot }
$Root = [IO.Path]::GetFullPath($Root)
Remove-StaleSocialDeploymentDirectories
$configPath = Join-Path $Root 'cloudbaserc.social.json'
$commit = (& git -C $Root rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Unable to resolve the current Git commit' }

if ($DisableAdminModeration) {
  $emergencyConfig = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
  $emergencyEnvId = [string]$emergencyConfig.envId
  if ($emergencyEnvId -ne 'cloud1-d3ggy9aq3be912e34' -or $ConfirmEnvironmentId -ne $emergencyEnvId) {
    throw 'ConfirmEnvironmentId does not exactly match the fixed social environment'
  }
  if ($ExpectedCommit -ne $commit) { throw 'ExpectedCommit does not exactly match HEAD' }
  $emergencyEnvironment = Invoke-TcbJsonReadWithRetry @('env', 'detail', '-e', $emergencyEnvId, '--json')
  if ($emergencyEnvironment.data.envId -ne $emergencyEnvId -or $emergencyEnvironment.data.status -ne 'NORMAL') {
    throw 'The fixed CloudBase environment is missing or not NORMAL'
  }
  $emergencyRegion = [string]$emergencyEnvironment.data.region
  $disableMutexName = 'Global\PokerLiveSocialDeploy_' + (Get-Sha256Text $emergencyEnvId).Substring(0, 20)
  $disableMutex = New-Object Threading.Mutex($false, $disableMutexName)
  if (-not $disableMutex.WaitOne(0)) { throw 'Another social deployment is already running for this environment' }
  try {
    $emergencyFunction = Get-RemoteFunction $emergencyEnvId $emergencyRegion
    if (-not $emergencyFunction -or $emergencyFunction.FunctionName -ne 'poker_social') {
      throw 'poker_social does not exist; there is no administrator capability to disable'
    }
    $disabledMap = Get-FunctionEnvironmentMap $emergencyFunction
    if ($disabledMap.Contains('SOCIAL_ADMIN_OPENIDS')) {
      $disabledMap.Remove('SOCIAL_ADMIN_OPENIDS')
      try {
        $null = Deploy-AndWaitFunctionEnvironment $disabledMap $configPath $Root $emergencyEnvId $emergencyRegion
      } catch {
        $null = Wait-FunctionEnvironment $disabledMap $emergencyEnvId $emergencyRegion 120
      }
    }
    $verifiedDisabledMap = Get-FunctionEnvironmentMap (Get-RemoteFunction $emergencyEnvId $emergencyRegion)
    if ($verifiedDisabledMap.Contains('SOCIAL_ADMIN_OPENIDS')) { throw 'Administrator fail-close verification failed' }
    Write-Output 'Administrator moderation was fail-closed. Database resources and function code were not changed.'
    return
  } finally {
    $disableMutex.ReleaseMutex()
    $disableMutex.Dispose()
  }
}

$planner = Join-Path $Root 'tools/lib/social-deployment-plan.js'
$planText = (& node $planner --root $Root | Out-String)
if ($LASTEXITCODE -ne 0) { throw 'Unable to build the local social deployment plan' }
$plan = $planText | ConvertFrom-Json
$deploymentInputs = @(
  'cloudbaserc.social.json',
  'cloudfunctions/poker_social/database-security-rules.json',
  'cloudfunctions/poker_social/database-indexes.json',
  'cloudfunctions/poker_social',
  'tools/lib/social-deployment-plan.js',
  'tools/social-deploy.ps1'
)
$inputStatus = (& git -C $Root status --porcelain=v1 -- @deploymentInputs | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect deployment input status' }
if ($inputStatus) { throw 'Deployment inputs differ from HEAD or are untracked; commit and review them before applying' }

$environment = Invoke-TcbJsonReadWithRetry @('env', 'detail', '-e', $plan.envId, '--json')
if ($environment.data.envId -ne $plan.envId -or $environment.data.status -ne 'NORMAL') {
  throw 'The configured CloudBase environment is missing or not NORMAL'
}
$database = @($environment.data.resources.databases)[0]
if (-not $database -or $database.Status -ne 'RUNNING') { throw 'The CloudBase database is not RUNNING' }
$tag = $database.InstanceId
$region = $environment.data.region

$remoteFunction = Try-GetRemoteFunction $plan.envId $region
$functionExists = $null -ne $remoteFunction

$tablesResult = Invoke-TcbApi 'DescribeTables' @{
  EnvId = $plan.envId; Tag = $tag; MgoLimit = 300; MgoOffset = 0
} $plan.envId $region
$existingTables = @($tablesResult.data.Tables | ForEach-Object { $_.TableName })
foreach ($external in $plan.externalCollections) {
  if ($existingTables -notcontains $external) {
    throw "External dependency $external is missing; this tool will not create it or change its ACL"
  }
}

$trackedPermissionCollections = @($plan.managedCollections) + @($plan.externalCollections)
$permissionByCollection = Get-StableCollectionPermissionMap $plan.envId $trackedPermissionCollections

$missingCollections = @($plan.managedCollections | Where-Object { $existingTables -notcontains $_ })
$permissionDrift = @($plan.managedCollections | Where-Object {
  ($existingTables -contains $_) -and $permissionByCollection[$_] -ne 'ADMINONLY'
})
$missingIndexes = @()
$indexesByCollection = $plan.indexes | Group-Object collection
$resolvedIndexNameByCanonical = @{}
$plannedIndexSmokeCommands = @($plan.indexes | ForEach-Object { New-IndexSmokeCommand $_ $null })
$plannedIndexNamesVerified = $false
if ($missingCollections.Count -eq 0) {
  try {
    Invoke-IndexSmokeBatches $plannedIndexSmokeCommands $tag $plan.envId $region
    $plannedIndexNamesVerified = $true
  } catch {
    if (Test-TransientCloudReadFailure ([string]$_.Exception.Message)) { throw }
  }
}
if (-not $plannedIndexNamesVerified) {
  foreach ($group in $indexesByCollection) {
    if ($existingTables -notcontains $group.Name) {
      foreach ($index in $group.Group) { $missingIndexes += $index }
      continue
    }
    $description = Invoke-TcbApi 'DescribeTable' @{
      EnvId = $plan.envId; Tag = $tag; TableName = $group.Name
    } $plan.envId $region
    $remoteIndexes = @($description.data.Indexes)
    foreach ($index in $group.Group) {
      $compatible = @($remoteIndexes | Where-Object { Test-RemoteIndexCompatible $_ $index })
      if ($compatible.Count -eq 0) {
        $sameName = @($remoteIndexes | Where-Object { $_.Name -eq $index.name })
        if ($sameName.Count -gt 0) { throw "Index name collision with a different shape: $($index.name)" }
        $missingIndexes += $index
      } else {
        $resolvedIndexNameByCanonical[[string]$index.canonical] = [string]$compatible[0].Name
      }
    }
  }
}

$remoteEnvironment = Get-FunctionEnvironmentMap $remoteFunction
$remoteCodeSha256 = if ($functionExists) { Get-RemoteFunctionCodeSha256 $plan.envId $region } else { $null }
$sourceTree = (& git -C $Root rev-parse 'HEAD:cloudfunctions/poker_social').Trim()
if ($LASTEXITCODE -ne 0) { throw 'Unable to resolve the deployed function source tree' }
$managedPermissionState = [ordered]@{}
foreach ($collection in $plan.managedCollections) { $managedPermissionState[$collection] = $permissionByCollection[$collection] }
$stateSummary = [ordered]@{
  envId = $plan.envId
  commit = $commit
  manifestHash = Get-Sha256Text $planText
  existingManagedCollections = @($plan.managedCollections | Where-Object { $existingTables -contains $_ })
  missingCollections = $missingCollections
  permissionDrift = $permissionDrift
  missingIndexes = @($missingIndexes | ForEach-Object { $_.canonical })
  functionExists = $functionExists
  functionRuntime = if ($remoteFunction) { $remoteFunction.Runtime } else { $null }
  functionHandler = if ($remoteFunction) { $remoteFunction.Handler } else { $null }
  functionModifyTime = if ($remoteFunction) { $remoteFunction.ModTime } else { $null }
  functionCodeSha256 = $remoteCodeSha256
  functionEnvKeys = @($remoteEnvironment.Keys | Sort-Object)
  sourceTree = $sourceTree
  managedPermissions = $managedPermissionState
  externalPermissions = @($plan.externalCollections | ForEach-Object { "$_=$($permissionByCollection[$_])" })
}
$currentPlanId = Get-Sha256Text ($stateSummary | ConvertTo-Json -Depth 20 -Compress)

Write-Output "Social deployment preflight"
Write-Output "  Environment: $($plan.envId) ($region)"
Write-Output "  Commit: $commit"
Write-Output "  Managed collections missing: $($missingCollections.Count)"
Write-Output "  Managed ACL drift: $($permissionDrift.Count)"
Write-Output "  Indexes missing: $($missingIndexes.Count)"
Write-Output "  External collections (ACL untouched): $($plan.externalCollections -join ', ')"
Write-Output "  Function exists: $functionExists"
Write-Output "  PlanId: $currentPlanId"

if (-not $Apply -and -not $DisableAdminModeration) {
  Write-Output 'Read-only preflight complete. No cloud resources were changed.'
  exit 0
}

if ($ConfirmEnvironmentId -ne $plan.envId) { throw 'ConfirmEnvironmentId does not exactly match the configured environment' }
if ($ExpectedCommit -ne $commit) { throw 'ExpectedCommit does not exactly match HEAD' }
if ($PlanId -ne $currentPlanId) { throw 'PlanId is stale or does not match this environment state' }

$adminOpenIds = [string]$env:SOCIAL_ADMIN_OPENIDS
if ([string]::IsNullOrWhiteSpace($adminOpenIds)) {
  throw 'SOCIAL_ADMIN_OPENIDS must be supplied through the process environment for Apply'
}
$adminIds = @($adminOpenIds.Split(','))
if ($adminIds.Count -eq 0 -or @($adminIds | Select-Object -Unique).Count -ne $adminIds.Count -or
    @($adminIds | Where-Object { $_ -notmatch '^[A-Za-z0-9_-]{16,128}$' }).Count -gt 0) {
  throw 'SOCIAL_ADMIN_OPENIDS must be a unique comma-separated list of validated OpenID tokens without whitespace'
}
$adminOpenIds = $adminIds -join ','
$providedInviteSecret = [string]$env:SOCIAL_INVITE_TOKEN_SECRET
if ($remoteEnvironment.Contains('SOCIAL_INVITE_TOKEN_SECRET')) {
  $inviteSecret = [string]$remoteEnvironment['SOCIAL_INVITE_TOKEN_SECRET']
  if ($inviteSecret -notmatch '^[A-Za-z0-9_-]{43,128}$') {
    throw 'The deployed invite secret is not a valid 32-byte-or-stronger base64url token; operator remediation is required'
  }
  if (-not [string]::IsNullOrEmpty($providedInviteSecret) -and $providedInviteSecret -ne $inviteSecret) {
    throw 'The supplied invite secret differs from the deployed value; implicit rotation is forbidden'
  }
} else {
  if ([string]::IsNullOrEmpty($providedInviteSecret)) { $providedInviteSecret = New-RandomInviteSecret }
  if ($providedInviteSecret -notmatch '^[A-Za-z0-9_-]{43,128}$') {
    throw 'SOCIAL_INVITE_TOKEN_SECRET must be a 32-byte-or-stronger base64url token when supplied'
  }
  $inviteSecret = $providedInviteSecret
}

$runtimeConverged = $functionExists -and $remoteFunction.Runtime -eq 'Nodejs20.19' -and
  $remoteFunction.Handler -eq 'index.main' -and [int]$remoteFunction.Timeout -eq 60 -and
  [int]$remoteFunction.MemorySize -eq 256 -and [string]$remoteFunction.Status -eq 'Active'
$codeConverged = $functionExists -and $remoteEnvironment.Contains('SOCIAL_DEPLOY_COMMIT') -and
  $remoteEnvironment.Contains('SOCIAL_DEPLOY_CODE_SHA256') -and
  [string]$remoteEnvironment['SOCIAL_DEPLOY_COMMIT'] -eq $commit -and
  [string]$remoteEnvironment['SOCIAL_DEPLOY_CODE_SHA256'] -eq [string]$remoteCodeSha256 -and $runtimeConverged
$stagedEnvironment = [ordered]@{}
foreach ($key in $remoteEnvironment.Keys) { $stagedEnvironment[$key] = $remoteEnvironment[$key] }
$stagedEnvironment['SOCIAL_INVITE_TOKEN_SECRET'] = $inviteSecret
$stagedEnvironment['SOCIAL_DEPLOY_COMMIT'] = $commit
if ($codeConverged) {
  $stagedEnvironment['SOCIAL_DEPLOY_CODE_SHA256'] = $remoteCodeSha256
} else {
  $stagedEnvironment.Remove('SOCIAL_DEPLOY_CODE_SHA256')
}
$stagedEnvironment.Remove('SOCIAL_ADMIN_OPENIDS')
$enabledEnvironment = [ordered]@{}
foreach ($key in $stagedEnvironment.Keys) { $enabledEnvironment[$key] = $stagedEnvironment[$key] }
$enabledEnvironment['SOCIAL_ADMIN_OPENIDS'] = $adminOpenIds
$databaseConverged = $missingCollections.Count -eq 0 -and $permissionDrift.Count -eq 0 -and $missingIndexes.Count -eq 0
if ($databaseConverged -and $codeConverged -and (Test-EnvironmentMapEqual $remoteEnvironment $enabledEnvironment)) {
  Invoke-StagedFunctionSmoke $plan.envId
  Write-Output 'Apply is already fully converged. No cloud resources were changed.'
  return
}

$mutexName = 'Global\PokerLiveSocialDeploy_' + (Get-Sha256Text $plan.envId).Substring(0, 20)
$mutex = New-Object Threading.Mutex($false, $mutexName)
if (-not $mutex.WaitOne(0)) { throw 'Another social deployment is already running for this environment' }
$functionMayExist = $functionExists
$mutationStarted = $false
try {
  if ($functionExists) {
    $lockedFunction = Get-RemoteFunction $plan.envId $region
    $lockedEnvironment = Get-FunctionEnvironmentMap $lockedFunction
    $lockedCodeSha256 = Get-RemoteFunctionCodeSha256 $plan.envId $region
    if (-not (Test-EnvironmentMapEqual $lockedEnvironment $remoteEnvironment) -or
        [string]$lockedCodeSha256 -ne [string]$remoteCodeSha256) {
      throw 'The remote function environment changed after preflight; run preflight again'
    }
  }

  $mutationStarted = $true
  foreach ($collection in $missingCollections) {
    $null = Invoke-TcbApi 'CreateTable' @{
      TableName = $collection
      Tag = $tag
      EnvId = $plan.envId
      PermissionInfo = @{ AclTag = 'ADMINONLY'; EnvId = $plan.envId }
    } $plan.envId $region
  }
  foreach ($collection in $permissionDrift) {
    $null = Invoke-TcbJson @('permission', 'set', "collection:$collection", '--level', 'adminonly',
      '--env-id', $plan.envId, '--json')
  }
  foreach ($group in ($missingIndexes | Group-Object collection)) {
    $body = @{
      TableName = $group.Name
      Tag = $tag
      EnvId = $plan.envId
      CreateIndexes = @($group.Group | ForEach-Object {
        @{
          IndexName = $_.name
          MgoKeySchema = @{
            MgoIndexKeys = @($_.fields | ForEach-Object { @{ Name = $_.name; Direction = $_.direction } })
            MgoIsUnique = $false
            MgoIsSparse = $false
          }
        }
      })
    }
    $null = Invoke-TcbApi 'UpdateTable' $body $plan.envId $region
  }

  $databasePermissionsMutated = $missingCollections.Count -gt 0 -or $permissionDrift.Count -gt 0
  $postPermissionMap = if ($databasePermissionsMutated) {
    Get-StableCollectionPermissionMap $plan.envId $trackedPermissionCollections
  } else {
    $permissionByCollection
  }
  foreach ($collection in $plan.managedCollections) {
    if ($postPermissionMap[$collection] -ne 'ADMINONLY') { throw "Post-deploy ACL verification failed for $collection" }
  }
  $unverifiedIndexes = @($plan.indexes)
  $indexDeadline = [DateTime]::UtcNow.AddSeconds(120)
  while ($unverifiedIndexes.Count -gt 0 -and [DateTime]::UtcNow -lt $indexDeadline) {
    $nextUnverified = @()
    foreach ($group in ($unverifiedIndexes | Group-Object collection)) {
      $description = Invoke-TcbApi 'DescribeTable' @{
        EnvId = $plan.envId; Tag = $tag; TableName = $group.Name
      } $plan.envId $region
      $remoteIndexes = @($description.data.Indexes)
      foreach ($index in $group.Group) {
        $compatible = @($remoteIndexes | Where-Object { Test-RemoteIndexCompatible $_ $index })
        if ($compatible.Count -eq 0) { $nextUnverified += $index }
      }
    }
    $unverifiedIndexes = $nextUnverified
    if ($unverifiedIndexes.Count -gt 0) { Start-Sleep -Seconds 5 }
  }
  if ($unverifiedIndexes.Count -gt 0) {
    throw "Post-deploy index verification failed for $($unverifiedIndexes[0].canonical)"
  }

  # DescribeTable has no ready flag. A hinted read proves that each exact index can be selected by the database.
  if ($plannedIndexNamesVerified -and $missingIndexes.Count -eq 0) {
    $indexSmokeCommands = $plannedIndexSmokeCommands
  } elseif ($missingIndexes.Count -eq 0) {
    $indexSmokeCommands = @($plan.indexes | ForEach-Object {
      $resolvedName = if ($resolvedIndexNameByCanonical.ContainsKey([string]$_.canonical)) {
        [string]$resolvedIndexNameByCanonical[[string]$_.canonical]
      } else {
        $null
      }
      New-IndexSmokeCommand $_ $resolvedName
    })
  } else {
    $indexSmokeCommands = @()
    foreach ($group in $indexesByCollection) {
      $description = Invoke-TcbApi 'DescribeTable' @{
        EnvId = $plan.envId; Tag = $tag; TableName = $group.Name
      } $plan.envId $region
      $remoteIndexes = @($description.data.Indexes)
      foreach ($index in $group.Group) {
        $compatible = @($remoteIndexes | Where-Object { Test-RemoteIndexCompatible $_ $index })
        if ($compatible.Count -eq 0) { throw "Index disappeared before smoke query: $($index.canonical)" }
        $indexSmokeCommands += New-IndexSmokeCommand $index ([string]$compatible[0].Name)
      }
    }
  }
  Invoke-IndexSmokeBatches $indexSmokeCommands $tag $plan.envId $region

  # Only after database postconditions pass, deploy code and stage it without the admin key.
  if ($codeConverged) {
    $stagedCheck = Deploy-AndWaitFunctionEnvironment $stagedEnvironment $configPath $Root $plan.envId $region
    $attestedCodeSha256 = $remoteCodeSha256
  } else {
    $stagedCheck = Deploy-AndWaitFunctionEnvironment $stagedEnvironment $configPath $Root $plan.envId $region -DeployCode
    $functionMayExist = $true
    $deployedCodeSha256 = Get-RemoteFunctionCodeSha256 $plan.envId $region
    $stagedEnvironment['SOCIAL_DEPLOY_CODE_SHA256'] = $deployedCodeSha256
    $stagedCheck = Deploy-AndWaitFunctionEnvironment $stagedEnvironment $configPath $Root $plan.envId $region
    $attestedCodeSha256 = $deployedCodeSha256
  }
  $functionMayExist = $true
  $stagedMap = Get-FunctionEnvironmentMap $stagedCheck
  $stagedKeys = @($stagedMap.Keys)
  if ($stagedKeys -notcontains 'SOCIAL_INVITE_TOKEN_SECRET' -or $stagedKeys -contains 'SOCIAL_ADMIN_OPENIDS') {
    throw 'Staged function environment verification failed'
  }
  if ($stagedCheck.Runtime -ne 'Nodejs20.19' -or $stagedCheck.Handler -ne 'index.main' -or
      [int]$stagedCheck.Timeout -ne 60 -or [int]$stagedCheck.MemorySize -ne 256) {
    throw 'Staged function runtime configuration verification failed'
  }
  Invoke-StagedFunctionSmoke $plan.envId

  $preEnableFunction = Get-RemoteFunction $plan.envId $region
  $preEnableMap = Get-FunctionEnvironmentMap $preEnableFunction
  $preEnableCodeSha256 = Get-RemoteFunctionCodeSha256 $plan.envId $region
  if (-not (Test-EnvironmentMapEqual $preEnableMap $stagedEnvironment) -or
      [string]$preEnableCodeSha256 -ne [string]$attestedCodeSha256) {
    throw 'Function code or environment changed after staged verification; refusing to enable administrators'
  }

  $enabledEnvironment = [ordered]@{}
  foreach ($key in $stagedEnvironment.Keys) { $enabledEnvironment[$key] = $stagedEnvironment[$key] }
  $enabledEnvironment['SOCIAL_ADMIN_OPENIDS'] = $adminOpenIds
  $enabledCheck = Deploy-AndWaitFunctionEnvironment $enabledEnvironment $configPath $Root $plan.envId $region
  $enabledMap = Get-FunctionEnvironmentMap $enabledCheck
  $enabledKeys = @($enabledMap.Keys)
  if ($enabledKeys -notcontains 'SOCIAL_INVITE_TOKEN_SECRET' -or $enabledKeys -notcontains 'SOCIAL_ADMIN_OPENIDS') {
    throw 'Final function environment verification failed'
  }
  $enabledCodeSha256 = Get-RemoteFunctionCodeSha256 $plan.envId $region
  if ([string]$enabledCodeSha256 -ne [string]$attestedCodeSha256) {
    throw 'Function code changed while enabling administrators'
  }
  Write-Output 'Social infrastructure and poker_social converged. Admin moderation was enabled as the final step.'
} catch {
  $originalFailure = $_
  $failCloseVerified = $false
  if ($mutationStarted -and $functionMayExist) {
    try {
      # Wait for any in-flight enable/update to finish before submitting the fail-close update.
      Start-Sleep -Seconds 3
      $recoveryFunction = Wait-FunctionActive $plan.envId $region
      $recoveryMap = Get-FunctionEnvironmentMap $recoveryFunction
      if ($recoveryMap.Contains('SOCIAL_ADMIN_OPENIDS')) {
        $recoveryMap.Remove('SOCIAL_ADMIN_OPENIDS')
      }
      $recoveryFunction = Deploy-AndWaitFunctionEnvironment $recoveryMap $configPath $Root $plan.envId $region
      $recoveryMap = Get-FunctionEnvironmentMap $recoveryFunction
      $failCloseVerified = -not $recoveryMap.Contains('SOCIAL_ADMIN_OPENIDS')
    } catch {
      $failCloseVerified = $false
    }
  } else {
    $failCloseVerified = $true
  }
  [Console]::Error.WriteLine("Deployment failed: $($originalFailure.Exception.Message)")
  if ($mutationStarted) {
    [Console]::Error.WriteLine("Administrator fail-close verified: $failCloseVerified")
  } else {
    [Console]::Error.WriteLine('No cloud mutation began; the existing administrator configuration was left unchanged.')
  }
  [Console]::Error.WriteLine('No collection, document, or index was deleted.')
  if (-not $failCloseVerified) {
    throw 'Deployment failed and administrator fail-close could not be verified; immediate operator action is required'
  }
  throw $originalFailure
} finally {
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
