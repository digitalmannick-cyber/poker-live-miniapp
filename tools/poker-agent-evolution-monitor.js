const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const REPORT_PATH = path.join(ROOT, 'docs', 'poker-agent-evolution-monitor.md')

const SOURCES = [
  'utils/voice-parser.js',
  'utils/ai-normalizer.js',
  'cloudfunctions/poker_review/index.js',
  'pages/review-list/review-list.js',
  'tests/voice-parser.test.js',
  'tests/ai-normalizer.test.js',
  'tests/poker-review-stake-normalize.test.js',
  'tests/poker-agent-two-stage.test.js',
  'tests/review-agent-advice.test.js',
  'tests/review-missing-field-ux.test.js',
  'docs/superpowers/specs/2026-05-15-voice-review-ai-design.md'
]

const SIGNALS = [
  { key: 'voice_terms', label: '用户口语/方言/个人说法', patterns: ['applyUserTerms', 'extractExplicitTermDefinitions', 'voiceTerms', 'corrections'] },
  { key: 'street_actions', label: '逐街行动线抽取', patterns: ['streetInputs', 'actionLine', 'preflop', 'flop', 'turn', 'river'] },
  { key: 'pot_math', label: '逐街 pot 计算/校验', patterns: ['normalizeStreetPotFlow', 'getStreetContribution', 'estimateStreetPot', 'uncalled', 'potSize'] },
  { key: 'board_cards', label: '公牌/手牌纠错与补花色', patterns: ['boardText', 'inferBoardText', 'assignGeneratedSuits', 'duplicate', 'river'] },
  { key: 'agent_flow', label: 'Agent 两阶段流程', patterns: ["mode: 'extract'", "mode: 'advice'", 'EV脑', 'poker-agent', 'rawAgentResponse'] },
  { key: 'missing_fields', label: '缺失字段追问/中文化', patterns: ['missingFields', 'followUpQuestions', 'MISSING_FIELD_META', 'focusMissingField'] },
  { key: 'training', label: 'AI 建议/训练计划/漏洞标签', patterns: ['trainingPlan', 'leakTags', 'aiReview', 'advice'] }
]

const CANDIDATES = [
  {
    priority: 'P0',
    target: 'EV脑',
    title: '语音复盘口语词典和用户私有记忆',
    evidence: ['applyUserTerms', 'extractExplicitTermDefinitions', 'corrections', 'userId/playerId'],
    reason: '用户反复纠正的个人说法、方言、口头禅应按 user_id 存进 Agent 私有记忆，提高下一次字段抽取准确率。',
    action: '在 Agent 增加 user memory 写入/读取规范：保存 from/to/type/source/updatedAt，抽取前先应用用户私有词典。'
  },
  {
    priority: 'P0',
    target: 'EV脑',
    title: '德扑语音字段抽取 schema',
    evidence: ['extractedHand', 'streetInputs', 'board', 'missingFields'],
    reason: 'Agent 应稳定输出小程序可消费的统一 JSON，尤其是逐街行动线、对手位置、有效筹码、桌型、输赢。',
    action: '把 extractedHand schema 和字段别名表放进 Agent 的结构化输出工具或 prompt 模板。'
  },
  {
    priority: 'P0',
    target: 'EV脑',
    title: '常见语音误识别规则',
    evidence: ['勾八四彩虹 -> J84', '7到他大盲 -> 弃到他大盲', '1万2 -> 12000'],
    reason: '这些是语义识别层问题，Agent 应先理解，再交给小程序做确定性校验。',
    action: '新增 Agent 公共解析知识：中文牌面别名、筹码金额中文单位、弃到/fold to 的误识别模式。'
  },
  {
    priority: 'P1',
    target: 'EV脑',
    title: '行动线语义抽取',
    evidence: ['open', '3B', '4B', 'call', 'fold', 'cbet', 'donk'],
    reason: 'Agent 更适合理解自然语言动作、角色和街道边界，并输出结构化 actions。',
    action: '让 Agent 输出 normalized_actions：street/actor/action/amount/called/foldedTo。'
  },
  {
    priority: 'P1',
    target: 'Miniapp',
    title: 'pot 计算作为小程序最终准绳',
    evidence: ['normalizeStreetPotFlow', 'post process excludes an uncalled bet'],
    reason: 'pot 是确定性业务计算，影响保存和统计。Agent 可给估算，小程序必须复算和校验。',
    action: '保留 miniapp ai-normalizer 的 pot flow；未来可把同一算法抽成共享库供 Agent 复用。'
  },
  {
    priority: 'P1',
    target: 'Miniapp',
    title: '重复牌、未到 river 不补 river',
    evidence: ['removes duplicate exact cards', 'clears AI river when speech never reaches river'],
    reason: '这是数据合法性和展示规则，小程序必须兜底，避免错误入库。',
    action: '继续放在小程序 postProcess；Agent 可学习该原则但不能作为唯一校验。'
  },
  {
    priority: 'P2',
    target: 'EV脑',
    title: '复盘建议模板和针对性训练',
    evidence: ['trainingPlan', 'leakTags', 'aiReview'],
    reason: '用户要求建议包括打得好/不好/可优化/明显错误/针对性训练，这属于 Agent 的核心能力。',
    action: '在 Agent advice 模式固定输出 verdict/good/bad/errors/optimizations/training_plan/leak_tags。'
  },
  {
    priority: 'P2',
    target: 'Miniapp',
    title: '缺失字段中文化和定点补充交互',
    evidence: ['MISSING_FIELD_META', 'focusMissingField'],
    reason: '这是产品交互，不应进入 Agent。Agent 只返回缺失字段 key 和原因。',
    action: '小程序继续负责中文标签、点击跳转输入框、预设选择器。'
  }
]

