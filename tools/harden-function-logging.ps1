[CmdletBinding()]
param(
  [switch]$Apply,
  [string]$ConfirmEnvironmentId = '',
  [string]$ExpectedCommit = '',
  [string]$Root = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$FixedEnvironmentId = 'cloud1-d3ggy9aq3be912e34'
$FixedRegion = 'ap-shanghai'
$FunctionNames = @('poker_social', 'poker_data', 'poker_review', 'doubao_asr')

function Get-JsonFromOutput {
  param([string]$Raw)
  $start = $Raw.IndexOf('{')
  $end = $Raw.LastIndexOf('}')
  if ($start -lt 0 -or $end -le $start) { throw 'CloudBase CLI did not return JSON' }
  return $Raw.Substring($start, $end - $start + 1) | ConvertFrom-Json
}

function Invoke-TcbJson {
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
    if ($attempt -lt 2) { Start-Sleep -Seconds (2 + $attempt * 2) }
  }
  throw 'CloudBase CLI operation failed after retries'
}

function Get-FunctionPrivacyState {
  param([string]$FunctionName)
  $detail = Invoke-TcbJson @('fn', 'detail', $FunctionName, '-e', $FixedEnvironmentId, '--json')
  $data = $detail.data
  if (-not $data -or [string]$data.FunctionName -ne $FunctionName) { throw "Unexpected function detail for $FunctionName" }
  return [pscustomobject]@{
    FunctionName = $FunctionName
    Status = [string]$data.Status
    AvailableStatus = [string]$data.AvailableStatus
    IgnoreSysLog = [bool]$data.IgnoreSysLog
  }
}

if ([string]::IsNullOrWhiteSpace($Root)) { $Root = Split-Path -Parent $PSScriptRoot }
$Root = [IO.Path]::GetFullPath($Root)

if ($Apply) {
  if ($ConfirmEnvironmentId -ne $FixedEnvironmentId) {
    throw 'ConfirmEnvironmentId does not exactly match the fixed production environment'
  }
  $commit = (& git -C $Root rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or $ExpectedCommit -ne $commit) {
    throw 'ExpectedCommit does not exactly match HEAD'
  }
}

$states = @()
foreach ($name in $FunctionNames) {
  $before = Get-FunctionPrivacyState $name
  if ($before.Status -ne 'Active' -or $before.AvailableStatus -ne 'Available') {
    throw "$name is not active and available"
  }
  if ($Apply -and -not $before.IgnoreSysLog) {
    $body = [ordered]@{
      FunctionName = $name
      Namespace = $FixedEnvironmentId
      IgnoreSysLog = $true
    } | ConvertTo-Json -Compress
    # Windows PowerShell removes JSON quotes while invoking native executables unless
    # they are escaped for the child process command line.
    $escapedBody = $body.Replace('"', '\"')
    $null = Invoke-TcbJson @(
      'api', 'scf', 'UpdateFunctionConfiguration',
      '--api-version', '2018-04-16',
      '--body', $escapedBody,
      '-e', $FixedEnvironmentId,
      '-r', $FixedRegion,
      '--json'
    )
    for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
      Start-Sleep -Seconds 2
      $after = Get-FunctionPrivacyState $name
      if ($after.Status -eq 'Active' -and $after.AvailableStatus -eq 'Available' -and $after.IgnoreSysLog) {
        $before = $after
        break
      }
    }
    if (-not $before.IgnoreSysLog) { throw "$name did not enable IgnoreSysLog" }
  }
  $states += $before
}

$states | Select-Object FunctionName, Status, AvailableStatus, IgnoreSysLog | Format-Table -AutoSize
if ($Apply) {
  Write-Output 'Function system response logging is disabled and verified for every user-data function.'
} else {
  Write-Output 'Read-only preflight only. Re-run with -Apply and exact confirmations to change configuration.'
}
