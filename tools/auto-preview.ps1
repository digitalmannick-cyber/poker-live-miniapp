param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
  [string]$DevToolsCli = 'C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat',
  [string]$Port = '31514',
  [string]$PreviewRoot = (Join-Path $env:TEMP 'poker-live-miniapp-auto-preview'),
  [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = 'Stop'

function Copy-IfExists {
  param(
    [string]$Source,
    [string]$Destination
  )
  if (Test-Path -LiteralPath $Source) {
    Copy-Item -LiteralPath $Source -Destination $Destination -Recurse -Force
  }
}

function Stop-ProcessTree {
  param([int]$ProcessId)
  $children = Get-CimInstance Win32_Process -Filter "ParentProcessId=$ProcessId" -ErrorAction SilentlyContinue
  foreach ($child in $children) {
    Stop-ProcessTree -ProcessId $child.ProcessId
  }
  Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

function Clear-StaleAutoPreviewWorkers {
  $workers = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -match 'common\\cli\\index\.js' -and $_.CommandLine -match '\bauto-preview\b'
  }
  foreach ($worker in $workers) {
    Stop-ProcessTree -ProcessId $worker.ProcessId
  }
  if (@($workers).Count) {
    Write-Host "Cleared stale auto-preview workers: $(@($workers).Count)"
  }
}

function Set-DevToolsProjectTrust {
  param(
    [string]$TargetProject,
    [string]$SourceProject
  )

  $userDataRoot = Get-ChildItem -LiteralPath $env:LOCALAPPDATA -Directory -ErrorAction SilentlyContinue |
    ForEach-Object { Join-Path $_.FullName 'User Data' } |
    Where-Object {
      (Test-Path -LiteralPath $_ -PathType Container) -and
      @(Get-ChildItem -LiteralPath $_ -Directory -ErrorAction SilentlyContinue | Where-Object {
        Test-Path -LiteralPath (Join-Path $_.FullName 'WeappLocalData') -PathType Container
      }).Count -gt 0
    } |
    Select-Object -First 1
  if (!$userDataRoot) {
    throw 'WeChat DevTools user data directory not found.'
  }

  $trustScript = @'
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const userDataRoot = process.argv[2];
const projectPath = path.resolve(process.argv[3]);
const sourceProjectPath = path.resolve(process.argv[4]);
const readObject = filePath => {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error instanceof SyntaxError)) return {};
    throw error;
  }
};
const writeObject = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

const candidates = [userDataRoot, ...fs.readdirSync(userDataRoot, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => path.join(userDataRoot, entry.name))];
let trustedCount = 0;
for (const instanceDir of candidates) {
  const localDataDir = path.join(instanceDir, 'WeappLocalData');
  if (!fs.existsSync(localDataDir) || !fs.statSync(localDataDir).isDirectory()) continue;
  const key = `project2_${projectPath}`;
  const hash = crypto.createHash('md5').update(key).digest('hex');
  const sourceKey = `project2_${sourceProjectPath}`;
  const sourceHash = crypto.createHash('md5').update(sourceKey).digest('hex');
  const hashMapPath = path.join(localDataDir, 'hash_key_map_2.json');
  const hashMap = readObject(hashMapPath);
  hashMap[hash] = key;
  writeObject(hashMapPath, hashMap);
  for (const fileName of [`localstorage_${hash}.json`, `ls_${hash}.json`]) {
    const projectFilePath = path.join(localDataDir, fileName);
    const projectData = readObject(projectFilePath);
    const sourceFileName = fileName.startsWith('localstorage_')
      ? `localstorage_${sourceHash}.json`
      : `ls_${sourceHash}.json`;
    const sourceData = readObject(path.join(localDataDir, sourceFileName));
    writeObject(projectFilePath, {
      ...sourceData,
      ...projectData,
      projectid: projectData.projectid || projectPath,
      projectpath: projectData.projectpath || projectPath,
      isTrusted: true
    });
  }
  trustedCount += 1;
}
if (!trustedCount) throw new Error(`No WeChat DevTools instance found under ${userDataRoot}`);
process.stdout.write(String(trustedCount));
'@

  $trustedCount = $trustScript | node - $userDataRoot $TargetProject $SourceProject
  if ([int]$trustedCount -le 0) {
    throw "Failed to trust clean preview project: $TargetProject"
  }
  Write-Host "Trusted clean preview project in $trustedCount DevTools profile(s)."
}

