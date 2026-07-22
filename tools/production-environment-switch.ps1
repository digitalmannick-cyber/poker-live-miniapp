[CmdletBinding(DefaultParameterSetName = 'Check')]
param(
  [Parameter(ParameterSetName = 'Apply', Mandatory = $true)]
  [switch]$Apply,

  [Parameter(ParameterSetName = 'Apply', Mandatory = $true)]
  [switch]$ConfirmPublished,

  [Parameter(ParameterSetName = 'Apply', Mandatory = $true)]
  [string]$ConfirmEnvironmentId,

  [Parameter(ParameterSetName = 'Apply', Mandatory = $true)]
  [string]$ExpectedCommit,

  [Parameter(ParameterSetName = 'Apply', Mandatory = $true)]
  [string]$ConfirmVersion,

  [string]$Root = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$FixedEnvironmentId = 'cloud1-d3ggy9aq3be912e34'
$Targets = [ordered]@{
  poker_social = [ordered]@{ SOCIAL_INVITE_QR_ENV_VERSION = 'release' }
  poker_data = [ordered]@{ AI_REMINDER_MINIPROGRAM_STATE = 'formal' }
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
  for ($attempt = 0; $attempt -lt 3; $attempt += 1) {
    $previousPreference = $ErrorActionPreference
    try {
      $ErrorActionPreference = 'Continue'
      $raw = (& tcb @Arguments 2>&1 | Out-String)
      $exitCode = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $previousPreference
    }
    if ($exitCode -eq 0) { return Get-JsonFromOutput $raw }
    if ($attempt -lt 2) { Start-Sleep -Seconds 2 }
  }
  throw 'CloudBase read failed after retries'
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

function New-SecureTemporaryDirectory {
  $path = Join-Path ([IO.Path]::GetTempPath()) ('poker-production-switch-' + [Guid]::NewGuid().ToString('N'))
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

function Update-FunctionEnvironment {
  param([string]$FunctionName, [System.Collections.IDictionary]$Environment)
  $temporaryDirectory = New-SecureTemporaryDirectory
  $temporaryConfig = Join-Path $temporaryDirectory 'cloudbaserc.json'
  try {
    $config = [pscustomobject][ordered]@{
      envId = $FixedEnvironmentId
      functionRoot = 'cloudfunctions'
      functions = @([pscustomobject][ordered]@{ name = $FunctionName; envVariables = $Environment })
    }
    [IO.File]::WriteAllText($temporaryConfig, ($config | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding($false)))
    $previousPreference = $ErrorActionPreference
    try {
      $ErrorActionPreference = 'Continue'
      $null = & tcb --config-file $temporaryConfig --yes config update fn $FunctionName --json 2>&1
      $exitCode = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $previousPreference
    }
    if ($exitCode -ne 0) { throw "CloudBase environment update failed for $FunctionName" }
  } finally {
    if (Test-Path -LiteralPath $temporaryDirectory) {
      $resolved = [IO.Path]::GetFullPath($temporaryDirectory)
      $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
      if (-not $resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($resolved) -notlike 'poker-production-switch-*') {
        throw 'Refusing to remove an unexpected temporary path'
      }
      Remove-Item -LiteralPath $resolved -Recurse -Force
    }
  }
}

function Test-EnvironmentEqual {
  param([System.Collections.IDictionary]$Expected, [System.Collections.IDictionary]$Actual)
  if ($Expected.Count -ne $Actual.Count) { return $false }
  foreach ($key in $Expected.Keys) {
    if (-not $Actual.Contains($key) -or $Expected[$key] -ne $Actual[$key]) { return $false }
  }
  return $true
}

if ([string]::IsNullOrWhiteSpace($Root)) { $Root = Split-Path -Parent $PSScriptRoot }
$Root = [IO.Path]::GetFullPath($Root)
$details = @{}
$original = @{}
foreach ($functionName in $Targets.Keys) {
  $detail = Invoke-TcbJsonRead @('fn', 'detail', $functionName, '-e', $FixedEnvironmentId, '--json')
  if ($detail.data.FunctionName -ne $functionName -or $detail.data.Status -ne 'Active' -or $detail.data.AvailableStatus -ne 'Available') {
    throw "$functionName is not active and available"
  }
  $details[$functionName] = $detail
  $original[$functionName] = EnvironmentMap $detail
}

$socialState = if ($original.poker_social.Contains('SOCIAL_INVITE_QR_ENV_VERSION')) { $original.poker_social['SOCIAL_INVITE_QR_ENV_VERSION'] } else { 'trial(default)' }
$reminderState = if ($original.poker_data.Contains('AI_REMINDER_MINIPROGRAM_STATE')) { $original.poker_data['AI_REMINDER_MINIPROGRAM_STATE'] } else { 'trial(default)' }
if (-not $Apply) {
  Write-Output "Production environment preflight: invite=$socialState; reminder=$reminderState; no changes applied."
  return
}

if (-not $ConfirmPublished) { throw 'ConfirmPublished is required' }
if ($ConfirmEnvironmentId -ne $FixedEnvironmentId) { throw 'ConfirmEnvironmentId does not exactly match the fixed production environment' }
$commit = (& git -C $Root rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $ExpectedCommit -ne $commit) { throw 'ExpectedCommit does not exactly match HEAD' }
$versionSource = Get-Content -LiteralPath (Join-Path $Root 'config\app-version.js') -Raw -Encoding UTF8
if ($versionSource -notmatch "displayVersion:\s*'([^']+)'" -or $ConfirmVersion -ne $Matches[1]) {
  throw 'ConfirmVersion does not exactly match the release candidate'
}

$updated = New-Object 'System.Collections.Generic.List[string]'
try {
  foreach ($functionName in $Targets.Keys) {
    $next = [ordered]@{}
    foreach ($key in $original[$functionName].Keys) { $next[$key] = $original[$functionName][$key] }
    foreach ($key in $Targets[$functionName].Keys) { $next[$key] = $Targets[$functionName][$key] }
    Update-FunctionEnvironment $functionName $next
    $verified = EnvironmentMap (Invoke-TcbJsonRead @('fn', 'detail', $functionName, '-e', $FixedEnvironmentId, '--json'))
    if (-not (Test-EnvironmentEqual $next $verified)) { throw "$functionName environment verification failed" }
    $updated.Add($functionName)
  }
} catch {
  foreach ($functionName in $updated) {
    try { Update-FunctionEnvironment $functionName $original[$functionName] } catch {}
  }
  throw
}

Write-Output 'Production environment switch verified: invite=release; reminder=formal; existing secrets preserved.'
