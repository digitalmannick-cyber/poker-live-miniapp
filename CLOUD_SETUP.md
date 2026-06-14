# 云开发接入说明

当前项目已经接入了“云开发优先，本地 fallback”的数据层。

## 1. 当前状态

- 已增加云初始化：`utils/cloud.js`
- 已增加云仓储：`services/cloud-repo.js`
- 已增加双数据源入口：`services/data-service.js`
- 若云环境不可用，会自动回退到本地 `utils/store.js`

## 2. 你需要做的配置

### 2.1 设置云环境 ID

编辑文件：

- `config/cloud.js`

把：

```js
const CLOUD_ENV_ID = ''
```

改成你的微信云开发环境 ID，例如：

```js
const CLOUD_ENV_ID = 'cloud1-xxxxxxxxxxxx'
```

### 2.2 在微信开发者工具中开启云开发

- 打开该项目目录：`D:\TRAE\xuan\poker-live-miniapp`
- 在开发者工具里开通或选择云开发环境
- 确保当前小程序可以访问该环境

## 3. 需要创建的集合

按当前代码，先创建这 6 个集合：

1. `sessions`
2. `hands`
3. `hand_actions`
4. `bankroll_logs`
5. `profiles`
6. `user_settings`

后续如果要把语音复盘中间态也上云，再加：

7. `voice_parse_jobs`

其中 `sessions`、`hands`、`hand_actions`、`bankroll_logs` 都会写入 `playerId` 字段；列表、详情、统计、导入覆盖和清空数据都会按当前玩家 `playerId` 过滤，避免不同玩家之间读到或清掉彼此的业务数据。

## 4. 当前已接云的能力

当前已实现云端读写的主链路：

- 读取 Session 列表
- 读取 Session 详情
- 新建 Session
- 更新 Session
- 结束 Session
- 新建 Hand
- 更新 Hand
- 读取 Hand 详情
- 读取 Hand 动作链
- 复盘列表读取
- 统计摘要读取

## 5. 当前回退策略

如果出现以下任一情况：

- 未配置云环境 ID
- `wx.cloud` 不可用
- 云数据库调用失败

系统会自动回退到本地存储，不会直接中断页面主流程。

## 6. 下一步建议

如果你已经配置好云环境，我下一步建议继续做：

1. 增加集合权限规则建议
2. 把 `voice_parse_jobs` 也接到云端
3. 增加统一的错误提示与加载状态
4. 增加云端旧数据迁移脚本

## 7. 新用户初始数据

当前所有新用户首次打开都会加载同一套本地初始模板，但只共享扑克业务预设和样例数据，不共享个人微信资料。

- 默认资料只保留占位值：`玩家` / `怪盗团新兵` / 头像文字 `PL` / 空头像 URL
- 默认设置：筹码单位 `HKD`，场地 `MGM`、`威尼斯人`、`Home Game`
- 默认盲注：`100/200`、`200/400`、`300/600`、`500/1000`，默认选中 `200/400`
- 默认位置：`UTG`、`UTG+1`、`LJ`、`HJ`、`CO`、`BTN`、`SB`、`BB`、`STR`
- 默认对手类型：`紧弱`、`松弱`、`激进`、`跟注站`
- 一条可体验流程的样例牌局、手牌和动作链

每个用户都会单独生成自己的 `playerId`，不会复用同一个 UID。昵称和头像仍然由首次进入“我的”页时的微信资料同步流程写入，不作为全局初始数据。已有本地数据的用户不会被这套初始模板覆盖；只有首次进入或在“我的”里清空数据后，才会重新生成这套初始数据。

## 8. 当前推荐接法

当前项目已经把小程序前端接到了云函数名：

- `poker_review`

并且已经在项目内新增目录：

- `cloudfunctions/poker_review`

### 8.1 开发者工具里需要做的事

- 重新打开或刷新 `D:\TRAE\xuan\poker-live-miniapp`
- 确认开发者工具识别到 `cloudfunctions` 目录
- 在云函数面板里上传并部署 `poker_review`
- 在该函数目录先执行依赖安装，至少安装 `wx-server-sdk`

### 8.2 当前只需要配置一套 Kimi Key

当前主流程已经改成：

- 用户把口述文本贴到复盘弹层
- `poker_review` 调 Kimi 做术语纠错和结构化提取
- 返回待回填字段

至少需要配置：

- `MOONSHOT_API_KEY`

可选配置：

- `MOONSHOT_BASE_URL`
- `MOONSHOT_MODEL`
- `MOONSHOT_TIMEOUT_MS`

说明：

- `MOONSHOT_API_KEY`：Kimi / Moonshot API Key
- `MOONSHOT_BASE_URL`：默认 `https://api.moonshot.ai/v1`
- `MOONSHOT_MODEL`：默认 `kimi-k2.6`
- `MOONSHOT_TIMEOUT_MS`：默认 `30000`

### 8.3 当前返回内容

`poker_review` 云函数负责：

- 扑克术语纠错
- 结构化提取字段
- 缺失字段识别
- 追问建议生成

前端会把当前手牌上下文和口述文本一起传给 `poker_review`，函数返回：

- `extractedHand`
- `missingFields`
- `followUpQuestions`
- `naturalLanguageSummary`

## 9. 关于录音直转文字

当前主流程已经不再依赖 `doubao_asr`。

也就是说，**现在要跑通语音复盘，只配一个 Kimi Key 就够了**，但前提是：

- 先用系统语音输入法把口述转成文本，或手动粘贴文本
- 再交给 `poker_review` 做结构化提取

如果你后面一定要做：

- 小程序内直接点录音
- 原始音频直接上传
- Kimi 直接转写成文本

那需要再接一层 Kimi Audio 代理或明确可用的音频转写接口。这个不影响当前先把语音复盘主流程跑通。
