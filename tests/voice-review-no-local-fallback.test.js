const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const reviewListJs = fs.readFileSync(path.resolve(__dirname, '../pages/review-list/review-list.js'), 'utf8');

test('voice review cloud transport failures ask user to retry instead of silently switching to local fallback', () => {
  assert.doesNotMatch(reviewListJs, /云端复盘失败，已切到本地兜底/);
  assert.doesNotMatch(reviewListJs, /云端复盘暂不可用，已生成本地兜底字段建议/);
  assert.doesNotMatch(reviewListJs, /云端复盘暂不可用，已生成本地字段建议/);
  assert.doesNotMatch(reviewListJs, /: fallbackVoice/);
  assert.ok(
    reviewListJs.includes('????????????') ||
    reviewListJs.includes('\\u4e91\\u7aef\\u89e3\\u6790\\u5931\\u8d25\\uff0c\\u8bf7\\u7a0d\\u540e\\u91cd\\u8bd5'),
    'cloud transport failures should ask the user to retry'
  );
});
