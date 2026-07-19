param(
  [string]$Description = "开发版更新",
  [int]$Port = 0,
  [string]$CliPath = "",
  [int]$TimeoutSeconds = 180,
  [switch]$NoBump
)

$ErrorActionPreference = "Stop"
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $false
}

$root = Split-Path -Parent $PSScriptRoot
$tencentRoot = "C:\Program Files (x86)\Tencent"
if (-not $CliPath) {
  $cliCandidate = Get-ChildItem -LiteralPath $tencentRoot -Recurse -Filter "cli.bat" -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -like "*web*" -or $_.FullName -like "*开发者工具*" } |
    Select-Object -First 1
  if (-not $cliCandidate) {
    $cliCandidate = Get-ChildItem -LiteralPath $tencentRoot -Recurse -Filter "cli.bat" -ErrorAction SilentlyContinue |
      Select-Object -First 1
  }
  if (-not $cliCandidate) {
    throw "Cannot find WeChat DevTools cli.bat under $tencentRoot."
  }
  $CliPath = $cliCandidate.FullName
}
if (-not (Test-Path -LiteralPath $CliPath)) {
  throw "WeChat DevTools cli.bat not found: $CliPath"
}

$versionFile = Join-Path $root "config\app-version.js"
$versionText = Get-Content -LiteralPath $versionFile -Raw -Encoding UTF8
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"

if ($versionText -notmatch "displayVersion:\s*'(\d+)\.(\d{2})'") {
  throw "Cannot find displayVersion in config/app-version.js. Expected format like 1.18."
}

$major = [int]$Matches[1]
$patch = [int]$Matches[2]

if (-not $NoBump) {
  $patch += 1
  if ($patch -gt 99) {
    $major += 1
    $patch = 0
  }
  $nextVersion = ("{0}.{1:D2}" -f $major, $patch)
  $nextText = $versionText -replace "displayVersion:\s*'\d+\.\d{2}'", "displayVersion: '$nextVersion'"
  Set-Content -LiteralPath $versionFile -Value $nextText -NoNewline -Encoding UTF8
} else {
  $nextVersion = ("{0}.{1:D2}" -f $major, $patch)
}

