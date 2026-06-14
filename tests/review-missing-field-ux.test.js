const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const js = fs.readFileSync(path.join(root, 'pages/review-list/review-list.js'), 'utf8')
const wxml = fs.readFileSync(path.join(root, 'pages/review-list/review-list.wxml'), 'utf8')
const metaGridStart = wxml.indexOf('<view class="review-voice-meta-grid')
const metaGridEnd = wxml.indexOf('<view class="review-detail-text review-voice-card-line">')
const metaGridWxml = metaGridStart >= 0 && metaGridEnd > metaGridStart ? wxml.slice(metaGridStart, metaGridEnd) : ''
const detailInfoStart = wxml.indexOf('<view class="review-detail-card review-info-card">')
const detailInfoEnd = wxml.indexOf('<view class="review-detail-card">', detailInfoStart + 1)
const detailInfoWxml = detailInfoStart >= 0 && detailInfoEnd > detailInfoStart ? wxml.slice(detailInfoStart, detailInfoEnd) : ''

assert.ok(
  js.includes('MISSING_FIELD_META'),
  'missing fields should be mapped through Chinese field metadata'
)

assert.ok(
  js.includes('focusMissingField'),
  'missing field card tap should focus or open the matching field editor'
)

assert.ok(
  wxml.includes('bindtap="focusMissingField"') && wxml.includes('data-field="{{item.field}}"'),
  'confirm items should be clickable and carry their target field'
)

assert.ok(
  metaGridWxml.includes('parsedVoice.playerCountDisplayText') &&
    /bindinput=/.test(metaGridWxml) &&
    /bindtap="openVoicePresetSelector"/.test(metaGridWxml),
  'voice backfill preview should keep parsed fields editable before confirmation'
)

assert.ok(
  wxml.includes('review-editing-badge">可编辑'),
  'voice backfill field preview should be marked as editable before confirmation'
)

assert.ok(
  detailInfoWxml.includes('detailHand.detailRows') &&
    detailInfoWxml.includes('{{item.label}}') &&
    detailInfoWxml.includes('{{item.displayValue}}'),
  'review detail info card should render the shared canonical row model'
)

assert.ok(
  !/bindinput=|bindtap="openVoicePresetSelector"|review-edit-hint/.test(detailInfoWxml),
  'review detail info card should be read-only display'
)

assert.ok(
  wxml.includes('人数') && !wxml.includes('>桌型<'),
  'voice backfill preview should label player count as 人数 instead of 桌型'
)

assert.ok(
  !wxml.includes('&#x'),
  'voice backfill preview should not render encoded HTML entity labels'
)

assert.ok(
  !/confirmItems[\s\S]{0,400}table_size/.test(js),
  'confirm item text should not expose raw table_size to users'
)

assert.ok(
  js.includes('mergeLocalVoiceFallback') && js.includes('voiceParser.parseVoiceText(text)'),
  'voice review should use the local parser to fill blank Agent extraction fields'
)

assert.ok(
  js.includes('mergeBlankStreetInputs'),
  'street action lines and pots should be merged field-by-field instead of overwritten'
)

console.log('review missing field UX tests passed')
