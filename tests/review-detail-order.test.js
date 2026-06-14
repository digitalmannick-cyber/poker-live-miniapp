const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const wxml = fs.readFileSync(path.resolve(__dirname, '../pages/review-list/review-list.wxml'), 'utf8');

test('review detail shows mind journey directly after action summary', () => {
  const actionSummary = wxml.indexOf('{{detailHand.actionLine}}');
  const mindJourney = wxml.indexOf('{{detailHand.mindJourney}}');
  const streetRecognition = wxml.indexOf('<view wx:if="{{detailHand.hasStreetItems}}" class="review-detail-block">');

  assert.ok(actionSummary >= 0, 'detail action summary should exist');
  assert.ok(mindJourney >= 0, 'detail mind journey should exist');
  assert.ok(streetRecognition >= 0, 'detail street recognition should exist');
  assert.ok(actionSummary < mindJourney, 'mind journey should be after action summary');
  assert.ok(mindJourney < streetRecognition, 'mind journey should be before street recognition');
});

test('AI parsed preview shows mind journey directly after action summary', () => {
  const actionSummary = wxml.indexOf('{{parsedVoice.streetSummary}}');
  const mindJourney = wxml.indexOf('{{parsedVoice.mindJourney}}');
  const streetRecognition = wxml.indexOf('<view wx:if="{{parsedVoice.streetItems.length}}" class="review-detail-block">');

  assert.ok(actionSummary >= 0, 'parsed action summary should exist');
  assert.ok(mindJourney >= 0, 'parsed mind journey should exist');
  assert.ok(streetRecognition >= 0, 'parsed street recognition should exist');
  assert.ok(actionSummary < mindJourney, 'parsed mind journey should be after action summary');
  assert.ok(mindJourney < streetRecognition, 'parsed mind journey should be before street recognition');
});

test('street recognition renders board cards beside street pot and action', () => {
  assert.ok(wxml.includes('review-street-board-mini'), 'street rows should render board cards inline');
  assert.ok(wxml.includes('{{item.boardCards}}'), 'street rows should use boardCards from view model');
  assert.ok(wxml.includes('Pot {{item.pot}}'), 'street rows should keep pot in the same street header');
});

test('standalone board panels are not rendered in active review detail sections', () => {
  assert.equal(
    wxml.includes('wx:for="{{detailHand.boardVisual}}"'),
    false,
    'detail page should not render a standalone Board block'
  );
  assert.equal(
    wxml.includes('wx:for="{{parsedVoice.boardVisual}}"'),
    false,
    'AI parsed preview should not render a standalone Board block'
  );
});