function Open-PreviewProject {
  param([string]$TargetProject)

  $arguments = @(
    'open',
    '--project', ('"{0}"' -f $TargetProject),
    '--port', $Port,
    '--lang', 'zh'
  )
  $process = Start-Process -FilePath $DevToolsCli -ArgumentList $arguments `
    -WindowStyle Hidden -PassThru
  if (!$process.WaitForExit(20000)) {
    Stop-ProcessTree -ProcessId $process.Id
    throw "Timed out while loading clean preview project: $TargetProject"
  }
  Start-Sleep -Milliseconds 1000
}

function Assert-PreviewRoot {
  $tempRootResolved = (Resolve-Path -LiteralPath $env:TEMP).Path
  $previewParent = Split-Path -Parent $PreviewRoot
  $previewPrefix = Split-Path -Leaf $PreviewRoot
  if (!(Test-Path -LiteralPath $previewParent)) {
    New-Item -ItemType Directory -Path $previewParent | Out-Null
  }
  $previewParentResolved = (Resolve-Path -LiteralPath $previewParent).Path
  if (!$previewParentResolved.StartsWith($tempRootResolved, [System.StringComparison]::OrdinalIgnoreCase) -or
      $previewPrefix -ne 'poker-live-miniapp-auto-preview') {
    throw "Unexpected preview directory base: $PreviewRoot"
  }
}

function New-CleanPreviewPackage {
  param([string]$SourceRoot)

  Assert-PreviewRoot
  $stagingRoot = "$PreviewRoot-staging"
  if (Test-Path -LiteralPath $stagingRoot) {
    Remove-Item -LiteralPath $stagingRoot -Recurse -Force
  }
  New-Item -ItemType Directory -Path $stagingRoot | Out-Null

  $runtimeDirs = @(
    'assets',
    'components',
    'config',
    'custom-tab-bar',
    'pages',
    'services',
    'utils'
  )
  foreach ($dir in $runtimeDirs) {
    Copy-IfExists -Source (Join-Path $SourceRoot $dir) -Destination (Join-Path $stagingRoot $dir)
  }

  $runtimeFiles = @(
    'app.js',
    'app.json',
    'app.wxss',
    'sitemap.json',
    'project.config.json',
    'project.private.config.json'
  )
  foreach ($file in $runtimeFiles) {
    Copy-IfExists -Source (Join-Path $SourceRoot $file) -Destination (Join-Path $stagingRoot $file)
  }

  $unusedPreviewAssets = @(
    'assets/session-icons/p5-ai-reminder-v251.png',
    'assets/branding/miniapp-avatar-144-pro.png',
    'assets/branding/miniapp-avatar-144-v2.png',
    'assets/branding/miniapp-avatar-144-v3.png',
    'assets/branding/miniapp-avatar-144.png',
    'assets/branding/generate-miniapp-avatar.ps1',
    'assets/branding/generate-miniapp-avatar-v2.ps1',
    'assets/branding/generate-miniapp-avatar-v3.ps1',
    'assets/session-icons/p5-buyin-v248.png',
    'assets/session-icons/p5-comment-v248.png',
    'assets/session-icons/p5-full-v248.png',
    'assets/session-icons/p5-quick-v248.png',
    'assets/p5-knight-bg.svg',
    'assets/p5-reference-character.svg'
  )
  foreach ($relativePath in $unusedPreviewAssets) {
    $target = Join-Path $stagingRoot $relativePath
    if (Test-Path -LiteralPath $target) {
      Remove-Item -LiteralPath $target -Force
    }
  }

  $patchConfigScript = @'
const fs = require('fs');
const path = require('path');
const dest = process.argv[2];
for (const fileName of ['project.config.json', 'project.private.config.json']) {
  const filePath = path.join(dest, fileName);
  if (!fs.existsSync(filePath)) continue;
  const config = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  config.appid = 'wxaefcdacf2d4eb6d0';
  config.projectname = 'poker-live-miniapp-auto-preview';
  delete config.cloudfunctionRoot;
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf8');
}
'@
  $patchConfigScript | node - $stagingRoot

  if (!(Test-Path -LiteralPath $PreviewRoot)) {
    New-Item -ItemType Directory -Path $PreviewRoot | Out-Null
  }
  $robocopyOutput = & robocopy $stagingRoot $PreviewRoot '/MIR' '/R:2' '/W:1' '/NFL' '/NDL' '/NJH' '/NJS' '/NP'
  $robocopyExitCode = $LASTEXITCODE
  if ($robocopyExitCode -gt 7) {
    throw "Failed to synchronize clean preview package (robocopy=$robocopyExitCode): $($robocopyOutput -join ' ')"
  }
  Remove-Item -LiteralPath $stagingRoot -Recurse -Force

  $totalBytes = (Get-ChildItem -LiteralPath $PreviewRoot -Recurse -File | Measure-Object -Property Length -Sum).Sum
  Write-Host "Preview workspace: $PreviewRoot"
  Write-Host "Preview source size: $([math]::Round($totalBytes / 1KB, 1)) KB"
  return $PreviewRoot
}

function Test-AutoPreviewInfo {
  param([string]$InfoPath)

  if (!(Test-Path -LiteralPath $InfoPath -PathType Leaf)) {
    return $false
  }
  try {
    $payload = Get-Content -LiteralPath $InfoPath -Raw | ConvertFrom-Json
    return [long]$payload.size.total -gt 0
  } catch {
    return $false
  }
}

function Invoke-AutoPreview {
  param(
    [string]$TargetProject,
    [string]$Label
  )

  $logDir = Join-Path $ProjectRoot 'logs'
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $stdoutPath = Join-Path $logDir "auto-preview-$stamp.stdout.log"
  $stderrPath = Join-Path $logDir "auto-preview-$stamp.stderr.log"
  $infoPath = Join-Path $logDir "auto-preview-$stamp.info.json"
  $qrPath = Join-Path $logDir "auto-preview-$stamp.png"
  $arguments = @(
    'auto-preview',
    '--project', ('"{0}"' -f $TargetProject),
    '--port', $Port,
    '--info-output', ('"{0}"' -f $infoPath),
    '--qr-output', ('"{0}"' -f $qrPath),
    '--lang', 'zh',
    '--debug'
  )

  Write-Host "Auto-preview target ($Label): $TargetProject"
  $process = Start-Process -FilePath $DevToolsCli -ArgumentList $arguments `
    -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath `
    -WindowStyle Hidden -PassThru

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while (!$process.HasExited -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    $process.Refresh()
  }

  if (!$process.HasExited) {
    Stop-ProcessTree -ProcessId $process.Id
    return [pscustomobject]@{
      Success = $false
      TimedOut = $true
      ExitCode = -1
      Output = "Auto-preview timed out after $TimeoutSeconds seconds"
      InfoPath = $infoPath
    }
  }

  $process.WaitForExit()
  $stdout = if (Test-Path -LiteralPath $stdoutPath) { Get-Content -LiteralPath $stdoutPath -Raw } else { '' }
  $stderr = if (Test-Path -LiteralPath $stderrPath) { Get-Content -LiteralPath $stderrPath -Raw } else { '' }
  $info = if (Test-Path -LiteralPath $infoPath) { Get-Content -LiteralPath $infoPath -Raw } else { '' }
  $combined = @($stdout, $stderr, $info) -join "`n"
  if ($stdout) { Write-Host $stdout }
  if ($stderr) { Write-Host $stderr }
  if ($info) { Write-Host "Info output: $info" }

  $hasValidInfo = Test-AutoPreviewInfo -InfoPath $infoPath
  $exitCode = $process.ExitCode

  return [pscustomobject]@{
    Success = ($exitCode -eq 0) -or $hasValidInfo
    TimedOut = $false
    ExitCode = $exitCode
    Output = $combined
    InfoPath = $infoPath
  }
}

