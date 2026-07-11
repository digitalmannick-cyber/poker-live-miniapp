# 小程序全面代码检测与修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在备份基线 `c5babed` 上建立可复现的全量质量基线，定位并修复有证据的缺陷，并完成自动化与微信开发者工具回归。

**Architecture:** 检测与修复分离。Codex 维护基线报告、失败证据和最终复核；Claude 可提交业务修复，但每个修复必须对应独立缺陷、独立测试和独立提交。未知缺陷不预设实现，确认根因后为该缺陷追加精确的红—绿步骤。

**Tech Stack:** 微信小程序、CommonJS JavaScript、Node.js 内置测试/断言能力、PowerShell、微信开发者工具 CLI、Git。

## Global Constraints

- 备份标签 `backup/pre-full-audit-2026-07-12` 和提交 `c5babed` 不得移动或改写。
- 不自动上传开发版本，不部署云函数，不修改真实云数据。
- Agent/backend 的结构化字段是复盘语义真源；小程序端不得新增语义解析或兜底。
- 每个缺陷先取得稳定复现或确定性静态证据，再修改根因。
- 每类独立缺陷使用独立提交，不混入无关格式化、重构或资源更新。
- 全量测试不得通过删除测试、弱化断言或跳过失败来变绿。

---

### Task 1: 建立自动化基线

**Files:**
- Create: `docs/audits/2026-07-12-baseline.md`
- Inspect: `tests/*.test.js`
- Inspect: `app.json`
- Inspect: `pages/**/*.json`
- Inspect: `components/**/*.json`

**Interfaces:**
- Consumes: 基线提交 `c5babed` 上的源代码和测试。
- Produces: 逐测试结果、语法检查结果、JSON/路由检查结果以及原始失败命令。

- [ ] **Step 1:** 记录 `git status --short --branch`、`node --version` 和测试文件数量到基线报告。
- [ ] **Step 2:** 逐个执行 `tests/*.test.js`，为每个文件记录退出码；命令使用 `Get-ChildItem tests -Filter '*.test.js' | Sort-Object Name`，不得在首个失败后停止。
- [ ] **Step 3:** 对仓库内排除 `.git` 后的 `*.js` 执行 `node --check`，逐个记录失败文件与错误原文。
- [ ] **Step 4:** 对 `app.json`、页面 JSON、组件 JSON、`project.config.json` 和 `cloudbaserc.json` 执行 `ConvertFrom-Json`，记录解析失败。
- [ ] **Step 5:** 从 `app.json.pages` 和 `usingComponents` 提取本地路径，核对对应 `.js/.json/.wxml/.wxss` 或组件目录是否存在。
- [ ] **Step 6:** 提交只包含基线报告的提交：`git commit -m "test: record full audit baseline"`。

### Task 2: 按风险审计核心数据流

**Files:**
- Modify: `docs/audits/2026-07-12-baseline.md`
- Inspect: `utils/store.js`
- Inspect: `services/data-service.js`
- Inspect: `services/cloud-repo.js`
- Inspect: `services/cloud-data-api.js`
- Inspect: `cloudfunctions/poker_data/**/*.js`
- Inspect: `pages/hand-record/hand-record.js`
- Inspect: `pages/hand-ledger-input/hand-ledger-input.js`
- Inspect: `pages/session-list/session-list.js`
- Inspect: `pages/session-detail/session-detail.js`
- Inspect: `pages/review-list/review-list.js`
- Inspect: `pages/hand-detail/hand-detail.js`
- Inspect: `pages/stats/stats.js`
- Inspect: `utils/stats-analytics.js`

**Interfaces:**
- Consumes: Task 1 的失败清单与当前源代码。
- Produces: 带编号、P0–P3 级别、影响、证据、根因假设和验证命令的候选缺陷。

