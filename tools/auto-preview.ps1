param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
  [string]$DevToolsCli = 'C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat',
  [string]$Port = '31514',
  [string]$PreviewRoot = (Join-Path $env:TEMP 'poker-live-miniapp-auto-preview')
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

if (!(Test-Path -LiteralPath $DevToolsCli)) {
  $found = Get-ChildItem -LiteralPath 'C:\Program Files (x86)\Tencent' -Recurse -Filter cli.bat -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($found) {
    $DevToolsCli = $found.FullName
  }
}

if (!(Test-Path -LiteralPath $DevToolsCli)) {
  throw "WeChat DevTools cli.bat not found: $DevToolsCli"
}

$projectRootResolved = (Resolve-Path -LiteralPath $ProjectRoot).Path
$tempRootResolved = (Resolve-Path -LiteralPath $env:TEMP).Path
$previewParent = Split-Path -Parent $PreviewRoot
if (!(Test-Path -LiteralPath $previewParent)) {
  New-Item -ItemType Directory -Path $previewParent | Out-Null
}

if (Test-Path -LiteralPath $PreviewRoot) {
  $previewResolved = (Resolve-Path -LiteralPath $PreviewRoot).Path
  if (!$previewResolved.StartsWith($tempRootResolved, [System.StringComparison]::OrdinalIgnoreCase) -or
      (Split-Path -Leaf $previewResolved) -ne 'poker-live-miniapp-auto-preview') {
    throw "Refuse to delete unexpected preview directory: $previewResolved"
  }
  Remove-Item -LiteralPath $previewResolved -Recurse -Force
}

New-Item -ItemType Directory -Path $PreviewRoot | Out-Null

$runtimeDirs = @(
  'assets',
  'components',
  'config',
  'custom-tab-bar',
  'pages',
  'services',
  'utils',
  'cloudfunctions'
)

foreach ($dir in $runtimeDirs) {
  Copy-IfExists -Source (Join-Path $projectRootResolved $dir) -Destination (Join-Path $PreviewRoot $dir)
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
  Copy-IfExists -Source (Join-Path $projectRootResolved $file) -Destination (Join-Path $PreviewRoot $file)
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
  config.cloudfunctionRoot = 'cloudfunctions/';
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf8');
}
'@

$patchConfigScript | node - $PreviewRoot

$totalBytes = (Get-ChildItem -LiteralPath $PreviewRoot -Recurse -File | Measure-Object -Property Length -Sum).Sum
Write-Output "Preview workspace: $PreviewRoot"
Write-Output "Preview source size: $([math]::Round($totalBytes / 1KB, 1)) KB"

& $DevToolsCli auto-preview --project $PreviewRoot --port $Port
