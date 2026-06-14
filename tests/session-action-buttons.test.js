const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const wxml = fs.readFileSync(path.resolve(__dirname, '../pages/session-detail/session-detail.wxml'), 'utf8');
const wxss = fs.readFileSync(path.resolve(__dirname, '../pages/session-detail/session-detail.wxss'), 'utf8');

function getRule(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`));
  assert.ok(match, `${selector} rule should exist`);
  return match[1];
}

test('session action area uses custom view buttons instead of native buttons', () => {
  const start = wxml.indexOf('class="session-action-row');
  const end = wxml.indexOf('</view>', start);
  const block = wxml.slice(start, end);

  assert.ok(start >= 0, 'session action row should exist');
  assert.doesNotMatch(block, /<button\b/, 'native button should not be used in the four-action grid');
  assert.match(block, /role="button"/, 'custom action controls should expose button role');
});

test('session action grid has stable two-column cards with no native button residue', () => {
  const grid = getRule(wxss, '.session-action-row.session-action-grid');
  assert.match(grid, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
  assert.match(grid, /gap:\s*14rpx;/);

  const button = getRule(wxss, '.session-action-btn');
  assert.match(button, /border:\s*1rpx solid/);
  assert.match(button, /-webkit-appearance:\s*none;/);
  assert.match(button, /background-clip:\s*padding-box;/);
  assert.match(button, /transform:\s*translateZ\(0\);/);
});