- [ ] **Step 1:** 从写入入口向后追踪 session、hand、settings、stats 的本地和云端字段，列出默认值、数值转换和用户隔离差异。
- [ ] **Step 2:** 检查 `Number(...)`、`parseInt(...)`、`parseFloat(...)`、金额/时长加法和空值回退，确认 `NaN`、`Infinity`、空字符串及旧数据行为。
- [ ] **Step 3:** 检查 create/update/delete/import/export 的失败路径，确认失败不会先破坏本地真值或吞掉云端错误。
- [ ] **Step 4:** 检查录入、会话、复盘和统计对同一字段的命名与口径；任何差异必须附调用链和样例数据。
- [ ] **Step 5:** 检查小程序是否重新解析 Agent 结构化字段；发现边界违规时记录调用链，不在前端增加替代解析器。
- [ ] **Step 6:** 将只能猜测产品语义的问题放入“待确认观察项”，把可稳定证明的问题放入“确认缺陷”。
- [ ] **Step 7:** 提交审计记录：`git commit -m "docs: record core data-flow audit findings"`。

### Task 3: 逐缺陷执行独立红—绿修复

**Files:**
- Modify: 仅限每个确认缺陷根因涉及的源文件。
- Test: `tests/<defect-specific-name>.test.js` 或最接近的现有测试文件。
- Modify: `docs/audits/2026-07-12-baseline.md`

**Interfaces:**
- Consumes: Task 2 中有稳定证据的单个确认缺陷。
- Produces: 一个可独立审阅的修复提交、一个能证明回归的测试、更新后的缺陷状态。

- [ ] **Step 1:** 在审计报告写下单一根因假设：“`<source>` 产生 `<bad value/state>`，经 `<call path>` 导致 `<observable failure>`”。
- [ ] **Step 2:** 在最接近责任边界的测试文件新增最小输入与明确断言，并运行该文件确认测试因目标缺陷失败。
- [ ] **Step 3:** 只修改产生错误值或状态的根因；不同时清理相邻代码。
- [ ] **Step 4:** 运行聚焦测试，确认新增断言通过。
- [ ] **Step 5:** 临时反向验证测试有效性：用 `git diff` 保存修复补丁，撤销源文件修复但保留测试，确认测试重新失败；随后恢复修复补丁并确认测试通过。
- [ ] **Step 6:** 运行相邻模块测试并记录命令、通过数和失败数。
- [ ] **Step 7:** 更新缺陷记录的修复文件、测试和剩余风险。
- [ ] **Step 8:** 使用与缺陷对应的 `fix:` 或 `refactor:` message 创建独立提交。
- [ ] **Step 9:** 对下一个确认缺陷重新从 Step 1 开始；不得把两个根因合并为一次修改。

### Task 4: 全量回归和真实工作区预览

**Files:**
- Modify: `docs/audits/2026-07-12-baseline.md`
- Inspect: `tools/auto-preview.ps1`
- Inspect: `project.config.json`

**Interfaces:**
- Consumes: 所有独立修复提交和 Task 1 的基线结果。
- Produces: 最终全量测试对比、语法/配置复查、预览结果和包体证据。

- [ ] **Step 1:** 重新逐个执行全部 `tests/*.test.js`，记录通过、失败和与基线相比的变化。
- [ ] **Step 2:** 重新执行全部业务 JavaScript 的 `node --check` 和 JSON/路由检查，确认没有新增失败。
- [ ] **Step 3:** 运行 `powershell -ExecutionPolicy Bypass -File tools/auto-preview.ps1 -ProjectRoot <当前真实工作树绝对路径>`，保存退出码、CLI 原始错误或成功信息及包体大小。
- [ ] **Step 4:** 在预览中烟雾检查启动、会话列表、快速录入、完整录入、复盘、详情、统计、玩家笔记和设置；只用演示或本地数据。
- [ ] **Step 5:** 检查 `git diff backup/pre-full-audit-2026-07-12...HEAD --stat` 和逐提交文件范围，移除无关改动。
- [ ] **Step 6:** 更新报告，明确区分已修复、测试覆盖、观察项、环境阻塞和未验证项。
- [ ] **Step 7:** 提交最终报告：`git commit -m "docs: finalize full audit verification report"`。
- [ ] **Step 8:** 经用户确认后再推送修复分支；不自动创建 PR、不上传小程序开发版本。
