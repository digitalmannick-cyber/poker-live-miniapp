const childProcess = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const STREETS = ['preflop', 'flop', 'turn', 'river']
const ROOT = path.resolve(__dirname, '..')
const CLOUDBASE_CLI = 'C:/Users/11075/AppData/Roaming/npm/node_modules/@cloudbase/cli/bin/cloudbase'

function numericValue(value) {
  if (value === '' || value === null || value === undefined) return 0
  const number = Number(value)
  return Number.isFinite(number) ? number : value
}

function flattenDisplayFields(hand) {
  const source = hand || {}
  const board = source.board || {}
  const streetInputs = source.streetInputs || {}
  const flat = {
    stakeLevel: source.stakeLevel || '',
    hasStraddle: !!source.hasStraddle,
    straddleAmount: numericValue(source.straddleAmount),
    heroPosition: source.heroPosition || '',
    villainPosition: source.villainPosition || '',
    heroCardsInput: source.heroCardsInput || '',
    effectiveStack: numericValue(source.effectiveStack),
    potSize: numericValue(source.potSize),
    currentProfit: numericValue(source.currentProfit),
    opponentType: source.opponentType || '',
    opponentName: source.opponentName || '',
    'board.flop': board.flop || '',
    'board.turn': board.turn || '',
    'board.river': board.river || '',
    streetSummary: source.streetSummary || '',
    tags: Array.isArray(source.tags) ? source.tags.slice() : []
  }

  STREETS.forEach(street => {
    const item = streetInputs[street] || {}
    flat[`streetInputs.${street}.actionLine`] = item.actionLine || ''
    flat[`streetInputs.${street}.pot`] = numericValue(item.pot)
  })
  return flat
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function valueAtPath(payload, fieldPath) {
  return String(fieldPath || '').split('.').reduce((value, part) => {
    return value && typeof value === 'object' ? value[part] : undefined
  }, payload)
}

function cardRanks(value) {
  return String(value || '').toUpperCase().replace(/10/g, 'T')
    .match(/[AKQJT2-9](?:[SHDC])?/g)?.map(card => card[0]).join('') || ''
}

function normalizedAction(value) {
  return String(value || '').toUpperCase()
    .replace(/ALL[\s_-]*IN/g, 'AI')
    .replace(/SQUEEZE/g, 'SQZ')
    .replace(/OPEN/g, 'R')
    .replace(/RAISE/g, 'R')
    .replace(/CALL/g, 'C')
    .replace(/FOLD/g, 'F')
    .replace(/CHECK/g, 'X')
    .replace(/\s+/g, '')
}

function explicitHand(value) {
  return Array.from(String(value || '').matchAll(/([AKQJT2-9])([shdc])/gi))
    .map(match => [match[1].toUpperCase(), match[2].toLowerCase()])
}

function handCodesMatch(expected, actual) {
  const expectedText = String(expected || '').trim()
  const actualText = String(actual || '').trim()
  if (expectedText.toLowerCase() === actualText.toLowerCase()) return true
  const expectedExplicit = explicitHand(expectedText)
  const actualExplicit = explicitHand(actualText)
  const sorted = cards => cards.slice().sort((left, right) => `${left}`.localeCompare(`${right}`))
  if (expectedExplicit.length === 2) {
    return JSON.stringify(sorted(expectedExplicit)) === JSON.stringify(sorted(actualExplicit))
  }
  if (actualExplicit.length !== 2) return false
  const match = expectedText.match(/^([AKQJT2-9])([AKQJT2-9])([so])?$/i)
  if (!match) return false
  const expectedRanks = [match[1].toUpperCase(), match[2].toUpperCase()].sort()
  const actualRanks = actualExplicit.map(card => card[0]).sort()
  if (JSON.stringify(expectedRanks) !== JSON.stringify(actualRanks)) return false
  const suitedness = String(match[3] || '').toLowerCase()
  const sameSuit = actualExplicit[0][1] === actualExplicit[1][1]
  return !suitedness || (suitedness === 's' && sameSuit) || (suitedness === 'o' && !sameSuit)
}

function compareExpectedValue(fieldPath, expected, actualHand) {
  if (fieldPath.endsWith('SuitCounts')) {
    const sourcePath = fieldPath.slice(0, -'SuitCounts'.length)
    const cards = explicitHand(valueAtPath(actualHand, sourcePath))
    const actual = Object.fromEntries(Object.keys(expected || {}).map(suit => [
      suit,
      cards.filter(card => card[1] === suit.toLowerCase()).length
    ]))
    return { passed: sameValue(actual, expected || {}), actual }
  }
  if (fieldPath.endsWith('Ranks')) {
    const actual = cardRanks(valueAtPath(actualHand, fieldPath.slice(0, -'Ranks'.length)))
    return { passed: actual === expected, actual }
  }
  if (fieldPath.endsWith('.actionContains')) {
    const sourcePath = fieldPath.slice(0, -'.actionContains'.length) + '.actionLine'
    const actual = normalizedAction(valueAtPath(actualHand, sourcePath))
    const passed = (expected || []).every(token => actual.includes(normalizedAction(token)))
    return { passed, actual }
  }
  if (fieldPath.endsWith('.contains')) {
    const actual = valueAtPath(actualHand, fieldPath.slice(0, -'.contains'.length))
    const values = Array.isArray(actual) ? actual : []
    return { passed: (expected || []).every(item => values.includes(item)), actual: values }
  }
  const actual = valueAtPath(actualHand, fieldPath)
  if (fieldPath === 'heroCardsInput') return { passed: handCodesMatch(expected, actual), actual }
  if (expected === null) return { passed: actual === null || actual === undefined || actual === '' || actual === 0, actual }
  return { passed: sameValue(actual, expected), actual }
}

function evaluateExpectedHand(expected, actualHand) {
  const mismatches = Object.entries(expected || {}).flatMap(([fieldPath, expectedValue]) => {
    const result = compareExpectedValue(fieldPath, expectedValue, actualHand || {})
    return result.passed ? [] : [{ path: fieldPath, expected: expectedValue, actual: result.actual }]
  })
  const total = Object.keys(expected || {}).length
  return { total, passed: total - mismatches.length, mismatches }
}

function comparePipelineStages(agentHand, cloudHand, pageHand) {
  const agent = flattenDisplayFields(agentHand)
  const pokerReview = flattenDisplayFields(cloudHand)
  const page = flattenDisplayFields(pageHand)
  const fields = Object.keys(agent).map(field => {
    const cloudChanged = !sameValue(agent[field], pokerReview[field])
    const pageChanged = !sameValue(pokerReview[field], page[field])
    return {
      field,
      agent: agent[field],
      pokerReview: pokerReview[field],
      page: page[field],
      cloudChanged,
      pageChanged,
      restoredByPage: cloudChanged && pageChanged && sameValue(agent[field], page[field]),
      firstChangedAt: cloudChanged ? 'poker_review' : pageChanged ? 'page' : ''
    }
  })

  return {
    fields,
    changedAtPokerReview: fields.filter(item => item.firstChangedAt === 'poker_review').length,
    changedAtPage: fields.filter(item => item.firstChangedAt === 'page').length,
    changedByPage: fields.filter(item => item.pageChanged).length,
    restoredByPage: fields.filter(item => item.restoredByPage).length,
    unchanged: fields.filter(item => !item.firstChangedAt).length
  }
}

function loadReviewListHelpers() {
  const filePath = path.join(ROOT, 'pages', 'review-list', 'review-list.js')
  const code = fs.readFileSync(filePath, 'utf8') + `
module.exports.__pipelineTest = {
  normalizeParsedVoice,
  buildParsedVoicePreview
}
`
  const module = { exports: {} }
  const sandbox = {
    module,
    exports: module.exports,
    require(name) {
      if (name === '../../services/data-service') {
        return {
          getAppSettings() { return { voiceTerms: [] } },
          updateSettings() {}
        }
      }
      const dependencyMap = {
        '../../services/ai-service': path.join(ROOT, 'services', 'ai-service.js'),
        '../../utils/card-ui': path.join(ROOT, 'utils', 'card-ui.js'),
        '../../utils/tab-bar': path.join(ROOT, 'utils', 'tab-bar.js'),
        '../../utils/display': path.join(ROOT, 'utils', 'display.js'),
        '../../utils/review-tags': path.join(ROOT, 'utils', 'review-tags.js'),
        '../../utils/action-line': path.join(ROOT, 'utils', 'action-line.js'),
        '../../utils/hand-detail-fields': path.join(ROOT, 'utils', 'hand-detail-fields.js'),
        '../../utils/hand-replay': path.join(ROOT, 'utils', 'hand-replay.js'),
        '../../utils/onboarding-guide': path.join(ROOT, 'utils', 'onboarding-guide.js')
      }
      return require(dependencyMap[name] || name)
    },
    Page() {},
    wx: {
      getStorageSync() { return null },
      removeStorageSync() {},
      showToast() {},
      showModal() {},
      navigateTo() {}
    },
    console,
    setTimeout,
    clearTimeout
  }
  vm.runInNewContext(code, sandbox, { filename: filePath })
  return module.exports.__pipelineTest
}

let reviewListHelpers = null

function buildPagePreview(options) {
  const input = options || {}
  const cloudResult = input.cloudResult || {}
  if (!reviewListHelpers) reviewListHelpers = loadReviewListHelpers()
  const normalized = reviewListHelpers.normalizeParsedVoice(
    cloudResult.extractedHand || {},
    cloudResult,
    input.transcript || '',
    input.currentHand || {}
  )
  return reviewListHelpers.buildParsedVoicePreview(normalized, cloudResult)
}

function markdownValue(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return String(text === undefined ? '' : text)
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>') || '空'
}

function renderComparisonReport(cases) {
  const results = Array.isArray(cases) ? cases : []
  const totalCloudChanges = results.reduce((sum, item) => sum + item.comparison.changedAtPokerReview, 0)
  const totalPageChanges = results.reduce((sum, item) => sum + item.comparison.changedAtPage, 0)
  const lines = [
    '# 复盘完整链路对比报告',
    '',
    `- 测试手数：${results.length}`,
    `- 首次在 poker_review 发生变化的字段：${totalCloudChanges}`,
    `- 首次在页面发生变化的字段：${totalPageChanges}`,
    '',
    '> 判定方式：同一次线上云函数请求中读取 Agent 原始结果，再经过云函数返回结构和页面真实 helper，避免三次独立模型调用造成随机性干扰。',
    ''
  ]

  results.forEach((item, index) => {
    lines.push(`## ${index + 1}. ${item.name}`)
    lines.push('')
    lines.push('### 原始语音文本')
    lines.push('')
    lines.push(`> ${String(item.transcript || '').replace(/\r?\n/g, '<br>')}`)
    lines.push('')
    lines.push(`- Agent provider：${item.provider || '未知'}`)
    lines.push(`- 首次在 poker_review 变化：${item.comparison.changedAtPokerReview} 个字段`)
    lines.push(`- 首次在页面变化：${item.comparison.changedAtPage} 个字段`)
    lines.push('')
    lines.push('| 字段 | Agent 原始结果 | poker_review 返回 | 页面最终展示 | 首次变化节点 |')
    lines.push('|---|---|---|---|---|')
    item.comparison.fields.forEach(field => {
      lines.push(
        `| ${field.field} | ${markdownValue(field.agent)} | ${markdownValue(field.pokerReview)} | ${markdownValue(field.page)} | ${field.firstChangedAt || '未变化'} |`
      )
    })
    lines.push('')
    const changed = item.comparison.fields.filter(field => field.firstChangedAt)
    lines.push('### 发生变化的字段')
    lines.push('')
    if (!changed.length) {
      lines.push('- 三个节点的语义字段一致。')
    } else {
      changed.forEach(field => {
        lines.push(`- \`${field.field}\`：首次在 **${field.firstChangedAt}** 变化。`)
      })
    }
    lines.push('')
  })
  return lines.join('\n')
}

function invokePokerReview(event) {
  const call = childProcess.spawnSync(
    process.execPath,
    [CLOUDBASE_CLI, 'functions:invoke', 'poker_review', '--data', JSON.stringify(event), '--json'],
    {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 180000,
      maxBuffer: 20 * 1024 * 1024
    }
  )
  if (call.error) throw call.error
  if (call.status !== 0) {
    throw new Error(`poker_review invoke failed: ${call.stderr || call.stdout}`)
  }
  const jsonStart = call.stdout.indexOf('{')
  if (jsonStart < 0) throw new Error(`CloudBase did not return JSON: ${call.stdout}`)
  const envelope = JSON.parse(call.stdout.slice(jsonStart))
  const resultText = envelope.data && envelope.data.RetMsg
  if (!resultText) throw new Error('CloudBase response does not contain RetMsg')
  return {
    requestId: envelope.data.RequestId || envelope.data.FunctionRequestId || '',
    result: JSON.parse(resultText)
  }
}

function extractAgentHand(cloudResult) {
  const raw = cloudResult && cloudResult.raw || {}
  const agentResponse = raw.rawAgentResponse || raw.raw_agent_response || {}
  const data = agentResponse.data || {}
  return data.extractedHand || data.extracted_hand || agentResponse.extractedHand || agentResponse.extracted_hand || null
}

function defaultHand(values) {
  return Object.assign({
    playerCount: 8,
    playedDate: '2026/06/21',
    stakeLevel: '',
    hasStraddle: false,
    straddleAmount: 0,
    heroPosition: '',
    heroCardsInput: '',
    effectiveStack: 0,
    potSize: 0,
    currentProfit: 0,
    opponentType: '',
    opponentName: '',
    villainPosition: '',
    board: { flop: '', turn: '', river: '' },
    streetInputs: {}
  }, values || {})
}

const ONLINE_CASES = [
  {
    name: '200/400/800 straddle 多人底池',
    transcript: '这个牌是打的200400800，这时候桌上又来了一个鱼，然后这牌是Alex P open 2000，那条鱼在SB call，我在straddle call。翻牌发K83彩虹面，全部check到Alex P打了个半pot 3700，那个鱼也call 3700，我call。转牌掉个A，那个鱼check，我打了个8000，然后Alex P想了半天弃了，那个鱼call。河牌掉个7白板，那个鱼check给我，我打了个25000，他call。',
    hand: defaultHand({
      stakeLevel: '200/400',
      hasStraddle: true,
      straddleAmount: 800,
      heroPosition: 'STR',
      heroCardsInput: 'Ah8s',
      effectiveStack: 200000,
      currentProfit: 50000,
      opponentType: '鱼'
    }),
    session: { playerCount: 8, smallBlind: 200, bigBlind: 400, stakeLevel: '200/400' }
  },
  {
    name: '300/600 BB 防守 turn all-in',
    transcript: '10K这个牌是300600 utg+1，那个KKQJ。他open，然后fold到我大盲，我call。flop发A圈七彩虹，我有卡顺加买后门黑桃花。check打了个700，我check raise到2100。然后他再raise到3800，我靠，转牌掉个黑桃六。我check，锅里面是1万嘛，打了个15800，做了个overbet。但是我是觉得这边call太差了已经，我卡顺加买后门花，而且这个面明显是他有范围优势的面，他有可能借这个面去偷我。然后我直接check allin他了。然后他call，他是set 7，合牌发了一个方块2，没发出来。',
    hand: defaultHand({
      stakeLevel: '300/600',
      heroPosition: 'BB',
      heroCardsInput: 'TsKs',
      effectiveStack: 70000,
      currentProfit: -70000
    }),
    session: { playerCount: 8, smallBlind: 300, bigBlind: 600, stakeLevel: '300/600' }
  },
  {
    name: '500/1000 深筹码 cold 4Bet',
    transcript: '这手牌是5001000，我在BB，813在HJ位open到2500，button call，我cold 4bet到28000，他5B到66000，我KK直接6B allin，结果对方是AA。鲍比想了一下弃了，因为鲍比只有10万那时候；我觉得这个牌我有250个BB还是要推掉，而且我当时又想813可能觉得我在抢这个底池，就是受到上一手牌的影响；这牌后来我细想一下，其实应该直接弃掉是最好的。',
    hand: defaultHand({
      stakeLevel: '500/1000',
      heroPosition: 'BB',
      heroCardsInput: 'KsKh',
      effectiveStack: 250000,
      currentProfit: -250000
    }),
    session: { playerCount: 8, smallBlind: 500, bigBlind: 1000, stakeLevel: '500/1000' }
  }
]

function runOnlineCase(testCase, index) {
  const event = {
    mode: 'extract',
    transcript: testCase.transcript,
    userId: `pipeline-comparison-${Date.now()}-${index}`,
    playerId: `pipeline-comparison-${index}`,
    userTerms: testCase.corrections || [],
    hand: testCase.hand,
    session: testCase.session,
    actions: []
  }
  const invocation = invokePokerReview(event)
  const cloudResult = invocation.result
  if (cloudResult.code && cloudResult.code !== 0) {
    throw new Error(`poker_review returned ${cloudResult.code}: ${cloudResult.message || ''}`)
  }
  const agentHand = extractAgentHand(cloudResult)
  if (!agentHand) throw new Error('poker_review response does not expose the Agent structured result')
  const pageHand = buildPagePreview({
    transcript: testCase.transcript,
    currentHand: testCase.hand,
    cloudResult
  })
  return {
    name: testCase.name,
    transcript: testCase.transcript,
    provider: cloudResult.provider,
    requestId: invocation.requestId,
    agentHand,
    cloudHand: cloudResult.extractedHand,
    pageHand,
    comparison: comparePipelineStages(agentHand, cloudResult.extractedHand, pageHand)
  }
}

function runOnlineComparison() {
  const results = ONLINE_CASES.map((testCase, index) => {
    process.stdout.write(`[${index + 1}/${ONLINE_CASES.length}] ${testCase.name}\n`)
    return runOnlineCase(testCase, index)
  })
  const reportPath = path.join(ROOT, 'docs', 'review-pipeline-comparison-2026-06-21.md')
  fs.writeFileSync(reportPath, renderComparisonReport(results), 'utf8')
  process.stdout.write(`Report: ${reportPath}\n`)
  results.forEach(item => {
    process.stdout.write(
      `${item.name}: poker_review=${item.comparison.changedAtPokerReview}, page=${item.comparison.changedAtPage}\n`
    )
  })
  return results
}

function stageTotals(results, stage) {
  return results.reduce((totals, item) => {
    const evaluation = item.evaluations && item.evaluations[stage]
    if (!evaluation) return totals
    totals.total += evaluation.total
    totals.passed += evaluation.passed
    return totals
  }, { total: 0, passed: 0 })
}

function percentage(passed, total) {
  return total ? `${(passed * 100 / total).toFixed(2)}%` : '0.00%'
}

function renderConfirmedCorpusReport(report) {
  const source = report || {}
  const stages = source.stages || {}
  const agent = stages.agent || { passed: 0, total: 0 }
  const pokerReview = stages.pokerReview || { passed: 0, total: 0 }
  const page = stages.page || { passed: 0, total: 0 }
  const lines = [
    '# 已确认 20 手牌完整链路评测',
    '',
    `- 手牌数：${source.cases || 0}`,
    `- 确认字段数：${source.assertions || 0}`,
    `- 请求失败：${source.failedRequests || 0}`,
    `- Agent 原始输出：${agent.passed}/${agent.total}（${percentage(agent.passed, agent.total)}）`,
    `- poker_review 输出：${pokerReview.passed}/${pokerReview.total}（${percentage(pokerReview.passed, pokerReview.total)}）`,
    `- 页面最终展示：${page.passed}/${page.total}（${percentage(page.passed, page.total)}）`,
    `- 首次在 poker_review 改变的展示字段：${source.changedAtPokerReview || 0}`,
    `- 页面再次改写的展示字段：${source.changedByPage || 0}`,
    `- 页面恢复为 Agent 原值的展示字段：${source.restoredByPage || 0}`,
    '',
    '> 每手只发起一次线上 poker_review 请求。Agent、云函数和页面分数均来自同一次响应，避免模型随机性干扰节点对比。',
    ''
  ]

  ;(source.results || []).forEach((item, index) => {
    lines.push(`## ${index + 1}. ${item.title || item.id}`)
    lines.push('')
    lines.push(`- ID：${item.id}`)
    if (item.error) lines.push(`- 请求错误：${markdownValue(item.error)}`)
    const evaluations = item.evaluations || {}
    for (const [key, label] of [['agent', 'Agent'], ['pokerReview', 'poker_review'], ['page', '页面']]) {
      const evaluation = evaluations[key] || { passed: 0, total: 0, mismatches: [] }
      lines.push(`- ${label}：${evaluation.passed}/${evaluation.total}`)
    }
    if (item.comparison) {
      lines.push(`- 下游改写：poker_review ${item.comparison.changedAtPokerReview} 项，页面再次改写 ${item.comparison.changedByPage || 0} 项，其中恢复 Agent 原值 ${item.comparison.restoredByPage || 0} 项`)
    }
    lines.push('')
    lines.push('### 原始语音文本')
    lines.push('')
    lines.push(`> ${String(item.transcript || '').replace(/\r?\n/g, '<br>')}`)
    lines.push('')
    lines.push('### 具体错误')
    lines.push('')
    let mismatchCount = 0
    for (const [key, label] of [['agent', 'Agent'], ['pokerReview', 'poker_review'], ['page', '页面']]) {
      const mismatches = evaluations[key] && evaluations[key].mismatches || []
      mismatches.forEach(mismatch => {
        mismatchCount += 1
        lines.push(`- ${label} \`${mismatch.path}\`：期望 ${markdownValue(mismatch.expected)}；实际 ${markdownValue(mismatch.actual)}`)
      })
    }
    if (!mismatchCount) lines.push('- 三个阶段均符合已确认答案。')
    lines.push('')
  })
  return lines.join('\n')
}

function failedEvaluation(expected, error) {
  const mismatches = Object.entries(expected || {}).map(([fieldPath, expectedValue]) => ({
    path: fieldPath,
    expected: expectedValue,
    actual: null
  }))
  return { total: mismatches.length, passed: 0, mismatches, error: String(error || '') }
}

function buildCorpusCase(item) {
  const context = item.context || {}
  const hand = defaultHand(context.hand || {})
  return {
    name: item.title || item.id,
    transcript: item.transcript,
    hand,
    session: context.session || {},
    corrections: context.corrections || []
  }
}

function runConfirmedCorpusComparison(options) {
  const input = options || {}
  const pokerAgentRoot = input.pokerAgentRoot || process.env.POKER_AGENT_ROOT || 'C:/Users/11075/Documents/poker-agent'
  const fixturePath = input.fixturePath || path.join(pokerAgentRoot, 'backend', 'tests', 'fixtures', 'voice_extract_confirmed_corpus.json')
  const outputBase = input.outputBase || path.join(ROOT, 'docs', 'review-pipeline-confirmed-20-comparison-2026-06-21')
  const cases = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))
  const results = []

  cases.forEach((item, index) => {
    process.stdout.write(`[${index + 1}/${cases.length}] ${item.id} ${item.title || ''}\n`)
    try {
      const online = runOnlineCase(buildCorpusCase(item), index)
      results.push({
        id: item.id,
        title: item.title,
        transcript: item.transcript,
        requestId: online.requestId,
        provider: online.provider,
        error: '',
        evaluations: {
          agent: evaluateExpectedHand(item.expected, online.agentHand),
          pokerReview: evaluateExpectedHand(item.expected, online.cloudHand),
          page: evaluateExpectedHand(item.expected, online.pageHand)
        },
        comparison: online.comparison,
        actual: {
          agent: online.agentHand,
          pokerReview: online.cloudHand,
          page: online.pageHand
        }
      })
    } catch (error) {
      const evaluation = failedEvaluation(item.expected, error)
      results.push({
        id: item.id,
        title: item.title,
        transcript: item.transcript,
        error: String(error && error.message || error),
        evaluations: {
          agent: evaluation,
          pokerReview: evaluation,
          page: evaluation
        },
        comparison: null,
        actual: {}
      })
    }
  })

  const report = {
    generatedAt: new Date().toISOString(),
    fixturePath,
    cases: results.length,
    assertions: cases.reduce((sum, item) => sum + Object.keys(item.expected || {}).length, 0),
    failedRequests: results.filter(item => item.error).length,
    stages: {
      agent: stageTotals(results, 'agent'),
      pokerReview: stageTotals(results, 'pokerReview'),
      page: stageTotals(results, 'page')
    },
    changedAtPokerReview: results.reduce((sum, item) => sum + (item.comparison ? item.comparison.changedAtPokerReview : 0), 0),
    changedAtPage: results.reduce((sum, item) => sum + (item.comparison ? item.comparison.changedAtPage : 0), 0),
    changedByPage: results.reduce((sum, item) => sum + (item.comparison ? item.comparison.changedByPage : 0), 0),
    restoredByPage: results.reduce((sum, item) => sum + (item.comparison ? item.comparison.restoredByPage : 0), 0),
    results
  }
  fs.writeFileSync(`${outputBase}.json`, JSON.stringify(report, null, 2) + '\n', 'utf8')
  fs.writeFileSync(`${outputBase}.md`, renderConfirmedCorpusReport(report), 'utf8')
  process.stdout.write(`JSON: ${outputBase}.json\nReport: ${outputBase}.md\n`)
  for (const [key, label] of [['agent', 'Agent'], ['pokerReview', 'poker_review'], ['page', 'Page']]) {
    const stage = report.stages[key]
    process.stdout.write(`${label}: ${stage.passed}/${stage.total} (${percentage(stage.passed, stage.total)})\n`)
  }
  return report
}

module.exports = {
  STREETS,
  flattenDisplayFields,
  comparePipelineStages,
  buildPagePreview,
  renderComparisonReport,
  evaluateExpectedHand,
  renderConfirmedCorpusReport,
  extractAgentHand,
  runOnlineCase,
  runOnlineComparison,
  runConfirmedCorpusComparison
}

if (require.main === module) {
  try {
    if (process.argv.includes('--corpus')) runConfirmedCorpusComparison()
    else runOnlineComparison()
  } catch (error) {
    process.stderr.write(`${error && error.stack || error}\n`)
    process.exitCode = 1
  }
}
