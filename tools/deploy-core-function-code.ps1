[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('poker_data', 'poker_review')]
  [string]$FunctionName,

  [Parameter(Mandatory = $true)]
  [string]$ConfirmEnvironmentId,

  [Parameter(Mandatory = $true)]
  [string]$ExpectedCommit,

  [string]$Root = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$FixedEnvironmentId = 'cloud1-d3ggy9aq3be912e34'
$Markers = @{
  poker_data = 'MANAGED_PRIVATE_FILE_PREFIXES'
  poker_review = 'pseudonymousAgentUserId'
}

function Get-JsonFromOutput {
  param([string]$Raw)
  $start = $Raw.IndexOf('{')
  $end = $Raw.LastIndexOf('}')
  if ($start -lt 0 -or $end -le $start) { throw 'CloudBase CLI did not return JSON' }
  return $Raw.Substring($start, $end - $start + 1) | ConvertFrom-Json
}

function Invoke-TcbJsonRead {
  param([string[]]$Arguments)
  $raw = (& tcb @Arguments 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0) { throw 'CloudBase read failed' }
  return Get-JsonFromOutput $raw
}

function New-SecureTemporaryDirectory {
  $path = Join-Path ([IO.Path]::GetTempPath()) ('poker-core-deploy-' + [Guid]::NewGuid().ToString('N'))
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

function EnvironmentMap {
  param($Detail)
  $map = [ordered]@{}
  foreach ($item in @($Detail.data.Environment.Variables)) {
    $key = [string]$item.Key
    if ($key) { $map[$key] = [string]$item.Value }
  }
  return $map
}

if ([string]::IsNullOrWhiteSpace($Root)) { $Root = Split-Path -Parent $PSScriptRoot }
$Root = [IO.Path]::GetFullPath($Root)
if ($ConfirmEnvironmentId -ne $FixedEnvironmentId) { throw 'ConfirmEnvironmentId does not exactly match the fixed production environment' }
$commit = (& git -C $Root rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $ExpectedCommit -ne $commit) { throw 'ExpectedCommit does not exactly match HEAD' }
if (-not (Test-Path -LiteralPath (Join-Path $Root ('cloudfunctions\' + $FunctionName + '\index.js')))) {
  throw 'Function source directory is missing'
}

$before = Invoke-TcbJsonRead @('fn', 'detail', $FunctionName, '-e', $FixedEnvironmentId, '--json')
if ($before.data.FunctionName -ne $FunctionName -or $before.data.Status -ne 'Active' -or $before.data.AvailableStatus -ne 'Available') {
  throw 'Remote function is not active and available'
}
$expectedEnvironment = EnvironmentMap $before
$expectedEnvironment[($FunctionName.ToUpperInvariant() + '_DEPLOY_COMMIT')] = $commit

$temporaryDirectory = New-SecureTemporaryDirectory
$temporaryConfig = Join-Path $temporaryDirectory 'cloudbaserc.json'
try {
  $config = [pscustomobject][ordered]@{
    envId = $FixedEnvironmentId
    functionRoot = 'cloudfunctions'
    functions = @([pscustomobject][ordered]@{
      name = $FunctionName
      type = [string]$before.data.Type
      handler = [string]$before.data.Handler
      timeout = [int]$before.data.Timeout
      runtime = [string]$before.data.Runtime
      memorySize = [int]$before.data.MemorySize
      installDependency = ([string]$before.data.InstallDependency -eq 'TRUE')
      envVariables = $expectedEnvironment
    })
  }
  [IO.File]::WriteAllText($temporaryConfig, ($config | ConvertTo-Json -Depth 12), (New-Object Text.UTF8Encoding($false)))
  $null = & tcb --config-file $temporaryConfig --yes fn deploy $FunctionName --force --json 2>&1
  if ($LASTEXITCODE -ne 0) { throw 'CloudBase function deployment failed' }

  $verified = $null
  for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
    Start-Sleep -Seconds 3
    $candidate = Invoke-TcbJsonRead @('fn', 'detail', $FunctionName, '-e', $FixedEnvironmentId, '--json')
    if ($candidate.data.Status -eq 'Active' -and $candidate.data.AvailableStatus -eq 'Available') {
      $verified = $candidate
      break
    }
  }
  if (-not $verified) { throw 'CloudBase function did not become available' }
  $actualEnvironment = EnvironmentMap $verified
  if ($actualEnvironment.Count -ne $expectedEnvironment.Count) { throw 'Function environment variable count changed' }
  foreach ($key in $expectedEnvironment.Keys) {
    if (-not $actualEnvironment.Contains($key) -or $actualEnvironment[$key] -ne $expectedEnvironment[$key]) {
      throw 'Function environment variables changed unexpectedly'
    }
  }
  if ([string]$verified.data.CodeInfo -notmatch [regex]::Escape([string]$Markers[$FunctionName])) {
    throw 'Deployed source marker verification failed'
  }
  Write-Output "$FunctionName code deployed and verified; existing environment variables were preserved."
} finally {
  if (Test-Path -LiteralPath $temporaryDirectory) {
    $resolved = [IO.Path]::GetFullPath($temporaryDirectory)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if (-not $resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or
      [IO.Path]::GetFileName($resolved) -notlike 'poker-core-deploy-*') {
      throw 'Refusing to remove an unexpected temporary path'
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}

