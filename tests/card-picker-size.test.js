const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function getRule(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`));
  assert.ok(match, `${selector} rule should exist`);
  return match[1];
}

test('card picker uses larger touch targets in all picker surfaces', () => {
  [
    'pages/review-list/review-list.wxss',
    'pages/hand-record/hand-record.wxss',
    'pages/hand-detail/hand-detail.wxss',
  ].forEach((file) => {
    const css = read(file);
    const card = getRule(css, '.hero-picker-card');
    assert.match(card, /width:\s*80rpx;/, `${file} card width should be enlarged`);
    assert.match(card, /height:\s*108rpx;/, `${file} card height should be enlarged`);

    const row = getRule(css, '.hero-picker-row');
    assert.match(row, /flex-wrap:\s*wrap;/, `${file} rows should wrap instead of shrinking cards`);
    assert.match(row, /gap:\s*12rpx;/, `${file} rows should keep enough spacing between large cards`);
  });
});

test('card picker keeps a usable minimum size on narrow devices', () => {
  [
    'pages/review-list/review-list.wxss',
    'pages/hand-record/hand-record.wxss',
    'pages/hand-detail/hand-detail.wxss',
  ].forEach((file) => {
    const css = read(file);
    assert.match(css, /@media \(max-width:\s*360px\)[\s\S]*width:\s*72rpx;/, `${file} narrow width should remain tappable`);
    assert.match(css, /@media \(max-width:\s*360px\)[\s\S]*height:\s*100rpx;/, `${file} narrow height should remain tappable`);
  });
});

test('review board cards open picker at the tapped card index', () => {
  const wxml = read('pages/review-list/review-list.wxml');
  const js = read('pages/review-list/review-list.js');
  const detailWxml = read('pages/hand-detail/hand-detail.wxml');
  const detailJs = read('pages/hand-detail/hand-detail.js');

  assert.match(wxml, /wx:for-index="cardIndex"/);
  assert.match(wxml, /data-replace-index="{{cardIndex}}"/);
  assert.match(wxml, /catchtap="openVoiceBoardPicker"/);
  assert.match(js, /dataset\.replaceIndex/);
  assert.match(js, /voiceBoardReplaceIndex:\s*normalizedReplaceIndex/);

  assert.match(detailWxml, /wx:for-index="cardIndex"/);
  assert.match(detailWxml, /data-replace-index="{{cardIndex}}"/);
  assert.match(detailWxml, /catchtap="openBoardPicker"/);
  assert.match(detailJs, /dataset\.replaceIndex/);
  assert.match(detailJs, /boardReplaceIndex:\s*normalizedReplaceIndex/);
  assert.match(detailJs, /selectBoardReplaceCard/);
});
