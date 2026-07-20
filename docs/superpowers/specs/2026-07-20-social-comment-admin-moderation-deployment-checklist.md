# 管理员评论处置部署与双账号验收清单

本清单只描述真实环境操作顺序。本地实现与预览完成不代表已经部署；执行以下步骤前必须再次取得真实云环境变更授权。

## 一、部署前确认

- 使用本次验收通过的提交，不夹带版本号、发布海报或其他功能变更。
- 确认管理员微信 OpenID 来自可信的服务端查询，不在工单、截图、客户端日志或代码仓库中传播。
- 备份当前数据库安全规则、索引配置、`poker_social` 云函数版本与环境变量。

## 二、固定部署顺序

1. 部署 `database-security-rules.json`，确认 `social_moderation_audits` 客户端读写均被拒绝。
2. 部署 `database-indexes.json` 中审计集合的两个索引：
   - `targetAuthorId ASC, createdAt ASC, _id ASC`
   - `moderatorId ASC, createdAt ASC, _id ASC`
3. 等待两个索引均变为可用状态。
4. 部署 `poker_social` 云函数。此时尚未配置管理员名单，管理员能力应默认失败关闭。
5. 创建 `cloudfunctions/poker_social/database-security-rules.json` 中声明的全部集合；创建后立即设置为客户端不可读写，再创建 `database-indexes.json` 中的全部索引并等待索引可用。
6. 使用仓库根目录的独立配置 `cloudbaserc.social.json` 部署 `poker_social`；不要使用默认 `cloudbaserc.json` 的 `--all`，后者只管理既有 `poker_review`。
7. 为 `poker_social` 配置至少 32 个随机字节的 `SOCIAL_INVITE_TOKEN_SECRET`。密钥只能保存在云函数环境变量中，不写入仓库、聊天或截图。
8. 为 `poker_social` 配置 `SOCIAL_ADMIN_OPENIDS`，使用英文逗号分隔确认过的 OpenID；不得加入昵称、玩家 ID 或客户端生成的标识。
9. 部署后回查云函数运行时、入口、超时、依赖安装、两个环境变量是否存在（仅确认存在，不输出值），并回查全部集合权限和索引状态。
6. 重新冷启动云函数实例，确认环境变量已生效。

## 三、双账号验收

准备普通账号 A 与管理员账号 B，两者都已初始化社交资料。

1. A 发布一条广场 BB 匿名手牌，并由 A 或另一普通账号发表文字评论。
2. A 打开手牌详情：可阅读、点赞、评论；看不到“移除”动作。
3. B 打开同一详情：他人未删除评论显示“移除”，B 自己的评论只显示普通“删除”。
4. B 选择一个固定原因移除评论。
5. A 重新进入详情：正文显示“该评论已被管理员移除”，评论计数与服务端一致，分享本身仍可阅读。
6. B 对同一评论重试同一请求：不得再次减少计数，不得生成第二条审计。
7. A 直接伪造 `admin_delete_comment`、`isAdmin`、管理员 OpenID 或能力字段：云函数统一返回 `FORBIDDEN`，评论、计数和审计均不变化。
8. 临时移除 B 的环境变量权限并冷启动：B 的处置请求返回权限变化，页面重新加载后仍可阅读，但不再显示“移除”。
9. 撤回一条仍有评论的分享后由 B 处置残留评论：允许软删除，但响应不返回公开评论计数。

## 四、账号清除与审计检查

- 清除评论作者账号后，审计记录的 `commentId/shareId/targetAuthorId/clientMutationId` 均为空，`targetRedacted` 为 `true`。
- 清除管理员账号后，审计记录的 `moderatorId` 为空，`moderatorRedacted` 为 `true`。
- 同一账号兼具两种角色时，两侧都必须脱敏。
- 客户端不能直接读取 `social_moderation_audits`；审计仅通过 CloudBase 控制台由授权运维人员查看。

## 五、回滚条件

出现权限误判、重复扣数、审计未写入、审计可被客户端读取或账号清除卡死时，立即移除 `SOCIAL_ADMIN_OPENIDS` 使能力失败关闭，再回滚云函数；保留已部署的拒绝规则和审计索引不会扩大客户端权限。
