const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const script = fs.readFileSync(path.join(root, 'tools', 'auto-preview.ps1'), 'utf8')
const config = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'))
const privateConfig = JSON.parse(fs.readFileSync(path.join(root, 'project.private.config.json'), 'utf8'))

function ignoredValues(source) {
  return new Set(((source.packOptions || {}).ignore || []).map(item => item.value))
}

assert(script.includes('Clear-StaleAutoPreviewWorkers'), 'preview should clear orphaned CLI workers before starting')
assert(script.includes('Stop-ProcessTree'), 'preview timeout should terminate the complete CLI process tree')
assert(script.includes('TimeoutSeconds'), 'preview should have an internal bounded timeout')
assert(script.includes("'--debug'"), 'preview should retain CLI debug output for diagnosis')
assert(script.includes("'--info-output'"), 'preview should write the decisive CLI result to an info file')
assert(script.includes('Test-AutoPreviewInfo'), 'valid info-output should be accepted when this DevTools version omits an exit code')
assert(script.includes('Set-DevToolsProjectTrust'), 'clean preview project should be trusted before opening DevTools')
assert(script.includes('isTrusted'), 'project trust should use the DevTools project-level trust flag')
assert(script.includes('sourceProjectPath'), 'clean project trust should inherit AppID metadata from the real project cache')
assert(script.includes('Open-PreviewProject'), 'stable preview project should be explicitly loaded before auto-preview')
assert(script.includes("$stagingRoot = \"$PreviewRoot-staging\""), 'clean package should be built away from the active DevTools project')
assert(script.includes('robocopy'), 'staging package should be mirrored into the stable preview path')
assert(script.includes("'/MIR'"), 'stable preview path should be synchronized without deleting its locked root')
assert(!script.includes('Remove-Item -LiteralPath $PreviewRoot -Recurse'), 'active preview root must never be recursively deleted')
assert(!script.includes("Invoke-AutoPreview -TargetProject $ProjectRoot"), 'known oversized real workspace should not be attempted first')
assert(script.includes("Invoke-AutoPreview -TargetProject $cleanProject"), 'preview should invoke the clean runtime package directly')

const trustIndex = script.indexOf('Set-DevToolsProjectTrust -TargetProject $cleanProject')
const openIndex = script.indexOf('Open-PreviewProject -TargetProject $cleanProject')
const previewIndex = script.indexOf('Invoke-AutoPreview -TargetProject $cleanProject')
assert(trustIndex >= 0 && trustIndex < previewIndex, 'clean project must be trusted before auto-preview starts')
assert(openIndex > trustIndex && openIndex < previewIndex, 'clean project must be loaded after trust and before auto-preview')


for (const source of [config, privateConfig]) {
  const ignored = ignoredValues(source)
  assert(ignored.has('assets/session-icons/p5-ai-reminder-v251.png'))
  assert(ignored.has('assets/branding/miniapp-avatar'))
  assert(ignored.has('assets/p5-knight-bg.svg'))
  assert(ignored.has('.env.local'))
}

console.log('auto preview tooling ok')
