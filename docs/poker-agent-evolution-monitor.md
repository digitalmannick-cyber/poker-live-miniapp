# EV脑 进化监控

生成日期：2026-06-08

这份报告用于从小程序代码、测试和设计文档里识别哪些内容适合反哺 EV脑。它不直接修改 Agent，只给出待确认清单。

## 当前信号

### 用户口语/方言/个人说法
- pages/review-list/review-list.js: 9
- cloudfunctions/poker_review/index.js: 8
- utils/ai-normalizer.js: 4
- tests/ai-normalizer.test.js: 2
- tests/poker-agent-two-stage.test.js: 2

### 逐街行动线抽取
- pages/review-list/review-list.js: 329
- cloudfunctions/poker_review/index.js: 272
- utils/voice-parser.js: 241
- utils/ai-normalizer.js: 215
- tests/ai-normalizer.test.js: 158
- tests/voice-parser.test.js: 68

### 逐街 pot 计算/校验
- cloudfunctions/poker_review/index.js: 21
- pages/review-list/review-list.js: 12
- utils/voice-parser.js: 10
- utils/ai-normalizer.js: 10
- tests/ai-normalizer.test.js: 7
- tests/voice-parser.test.js: 4

### 公牌/手牌纠错与补花色
- utils/voice-parser.js: 51
- tests/ai-normalizer.test.js: 38
- utils/ai-normalizer.js: 36
- cloudfunctions/poker_review/index.js: 33
- pages/review-list/review-list.js: 32
- tests/voice-parser.test.js: 12

### Agent 两阶段流程
- cloudfunctions/poker_review/index.js: 10
- pages/review-list/review-list.js: 6
- tests/poker-agent-two-stage.test.js: 2
- tests/review-agent-advice.test.js: 1

### 缺失字段追问/中文化
- pages/review-list/review-list.js: 51
- cloudfunctions/poker_review/index.js: 33
- tests/ai-normalizer.test.js: 12
- utils/voice-parser.js: 8
- utils/ai-normalizer.js: 4
- tests/review-missing-field-ux.test.js: 3

### AI 建议/训练计划/漏洞标签
- pages/review-list/review-list.js: 46
- cloudfunctions/poker_review/index.js: 13
- tests/review-agent-advice.test.js: 13
- tests/poker-agent-two-stage.test.js: 5
- docs/superpowers/specs/2026-05-15-voice-review-ai-design.md: 2

## 待你确认是否写入 EV脑

### P0 语音复盘口语词典和用户私有记忆
- 归属：EV脑
- 证据：applyUserTerms；extractExplicitTermDefinitions；corrections；userId/playerId
- 原因：用户反复纠正的个人说法、方言、口头禅应按 user_id 存进 Agent 私有记忆，提高下一次字段抽取准确率。
- 建议动作：在 Agent 增加 user memory 写入/读取规范：保存 from/to/type/source/updatedAt，抽取前先应用用户私有词典。

### P0 德扑语音字段抽取 schema
- 归属：EV脑
- 证据：extractedHand；streetInputs；board；missingFields
- 原因：Agent 应稳定输出小程序可消费的统一 JSON，尤其是逐街行动线、对手位置、有效筹码、桌型、输赢。
- 建议动作：把 extractedHand schema 和字段别名表放进 Agent 的结构化输出工具或 prompt 模板。

### P0 常见语音误识别规则
- 归属：EV脑
- 证据：勾八四彩虹 -> J84；7到他大盲 -> 弃到他大盲；1万2 -> 12000
- 原因：这些是语义识别层问题，Agent 应先理解，再交给小程序做确定性校验。
- 建议动作：新增 Agent 公共解析知识：中文牌面别名、筹码金额中文单位、弃到/fold to 的误识别模式。

### P1 行动线语义抽取
- 归属：EV脑
- 证据：open；3B；4B；call；fold；cbet；donk
- 原因：Agent 更适合理解自然语言动作、角色和街道边界，并输出结构化 actions。
- 建议动作：让 Agent 输出 normalized_actions：street/actor/action/amount/called/foldedTo。

### P2 复盘建议模板和针对性训练
- 归属：EV脑
- 证据：trainingPlan；leakTags；aiReview
- 原因：用户要求建议包括打得好/不好/可优化/明显错误/针对性训练，这属于 Agent 的核心能力。
- 建议动作：在 Agent advice 模式固定输出 verdict/good/bad/errors/optimizations/training_plan/leak_tags。

## 应保留在小程序侧

### P1 pot 计算作为小程序最终准绳
- 归属：Miniapp
- 证据：normalizeStreetPotFlow；post process excludes an uncalled bet
- 原因：pot 是确定性业务计算，影响保存和统计。Agent 可给估算，小程序必须复算和校验。
- 建议动作：保留 miniapp ai-normalizer 的 pot flow；未来可把同一算法抽成共享库供 Agent 复用。

### P1 重复牌、未到 river 不补 river
- 归属：Miniapp
- 证据：removes duplicate exact cards；clears AI river when speech never reaches river
- 原因：这是数据合法性和展示规则，小程序必须兜底，避免错误入库。
- 建议动作：继续放在小程序 postProcess；Agent 可学习该原则但不能作为唯一校验。

### P2 缺失字段中文化和定点补充交互
- 归属：Miniapp
- 证据：MISSING_FIELD_META；focusMissingField
- 原因：这是产品交互，不应进入 Agent。Agent 只返回缺失字段 key 和原因。
- 建议动作：小程序继续负责中文标签、点击跳转输入框、预设选择器。

## 推荐监控规则

- 每次新增语音解析测试、AI 回填规则、用户纠错入口时，运行 `node tools/poker-agent-evolution-monitor.js`。
- P0/P1 且归属 EV脑 的内容，先让你确认，再写入 Agent 的公共知识或 user memory 逻辑。
- 任何用户真实牌局、对手名字、个人习惯，只能按 `user_id` 写入私有记忆，不进入公共知识。
- pot 数学、重复牌校验、页面交互保持小程序为最终准绳；Agent 可以复用算法，但不能替代小程序校验。