function readSource(relativePath) {
  const absolute = path.join(ROOT, relativePath)
  if (!fs.existsSync(absolute)) return ''
  return fs.readFileSync(absolute, 'utf8')
}

function countPattern(source, pattern) {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return (source.match(new RegExp(escaped, 'g')) || []).length
}

function collectSignals() {
  const files = SOURCES.map(file => ({ file, source: readSource(file) }))
  return SIGNALS.map(signal => {
    const hits = files
      .map(item => {
        const count = signal.patterns.reduce((sum, pattern) => sum + countPattern(item.source, pattern), 0)
        return count ? { file: item.file, count } : null
      })
      .filter(Boolean)
      .sort((a, b) => b.count - a.count)
    return Object.assign({}, signal, { hits })
  })
}

function renderReport() {
  const signals = collectSignals()
  const date = new Date().toISOString().slice(0, 10)
  const lines = [
    '# EV脑 进化监控',
    '',
    `生成日期：${date}`,
    '',
    '这份报告用于从小程序代码、测试和设计文档里识别哪些内容适合反哺 EV脑。它不直接修改 Agent，只给出待确认清单。',
    '',
    '## 当前信号',
    ''
  ]

  signals.forEach(signal => {
    lines.push(`### ${signal.label}`)
    if (!signal.hits.length) {
      lines.push('- 未发现明显信号。')
    } else {
      signal.hits.slice(0, 6).forEach(hit => {
        lines.push(`- ${hit.file}: ${hit.count}`)
      })
    }
    lines.push('')
  })

  lines.push('## 待你确认是否写入 EV脑')
  lines.push('')
  CANDIDATES.filter(item => item.target === 'EV脑').forEach(item => {
    lines.push(`### ${item.priority} ${item.title}`)
    lines.push(`- 归属：${item.target}`)
    lines.push(`- 证据：${item.evidence.join('；')}`)
    lines.push(`- 原因：${item.reason}`)
    lines.push(`- 建议动作：${item.action}`)
    lines.push('')
  })

  lines.push('## 应保留在小程序侧')
  lines.push('')
  CANDIDATES.filter(item => item.target === 'Miniapp').forEach(item => {
    lines.push(`### ${item.priority} ${item.title}`)
    lines.push(`- 归属：${item.target}`)
    lines.push(`- 证据：${item.evidence.join('；')}`)
    lines.push(`- 原因：${item.reason}`)
    lines.push(`- 建议动作：${item.action}`)
    lines.push('')
  })

  lines.push('## 推荐监控规则')
  lines.push('')
  lines.push('- 每次新增语音解析测试、AI 回填规则、用户纠错入口时，运行 `node tools/poker-agent-evolution-monitor.js`。')
  lines.push('- P0/P1 且归属 EV脑 的内容，先让你确认，再写入 Agent 的公共知识或 user memory 逻辑。')
  lines.push('- 任何用户真实牌局、对手名字、个人习惯，只能按 `user_id` 写入私有记忆，不进入公共知识。')
  lines.push('- pot 数学、重复牌校验、页面交互保持小程序为最终准绳；Agent 可以复用算法，但不能替代小程序校验。')
  lines.push('')

  return lines.join('\n')
}

function main() {
  const report = renderReport()
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true })
  fs.writeFileSync(REPORT_PATH, report, 'utf8')
  console.log(`wrote ${path.relative(ROOT, REPORT_PATH)}`)
}

if (require.main === module) {
  main()
}

module.exports = {
  collectSignals,
  renderReport,
  CANDIDATES
}
