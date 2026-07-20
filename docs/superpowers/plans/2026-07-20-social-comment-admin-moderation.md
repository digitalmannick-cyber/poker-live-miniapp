# 管理员评论处置 Implementation Plan

**Goal:** 在不增加牌谱检测、牌谱举报或评论举报入口的前提下，实现由服务端 OpenID 白名单控制的评论软删除、审计记录和前端固定原因处置交互。

**Architecture:** 云函数入口解析 `SOCIAL_ADMIN_OPENIDS` 并向业务层注入纯鉴权函数；读取手牌详情仅返回布尔能力位，真正写操作必须再次按本次微信上下文 OpenID 鉴权。管理员删除复用社交幂等事务，评论计数只递减一次，并在同一事务写入私有审计记录。账号清除对审计记录做不可逆角色脱敏。

**Tech Stack:** 原生微信小程序、Node.js 云函数、CloudBase 数据库事务、`node:test`、微信开发者工具。

## Global Constraints

- 管理员只由服务端环境变量中的微信 OpenID 定义；客户端字段、昵称、头像、玩家 ID 和缓存均不参与鉴权。
- 环境变量缺失、为空或格式异常时按“无人是管理员”处理，所有管理员写操作 fail closed。
- 牌谱发布本身不检测、不举报；评论不提供举报入口，所有登录用户仍可评论。
- 评论作者只能删除自己的评论；手牌发布者不能因此删除他人评论；管理员可以删除任意未删除评论。
- 管理员删除为软删除，固定显示“该评论已被管理员移除”；重复请求不得重复减计数或重复写审计。
- 审计集合不允许客户端直接读写，不保存原始 OpenID；账号清除后不得保留可反查身份的关联字段。

---

### Task 1: 服务端管理员鉴权、能力位与删除事务

**Files:**
- Modify: `cloudfunctions/poker_social/index.js`
- Modify: `cloudfunctions/poker_social/app.js`
- Modify: `cloudfunctions/poker_social/lib/hand-feed.js`
- Modify: `cloudfunctions/poker_social/lib/interaction.js`
- Test: `tests/social-interaction-cloud.test.js`
- Test: `tests/social-hand-feed-cloud.test.js`
- Test: `tests/social-security-matrix.test.js`

- [x] 先补环境变量解析、能力位白名单、非管理员拒绝、固定原因校验、幂等冲突、计数一次性递减、撤回分享残留评论处置和审计一次性写入测试，并确认 RED。
- [x] 实现 `admin_delete_comment`，只接受 `commentId/reason/clientMutationId`，原因仅允许 `spam/abuse/privacy/illegal/other`。
- [x] `get_hand_share` 增加 `canModerateComments` 布尔字段，不暴露管理员名单或 OpenID。
- [x] 作者删除写入 `deletionKind: 'author'`；管理员删除写入 `deletionKind: 'admin'` 与 `moderationReason`；DTO 对旧数据保持兼容。
- [x] 运行聚焦测试、语法检查和社交安全矩阵。

### Task 2: 审计集合、账号清除、安全规则与索引

**Files:**
- Modify: `cloudfunctions/poker_social/lib/repository.js`
- Modify: `cloudfunctions/poker_social/lib/account-clear.js`
- Modify: `cloudfunctions/poker_social/database-security-rules.json`
- Modify: `cloudfunctions/poker_social/database-indexes.json`
- Modify: `cloudfunctions/poker_social/database-indexes.md`
- Test: `tests/social-account-clear.test.js`
- Test: `tests/social-database-deployment-contract.test.js`

- [x] 先补审计私有规则、确定性审计 ID、两种角色脱敏、重复清除收敛和所需查询索引测试，并确认 RED。
- [x] 新增 `social_moderation_audits` 事务写入和账号清除查询/更新能力。
- [x] 清除被处置者时清空目标关联；清除管理员时清空处置者关联；同一人兼具两种角色时两边均脱敏。
- [x] 将两个清除查询索引加入部署清单，并更新运维说明。
- [x] 运行账号清除、部署契约和全体社交后端测试。

### Task 3: 客户端服务与手牌详情处置交互

**Files:**
- Modify: `services/social-service.js`
- Modify: `pages/social-hand-detail/social-hand-detail.js`
- Modify: `pages/social-hand-detail/social-hand-detail.wxml`
- Modify: `pages/social-hand-detail/social-hand-detail.wxss`
- Test: `tests/social-interaction-service.test.js`
- Test: `tests/social-hand-detail-page.test.js`

- [x] 先补服务参数、权限显示、本人评论去重、固定原因 ActionSheet、取消不请求、失败恢复、账号切换/卸载过期响应测试，并确认 RED。
- [x] 增加 `adminDeleteComment` 服务方法，复用稳定 mutation ID 和现有重试语义。
- [x] 仅在 `canModerateComments` 且目标为他人未删除评论时显示“移除”；管理员自己的评论仍只显示普通删除。
- [x] 选择固定原因后调用管理员接口；成功后使用严格 DTO 更新评论和计数，失败不伪造本地成功。
- [x] 运行页面、服务、统一动态和账号生命周期回归测试。

### Task 4: 全量验证与真实环境交付门槛

- [x] 运行全部相关 `social-*.test.js`、完整串行测试、语法检查、敏感字段扫描与工作树差异审查。
- [x] 已知基线异常单独复测并保持范围不扩散：隔离 worktree 缺少私有预览配置；版本号与旧发布海报不一致。
- [x] 从本次提交的真实代码工作树执行微信开发者工具 `auto-preview`，只预览不上传开发版本。
- [x] 输出真实环境部署清单：配置 `SOCIAL_ADMIN_OPENIDS`、部署云函数/规则/索引、使用管理员与普通用户双账号验证。
- [x] 未获得明确授权前，不修改真实云环境、不部署云函数、不上传版本。