$uploadRoot = Join-Path $env:TEMP ("poker-live-miniapp-upload-{0}" -f $stamp)
if (Test-Path -LiteralPath $uploadRoot) {
  Remove-Item -LiteralPath $uploadRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $uploadRoot | Out-Null

$folders = @("assets", "components", "config", "custom-tab-bar", "pages", "services", "utils")
foreach ($folder in $folders) {
  Copy-Item -LiteralPath (Join-Path $root $folder) -Destination (Join-Path $uploadRoot $folder) -Recurse -Force
}

$files = @("app.js", "app.json", "app.wxss", "project.config.json", "project.private.config.json", "sitemap.json")
foreach ($file in $files) {
  Copy-Item -LiteralPath (Join-Path $root $file) -Destination (Join-Path $uploadRoot $file) -Force
}

$uploadPrunePaths = @(
  "assets\session-icons\_preview-current-v251.png",
  "assets\session-icons\_preview-current-v251-large.png",
  "assets\session-icons\p5-buyin-v248.png",
  "assets\session-icons\p5-comment-v248.png",
  "assets\session-icons\p5-full-v248.png",
  "assets\session-icons\p5-quick-v248.png",
  "assets\session-icons\p5-ai-reminder-v251.png",
  "assets\branding\generate-miniapp-avatar.ps1",
  "assets\branding\generate-miniapp-avatar-v2.ps1",
  "assets\branding\generate-miniapp-avatar-v3.ps1",
  "assets\branding\miniapp-avatar-144.png",
  "assets\branding\miniapp-avatar-144-v2.png",
  "assets\branding\miniapp-avatar-144-v3.png",
  "assets\branding\miniapp-avatar-144-pro.png",
  "assets\p5-knight-bg.svg",
  "assets\p5-reference-character.svg"
)
foreach ($relativePath in $uploadPrunePaths) {
  $target = Join-Path $uploadRoot $relativePath
  if (Test-Path -LiteralPath $target) {
    Remove-Item -LiteralPath $target -Force
  }
}

$uploadSourceBytes = (Get-ChildItem -LiteralPath $uploadRoot -Recurse -File | Measure-Object -Property Length -Sum).Sum
$uploadSourceKb = [math]::Round($uploadSourceBytes / 1KB, 1)
Write-Host "Upload workspace $uploadRoot"
Write-Host "Upload source size ${uploadSourceKb}KB"
# Keep a buffer below WeChat's 2 MB source limit without rejecting the same
# clean runtime package that has already passed auto-preview compilation.
if ($uploadSourceBytes -gt (1980 * 1KB)) {
  $largestFiles = Get-ChildItem -LiteralPath $uploadRoot -Recurse -File |
    Sort-Object Length -Descending |
    Select-Object -First 20 @{ Name = "KB"; Expression = { [math]::Round($_.Length / 1KB, 1) } }, FullName |
    Format-Table -AutoSize |
    Out-String
  throw "Upload source is too close to the 2MB limit. Largest files:`n$largestFiles"
}

$logDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$infoOutput = Join-Path $logDir ("wechat-upload-dev-{0}-v{1}.json" -f $stamp, $nextVersion)
$stdoutLog = Join-Path $logDir ("wechat-upload-dev-{0}-v{1}.out.log" -f $stamp, $nextVersion)
$stderrLog = Join-Path $logDir ("wechat-upload-dev-{0}-v{1}.err.log" -f $stamp, $nextVersion)
$wechatVersion = "1.0." + (Get-Date -Format "yyyyMMdd.HHmm") + ".v" + $nextVersion

$arguments = @(
  "upload",
  "--project", $uploadRoot,
  "--version", $wechatVersion,
  "--desc", $Description,
  "--info-output", $infoOutput,
  "--lang", "zh"
)
if ($Port -gt 0) {
  $arguments += @("--port", $Port)
}

function ConvertTo-ProcessArgument {
  param([string]$Value)
  if ($Value -notmatch '[\s"]') {
    return $Value
  }
  return '"' + ($Value -replace '"', '\"') + '"'
}

function Stop-ProcessTree {
  param([int]$ProcessId)
  $children = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ParentProcessId -eq $ProcessId }
  foreach ($child in $children) {
    Stop-ProcessTree -ProcessId $child.ProcessId
  }
  Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

$previousErrorActionPreference = $ErrorActionPreference
try {
  $ErrorActionPreference = "Continue"
  $argumentLine = ($arguments | ForEach-Object { ConvertTo-ProcessArgument $_ }) -join " "
  $uploadProcess = Start-Process -FilePath $CliPath `
    -ArgumentList $argumentLine `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog `
    -NoNewWindow `
    -PassThru
  if (-not $uploadProcess.WaitForExit($TimeoutSeconds * 1000)) {
    Stop-ProcessTree -ProcessId $uploadProcess.Id
    Add-Content -LiteralPath $stderrLog -Value "Timed out after $TimeoutSeconds seconds."
    $exitCode = -1
  } else {
    $exitCode = $uploadProcess.ExitCode
  }
} finally {
  $ErrorActionPreference = $previousErrorActionPreference
}
$uploadOutput = @()
if (Test-Path -LiteralPath $stdoutLog) {
  $uploadOutput += Get-Content -LiteralPath $stdoutLog -Raw -Encoding UTF8
}
if (Test-Path -LiteralPath $stderrLog) {
  $uploadOutput += Get-Content -LiteralPath $stderrLog -Raw -Encoding UTF8
}
$uploadOutput | ForEach-Object { Write-Host $_ }

$uploadText = $uploadOutput -join "`n"
$hasUploadSuccessSignal = $uploadText -match "\bupload\b"
$hasUploadFailureSignal = $uploadText -match "(×|fail|failed|exceed max limit)"

if (($null -ne $exitCode -and $exitCode -ne 0) -or -not $hasUploadSuccessSignal -or $hasUploadFailureSignal) {
  throw "WeChat devtools upload did not finish successfully. Exit code: $exitCode. Stdout: $stdoutLog Stderr: $stderrLog"
}

Write-Host "Uploaded dev version $wechatVersion"
Write-Host "In-app version $nextVersion"
Write-Host "Info output $infoOutput"

# The upload uses a clean temporary project so packaging stays small and stable.
# Re-open the real workspace afterward; otherwise the DevTools window may remain
# on the temp copy, and a later manual "real device debug" pushes stale code.
if ($Port -gt 0) {
  & $CliPath open --project $root --port $Port --lang "zh" | Out-Null
} else {
  & $CliPath open --project $root --lang "zh" | Out-Null
}
Write-Host "Re-opened workspace project $root"