if (!(Test-Path -LiteralPath $DevToolsCli)) {
  $found = Get-ChildItem -LiteralPath 'C:\Program Files (x86)\Tencent' -Recurse -Filter cli.bat -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($found) {
    $DevToolsCli = $found.FullName
  }
}
if (!(Test-Path -LiteralPath $DevToolsCli)) {
  throw "WeChat DevTools cli.bat not found: $DevToolsCli"
}

$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
Clear-StaleAutoPreviewWorkers

$loginResult = & $DevToolsCli islogin --port $Port --lang zh
if (($loginResult -join "`n") -notmatch '"login"\s*:\s*true') {
  throw 'WeChat DevTools is not logged in.'
}

$cleanProject = New-CleanPreviewPackage -SourceRoot $ProjectRoot
Set-DevToolsProjectTrust -TargetProject $cleanProject -SourceProject $ProjectRoot
Open-PreviewProject -TargetProject $cleanProject
$result = Invoke-AutoPreview -TargetProject $cleanProject -Label 'clean runtime package'

Clear-StaleAutoPreviewWorkers
if (!$result.Success) {
  throw "Auto-preview failed (exit=$($result.ExitCode)): $($result.Output)"
}

Write-Host "Auto-preview succeeded. Info: $($result.InfoPath)"
