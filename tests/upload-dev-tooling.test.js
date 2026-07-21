const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const script = fs.readFileSync(path.join(__dirname, '..', 'tools', 'upload-dev.ps1'), 'utf8')

assert.match(script, /\[string\]\$VerifiedPreviewInfo/, 'upload should accept a verified auto-preview info file')
assert.match(script, /\$previewPayload\.size\.total/, 'upload should read the compiled package size')
assert.match(script, /\$previewInfoWrite\s+-ge\s+\$latestUploadSourceWrite/, 'preview evidence must be newer than the staged source')
assert.match(script, /\$previewPackageBytes\s+-le\s+\(1980 \* 1KB\)/, 'verified compiled package must remain below the upload limit buffer')
assert.match(script, /-and !\$previewVerified/, 'oversized source should only bypass the conservative gate with verified preview evidence')

console.log('upload dev tooling tests passed')
