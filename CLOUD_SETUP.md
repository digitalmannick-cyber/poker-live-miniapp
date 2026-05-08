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

按当前代码，先创建这 4 个集合：

1. `sessions`
2. `hands`
3. `hand_actions`
4. `bankroll_logs`

后续如果要把语音复盘中间态也上云，再加：

5. `voice_parse_jobs`

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
4. 把本地 seed 数据迁移为“首次进入自动引导创建 Session”

## 7. 语音复盘与豆包云函数

当前项目已经把小程序前端接到了云函数名：

- `doubao_asr`

并且已经在项目内新增目录：

- `cloudfunctions/doubao_asr`

### 7.1 开发者工具里需要做的事

- 重新打开或刷新 `D:\TRAE\xuan\poker-live-miniapp`
- 确认开发者工具识别到 `cloudfunctions` 目录
- 在云函数面板里上传并部署 `doubao_asr`
- 先在该函数目录执行依赖安装，至少安装 `wx-server-sdk`

### 7.2 需要配置的云函数环境变量

当前函数按“云函数中转豆包语音识别”的方式设计，避免把密钥放在小程序前端。

至少需要配置：

- `DOUBAO_ASR_URL`

可选配置：

- `DOUBAO_ASR_BEARER_TOKEN`
- `DOUBAO_ASR_HEADERS`
- `DOUBAO_ASR_PAYLOAD`

说明：

- `DOUBAO_ASR_URL`：你的豆包/火山引擎语音识别服务地址，函数会把录音转成 base64 后 POST 过去
- `DOUBAO_ASR_BEARER_TOKEN`：如果服务要求 Bearer Token，就填这里
- `DOUBAO_ASR_HEADERS`：额外请求头，填 JSON 字符串，例如 `{"X-App-Id":"xxx"}`
- `DOUBAO_ASR_PAYLOAD`：额外固定请求体，填 JSON 字符串，会和音频字段一起合并发送

### 7.3 当前函数发送的数据格式

云函数会向 `DOUBAO_ASR_URL` 发送 JSON：

```json
{
  "audio": "<base64音频>",
  "format": "aac",
  "sampleRate": 16000
}
```

如果你配置了 `DOUBAO_ASR_PAYLOAD`，会一并合并进去。

### 7.4 当前函数支持读取的返回字段

函数会优先从这些位置取识别文本：

- `text`
- `transcript`
- `result.text`
- `result.transcript`
- `data.text`
- `data.transcript`
- `utterances[].text`
- `segments[].text`

所以如果你的豆包中转接口返回的是这些常见字段之一，前端就能直接使用。
