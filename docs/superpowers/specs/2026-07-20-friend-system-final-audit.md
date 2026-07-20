# 好友系统最终需求审计

## 审计口径

本记录以 `2026-07-19-friend-system-requirements.md` 第 16、17 节、好友系统设计文档、四份实施计划和管理员评论处置补充设计为范围。自动化、云端回读、模拟器预览和多账号真机属于四种不同证据，不互相替代。

## 需求到证据映射

| 需求域 | 当前实现 | 自动化与静态证据 | 真实环境证据 | 结论 |
| --- | --- | --- | --- | --- |
| 导航与入口 | 玩家页保留“好友 / 玩家库”，好友区包含“动态 / 好友 / 排行榜”，消息入口、未读状态和隐私入口已接入 | `social-player-hub.test.js`、`social-tab-unread.test.js`、`social-message-center.test.js` | 真实工作区预览已看到五栏底部导航及玩家页三级入口 | 已实现；多账号内容态待验 |
| 好友申请与解除 | 微信邀请卡片、小程序码、申请确认、拒绝、七天冷却、解除关系与旧权限失效均由云端事务处理 | `social-invite-page.test.js`、`social-friendship.test.js`、`social-foundation-security.test.js` | 云函数与索引已部署 | 代码与云资源已实现；真实双方操作待验 |
| 好友详情与本地资料 | 复用玩家详情；本地头像、备注名、类型、Leak、Note、对战手牌保持当前账号私有；额外显示称号、时长和手数 | `social-friend-detail.test.js`、`social-friend-player-note*.test.js`、`social-profile-ranking-security.test.js` | 玩家页真实预览已加载 | 已实现；好友双方数据态待验 |
| 排行榜 | 本周、本月、累计；有效分钟数、并列名次、Top 10 和榜外本人；关闭统计后退出排行 | `social-ranking.test.js`、`social-ranking-ui.test.js`、`social-stats-sync.test.js` | 索引已部署 | 已实现；真实好友样本待验 |
| 手牌发布与范围 | 广场、全部好友、指定好友三种互斥范围；默认全部好友；支持变更范围、撤回与原手牌删除级联撤回 | `social-hand-publish-page.test.js`、`social-hand-share-policy.test.js`、`social-share-management-ui.test.js`、`social-delete-cascade.test.js` | 云函数与集合已部署 | 已实现；多身份可见性待验 |
| BB 化与匿名 | 云端从私有原手牌生成白名单快照；金额统一 BB；Hero 固定，其他玩家使用稳定原创代号；未摊牌底牌不输出 | `social-hand-snapshot.test.js`、`social-hand-snapshot-security.test.js`、`social-security-matrix.test.js` | 云函数代码摘要已回读 | 已实现 |
| 评论、回复、贴纸、点赞 | 文字、Emoji、单张内置贴纸、一层回复、本人删除、唯一有效点赞和范围变化后的权限失效 | `social-comments.test.js`、`social-likes.test.js`、`social-interaction-service.test.js`、`social-interaction-ui.test.js` | 云函数与索引已部署 | 已实现；多身份互动待验 |
| 管理员评论处置 | 环境白名单定义管理员；固定原因软删除；普通删除与管理员移除互斥；审计、幂等、账号清除脱敏 | `social-admin-policy.test.js`、`social-comment-moderation.test.js`、`social-account-clear.test.js` | 管理员白名单已启用且仅一个已确认账号 | 已实现；管理员/普通账号差异待验 |
| 玩家名片 | 一张名片只发给一位指定好友；仅五类字段；站内消息送达；七天失效；预览后手动新建或整体覆盖；已导入副本独立 | `social-player-card*.test.js`、`social-card-message-security.test.js` | 云函数与集合已部署 | 已实现；真实接收与导入待验 |
| 消息中心 | 好友申请、通过、定向手牌、评论、回复、点赞、名片消息；失效目标明确；缓存按账号隔离 | `social-message-center.test.js`、`social-notifications.test.js`、`social-offline-cache.test.js` | 玩家页真实预览已显示消息入口 | 已实现；多账号送达待验 |
| 离线、错误和核心业务隔离 | 社交失败不伪造成功，不阻塞场次、手牌、玩家库或统计写入；只允许安全首屏缓存；首次资料同步失败可原地重试 | `social-offline-cache.test.js`、`social-feed-cache.test.js`、`social-profile-sync.test.js`、`social-player-hub.test.js` 及整项目回归 | 在真实网络超时时已显示明确失败与“重试”，场次页仍正常 | 已实现并验证真实错误态 |
| 数据安全与账号清除 | 客户端不可直接读写社交集合；OpenID 与私有字段不进入 DTO；清除任务分批、幂等并脱敏审计 | `social-database-deployment-contract.test.js`、`social-security-matrix.test.js`、`social-account-clear.test.js` | 20 个受管集合均为 `ADMINONLY`，31 个索引完整 | 已实现 |

## 已完成的总体验证

- 整项目串行测试：`995/995`，`0` 失败。
- `git diff --check`：通过；用户已有的非本任务工作区改动未纳入提交。
- 真实微信开发者工具 `auto-preview`：通过，当前预览包 `1,842,090` 字节；未上传开发版。
- 真实预览已确认：现有场次页可用、五栏导航存在、玩家页入口和层级正确、社交资料失败时出现可操作的重试状态。
- CloudBase 已确认：20 个受管集合 ACL 无漂移、31 个计划索引无缺失、`poker_social` 为 `Active`、运行时和资源配置正确、管理员白名单启用。

## 尚不能由本机替代的最终证据

必须使用普通账号 A、管理员账号 B 和第三普通账号 C 扫描同一预览版本，完成以下真机矩阵：

1. A 与 B 建立好友，C 保持非好友；验证申请确认前不可见及解除后的即时失权。
2. A 分别发布广场、全部好友、指定 B 三种分享；核对 B、C 的读取与互动矩阵。
3. A 或 C 发表评论；A 不能删除他人评论，B 可用固定原因移除，C 不能伪造管理员操作。
4. B 重试同一个管理员 mutation，评论计数和审计不得重复变化。
5. A 向 B 定向发送一张玩家名片；B 预览后分别验证新建和整体覆盖，已有对战手牌关联不丢失。
6. 验证消息失效态、解除好友、断网只读缓存、账号清除及审计脱敏。

只有上述矩阵得到真实账号结果后，才能把“最终真机验收”标记为完成。开发版上传仍需单独授权，不属于预览或功能完成的默认步骤。
