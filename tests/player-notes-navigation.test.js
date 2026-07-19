const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const tabState = require('../utils/tab-state')
const appConfig = require('../app.json')

const playerNotesJs = fs.readFileSync(path.join(__dirname, '..', 'pages', 'player-notes', 'player-notes.js'), 'utf8')
const playerNotesWxss = fs.readFileSync(path.join(__dirname, '..', 'pages', 'player-notes', 'player-notes.wxss'), 'utf8')
const playerNotesJson = fs.readFileSync(path.join(__dirname, '..', 'pages', 'player-notes', 'player-notes.json'), 'utf8')
const friendHubWxml = fs.readFileSync(path.join(__dirname, '..', 'components', 'friend-hub', 'friend-hub.wxml'), 'utf8')
const playerDetailJs = fs.readFileSync(path.join(__dirname, '..', 'pages', 'player-note-detail', 'player-note-detail.js'), 'utf8')
const playerDetailWxml = fs.readFileSync(path.join(__dirname, '..', 'pages', 'player-note-detail', 'player-note-detail.wxml'), 'utf8')
const playerDetailWxss = fs.readFileSync(path.join(__dirname, '..', 'pages', 'player-note-detail', 'player-note-detail.wxss'), 'utf8')
const avatarCacheJs = fs.readFileSync(path.join(__dirname, '..', 'utils', 'player-avatar-cache.js'), 'utf8')

assert.ok(appConfig.pages.includes('pages/player-notes/player-notes'), 'app.json should register player notes list page')
assert.ok(appConfig.pages.includes('pages/player-note-detail/player-note-detail'), 'app.json should register player note detail page')

;['js', 'wxml', 'wxss', 'json'].forEach(ext => {
  assert.ok(
    fs.existsSync(path.join(__dirname, '..', 'pages', 'player-notes', 'player-notes.' + ext)),
    'player notes list page should include .' + ext
  )
  assert.ok(
    fs.existsSync(path.join(__dirname, '..', 'pages', 'player-note-detail', 'player-note-detail.' + ext)),
    'player note detail page should include .' + ext
  )
})

assert.deepEqual(
  tabState.TAB_ITEMS.map(item => item.text),
  ['场次', '手牌', '玩家', '统计', '我的'],
  'custom tab order should be 场次 / 手牌 / 玩家 / 统计 / 我的'
)

assert.equal(tabState.TAB_ITEMS[1].pagePath, '/pages/review-list/review-list')
assert.equal(tabState.TAB_ITEMS[2].pagePath, '/pages/player-notes/player-notes')

const selected = tabState.buildTabItems('/pages/player-notes/player-notes')
assert.equal(selected[2].active, true, 'player notes tab should select correctly')

assert.match(playerNotesJs, /cardColor:\s*color/, 'player list items should expose type color to the full card')
assert.match(playerNotesWxss, /background:\s*linear-gradient\(105deg,\s*var\(--player-card-color\)/, 'player cards should tint the whole row by player type')
assert.match(playerNotesWxss, /height:\s*204rpx/, 'player cards should use a fixed height so rows stay visually consistent')
assert.match(playerNotesWxss, /grid-template-columns:\s*8rpx 156rpx minmax\(0,\s*1fr\)/, 'player cards should use a larger avatar column and more of the row width')
assert.match(playerNotesWxss, /\.player-type\s*\{[\s\S]*position:\s*absolute/, 'player type badges should not reserve blank space in the content row')
assert.match(playerNotesWxss, /\.player-tags\s*\{[\s\S]*flex-wrap:\s*nowrap/, 'player leak tags should stay on one row inside fixed-height cards')
assert.match(playerNotesJs, /avatarCache\.getAvatarDisplayUrl/, 'player list should prefer cached avatar display paths')
assert.match(playerNotesJs, /avatarCache\.warmPlayerAvatars/, 'player list should warm cloud avatars into local display cache')
assert.match(avatarCacheJs, /wx\.cloud\.downloadFile/, 'avatar cache should download cloud avatars for later instant display')
assert.match(playerNotesWxss, /\.player-section-tabs/, 'player page should provide a top-level friends/library switch')
assert.match(playerNotesJson, /friend-hub/, 'player page should register the friend hub component')
assert.match(playerNotesWxss, /\.player-list/, 'library card styling should remain on the player page')
assert.match(friendHubWxml, /动态[\s\S]*好友[\s\S]*排行榜/, 'friends should keep their nested navigation')

assert.match(playerDetailWxml, /leak-remove/, 'leak tag library should render removable tags')
assert.match(playerDetailJs, /removeLeakTag/, 'player note detail should support deleting leak tags from the library')
assert.match(playerDetailJs, /updateSettings\(\{\s*playerLeakTags:\s*library\s*\},\s*\{\s*waitForCloud:\s*true\s*\}\)/, 'player leak tag library changes should wait for cloud settings persistence')

assert.match(playerDetailWxss, /position:\s*sticky/, 'player edit actions should stay above the bottom safe area')
assert.doesNotMatch(playerDetailWxml, /<button class="(?:primary-action|secondary-action)"/, 'player edit bottom actions should not use native button styles that overflow on device')
assert.match(playerDetailWxss, /\.primary-action::after,\s*\.secondary-action::after/s, 'player edit bottom actions should remove native button pseudo borders if button styles return')
assert.match(playerDetailWxml, /bindtap="goBack"/, 'player note detail back button should use navigation logic instead of edit cancel only')
assert.match(playerDetailJs, /goBack\(\)/, 'player note detail should implement a real back handler')
assert.match(playerDetailJs, /wx\.redirectTo\(\{\s*url:\s*'\/pages\/hand-detail\/hand-detail\?id='/, 'battle hand detail opened from player notes should replace the detail page so native back returns to the player list')
assert.match(playerDetailJs, /versusSummary/, 'player battle hands should normalize a compact hero-vs-opponent summary')
assert.match(playerDetailWxml, /battle-vs-row/, 'player battle hand cards should render a one-line VS summary')
assert.match(playerDetailWxml, /item\.versusSummary\.hasOpponentCards/, 'opponent cards should render only when showdown cards exist')
assert.match(playerDetailWxss, /\.battle-vs-row\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+118rpx\s+minmax\(0,\s*1fr\)/, 'VS summary should reserve a narrow center column for VS and profit')

console.log('player notes navigation tests passed')
