param(
  [switch]$CheckEnv,
  [string]$PythonPath = "C:\Users\11075\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe",
  [string]$CliPath = "",
  [int]$Port = 39743,
  [int]$TestPort = 9420
)

$ErrorActionPreference = "Stop"
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $false
}

$root = Split-Path -Parent $PSScriptRoot
$miniumTarget = Join-Path $root ".minium-python"
$miniumBin = Join-Path $miniumTarget "bin\miniruntest.exe"
$configPath = Join-Path $root "minium\config.json"
$casePath = Join-Path $root "minium\tests"
$outputPath = Join-Path $root "logs\minium"
$runtimeConfigPath = Join-Path $outputPath "runtime-config.json"

Push-Location $root
try {
if (-not (Test-Path -LiteralPath $PythonPath)) {
  throw "Python runtime not found: $PythonPath"
}

if (-not $CliPath) {
  $tencentRoot = "C:\Program Files (x86)\Tencent"
  $cliCandidate = Get-ChildItem -LiteralPath $tencentRoot -Recurse -Filter "cli.bat" -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -like "*web*" -or $_.FullName -like "*DevTools*" } |
    Select-Object -First 1
  if (-not $cliCandidate) {
    $cliCandidate = Get-ChildItem -LiteralPath $tencentRoot -Recurse -Filter "cli.bat" -ErrorAction SilentlyContinue |
      Select-Object -First 1
  }
  if ($cliCandidate) {
    $CliPath = $cliCandidate.FullName
  }
}

if (-not (Test-Path -LiteralPath $CliPath)) {
  throw "WeChat DevTools cli.bat not found: $CliPath"
}

New-Item -ItemType Directory -Force -Path $outputPath | Out-Null

if (-not (Test-Path -LiteralPath $miniumBin)) {
  & $PythonPath -m pip install --target $miniumTarget minium==1.6.0
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to install Minium into $miniumTarget"
  }
}

$wxMiniumPath = Join-Path $miniumTarget "minium\miniprogram\wx_minium.py"
if (Test-Path -LiteralPath $wxMiniumPath) {
  $wxMiniumSource = Get-Content -LiteralPath $wxMiniumPath -Raw -Encoding UTF8
  $oldSdkLine = "        self.sdk_version = Version(result.SDKVersion)"
  $newSdkLine = "        self.sdk_version = Version(result.get(""SDKVersion"", self.conf.get(""sdk_version"", ""3.15.2"")))"
  if ($wxMiniumSource.Contains($oldSdkLine)) {
    $wxMiniumSource = $wxMiniumSource.Replace($oldSdkLine, $newSdkLine)
    Set-Content -LiteralPath $wxMiniumPath -Value $wxMiniumSource -NoNewline -Encoding UTF8
  }
}

$templateConfig = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
$projectConfig = Get-Content -LiteralPath (Join-Path $root "project.config.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$templateConfig.project_path = $root
$templateConfig.dev_tool_path = $CliPath
$templateConfig.test_port = $TestPort
$templateConfig.appid = $projectConfig.appid
$templateConfig.sdk_version = $projectConfig.libVersion
$templateConfig.outputs = "logs/minium"
$runtimeConfigJson = $templateConfig | ConvertTo-Json -Depth 8
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($runtimeConfigPath, $runtimeConfigJson, $utf8NoBom)

$env:PYTHONPATH = $miniumTarget

if ($CheckEnv) {
  & $PythonPath $miniumBin --check-env -c $runtimeConfigPath --test-port $TestPort
  exit $LASTEXITCODE
}

& $CliPath auto --project $root --port $Port --lang zh
if ($LASTEXITCODE -ne 0) {
  throw "Failed to enable WeChat DevTools automation on port $Port"
}

$stdoutLog = Join-Path $outputPath "minium-run.out.log"
$stderrLog = Join-Path $outputPath "minium-run.err.log"
$arguments = @(
  $miniumBin,
  "-p", $casePath,
  "-m", "test_smoke_tabs",
  "-c", $runtimeConfigPath,
  "-g",
  "--test-port", $TestPort
)
$process = Start-Process -FilePath $PythonPath -ArgumentList $arguments -NoNewWindow -Wait -PassThru -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog
$miniumExitCode = $process.ExitCode
$miniumOutput = @()
if (Test-Path -LiteralPath $stdoutLog) {
  $miniumOutput += Get-Content -LiteralPath $stdoutLog -Raw -Encoding UTF8
}
if (Test-Path -LiteralPath $stderrLog) {
  $miniumOutput += Get-Content -LiteralPath $stderrLog -Raw -Encoding UTF8
}
$miniumOutput | ForEach-Object { Write-Host $_ }

$miniumText = $miniumOutput -join "`n"
$hasFailure = $miniumText -match "failed num:[1-9]" -or
  $miniumText -match "error num:[1-9]" -or
  $miniumText -match " has error:" -or
  $miniumText -match "Traceback \(most recent call last\)" -or
  $miniumText -match "MiniConfigError"

if ($miniumExitCode -ne 0 -or $hasFailure) {
  exit 1
}
exit 0
} finally {
  Pop-Location
}
