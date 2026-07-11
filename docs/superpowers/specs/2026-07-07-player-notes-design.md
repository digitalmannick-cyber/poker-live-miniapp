# 线下玩家 Note 功能需求草案

## 背景

线下德州扑克里，对手信息是跨场次沉淀的长期记忆。现有小程序已经有场次、记牌、复盘、统计和个人资料，但缺少一个独立的“玩家库”：用户无法快速找到某个线下玩家、查看他的 leak 标签、完整 note，以及过去和他相关的关键手牌。

这次第一版不做复杂 HUD，也不做自动画像。核心目标是把“玩家”提升为一级资料管理对象，并能链接到具体手牌。

## 产品目标

1. 用户可以创建、编辑、删除线下玩家档案。
2. 用户可以通过底部“玩家”tab 进入玩家库。
3. 用户可以在玩家列表里快速识别玩家：照片、名字、玩家类型颜色、leak 标签。
4. 用户可以通过关键词和玩家类型筛选找到玩家。
5. 用户可以进入玩家详情查看完整 note。
6. 用户可以在玩家详情里查看“对战手牌”，即 Hero 和该玩家打过并记录下来的具体手牌，并播放具备回放数据的手牌。
7. 玩家 note 数据必须支持本地备份、导入/导出、云函数读写和账号隔离。

## 第一版范围

### 包含

- 玩家库列表页。
- 新增玩家、编辑玩家、删除玩家。
- 玩家详情页。
- 玩家照片、名字、玩家类型、类型颜色标记、leak 标签、note、对战手牌。
- 对战手牌可播放：有回放数据时播放，无回放数据时跳转手牌详情。
- 按关键词搜索。
- 按玩家类型筛选。
- 列表展示 leak 标签。
- 空状态、无搜索结果状态、保存失败状态。
- 本地 store、导入/导出备份、云函数读写和账号隔离。
- 单元测试覆盖数据规范化、筛选搜索、云函数权限边界和备份兼容。

### 不包含

- 自动从手牌生成玩家画像。
- 自动识别照片中的玩家。
- 复杂 HUD、VPIP/PFR/3bet 等统计画像。
- 多人共享玩家库。
- 玩家库公开社交功能。
- 直接修改现有手牌语义解析规则。
- 从手牌详情反向编辑玩家 note。

## 信息架构

底部 tab 调整为：

1. 场次：`pages/session-list/session-list`
2. 手牌：由原“复盘”改名，仍指向 `pages/review-list/review-list`
3. 玩家：新增 `pages/player-notes/player-notes`
4. 统计：`pages/stats/stats`
5. 我的：`pages/profile/profile`

原“记牌”tab 被玩家 tab 替换。这个调整会改变核心入口，因此必须保留清晰的记牌路径：记牌入口应放在场次页和手牌页的主操作按钮中，而不是完全移除。

新增页面：

- `pages/player-notes/player-notes`：玩家库列表。
- `pages/player-note-detail/player-note-detail`：玩家详情、新增、编辑共用。

## 玩家库列表页

### 展示内容

列表项只展示现场快速识别需要的信息：

- 照片：优先 `avatarUrl`，为空时使用默认头像。
- 名字。
- 玩家类型：使用固定颜色标记，不同类型颜色不同；列表项整条使用该玩家类型颜色作为主视觉，而不是只显示一个小圆点或小标签。
- leak 标签：显示 2-3 个核心标签，超出时显示数量。

列表页不强制展示完整 note，也不展示手牌列表。note 和对战手牌放在详情页，避免列表变重。

### 搜索与筛选

顶部区域：

- 搜索框：搜索名字、别名、note、leak 标签。
- 类型筛选：选择某一玩家类型，默认“全部”。
- 新增按钮。

搜索规则：

- 关键词去除首尾空格。
- 英文大小写不敏感。
- 中文按包含匹配。
- 搜索范围包含名字、别名、note、leak 标签。

筛选规则：

- 类型筛选和关键词搜索同时存在时，返回同时满足的玩家。
- `archived: true` 的玩家默认不显示。

### 排序

默认按 `lastSeenAt desc`，没有 `lastSeenAt` 时按 `updatedAt desc`。搜索和筛选不应破坏这个排序规则。

### 空状态

- 没有任何玩家时：展示“还没有玩家档案”，提供新增入口。
- 有玩家但筛选无结果时：展示“没有匹配玩家”，提供清除筛选和新增入口。
- 云端或保存失败时：展示可理解的错误，不假装成功。

## 玩家详情页

### 查看态

展示：

- 照片。
- 名字。
- 玩家类型和类型颜色。
- leak 标签。
- 完整 note。
- 对战手牌列表。

对战手牌定义：

- 对战手牌不是泛化的“链接资源”，而是 Hero 和当前玩家打过、并已经记录到手牌库中的手牌。
- 玩家详情只展示与当前玩家相关的对战手牌；同一手牌如果关联多个玩家，进入不同玩家详情时应以该玩家为对手上下文展示。
- 页面文案统一使用“对战手牌”，不使用“链接手牌”作为用户可见名称。

对战手牌列表展示：

- 手牌日期。
- 场次或场馆。
- 盲注。
- hero 手牌。
- hero 位置。
- 公共牌，展示方式与现有手牌列表一致。
- Hero 和该玩家的对战关系，例如 `Hero vs 老张`。
- 盈亏结果。
- 该手牌的行动摘要，展示方式与现有手牌列表的行动线一致。
- 播放状态。

播放规则：

- 有 `ledgerState`、`streetInputs` 或 `handActions` 的手牌显示“播放”。
- 点击播放复用现有手牌回放能力。
- 缺少回放数据的手牌显示“暂无回放”，但仍可跳转手牌详情。
- 玩家详情只保存对战手牌 ID，不复制完整手牌内容。

### 编辑态

字段规则：

- 名字必填，去除首尾空格。
- 照片支持从相册选择或拍照上传。
- 照片为空时不报错，使用默认头像。
- 玩家类型从已有 `settings.opponentTypes` 读取，同时允许自定义。
- 玩家类型颜色由类型稳定映射生成，用户可以覆盖单个玩家颜色。
- leak 标签可多值，去除空项和重复项。
- leak 标签不放到“我的”页面单独维护。新增或编辑玩家 note 时，在 leak 标签选择区域内直接维护：选择已有标签、新建标签、删除已有可选标签。
- 删除已有可选 leak 标签时，只应从当前用户的 leak 标签库中移除。第一版不建议自动清洗其他玩家已经保存的历史标签，避免误删旧判断。
- note 支持多行文本，建议限制 3000 字。
- 对战手牌通过搜索/选择已有手牌添加，不在玩家详情里新建手牌。

### 视觉方向

玩家库页面必须优先贴合现有小程序视觉体系。P5/Persona 5 式元素只能作为轻量强调，不能让玩家库看起来像独立主题页或活动页。

- 继承现有小程序的深色渐变背景、半透明卡片、红色斜角背景、青色信息强调、圆角和按钮风格。
- P5 元素只用于轻量斜角、红色背景块、少量高字重标题，不使用大面积海报式水印、强烈整屏渐变或独立视觉语言。
- 玩家列表项必须首先服务于现场快速扫描：类型色覆盖整条条目，但采用低饱和 tint、边框或左侧色条，不能让类型色压过名字、照片、leak 标签和手牌数量。
- 卡片和按钮仍保持移动端工具属性，避免过大的 hero、过多装饰和影响阅读的背景图。

### 删除

删除需要二次确认。第一版采用软删除：

- 设置 `archived: true`。
- 默认列表和搜索不显示。
- 不删除已有关联手牌或场次。

## 玩家类型颜色

类型颜色必须稳定，不能每次随机生成。建议内置映射：

- 紧弱：蓝色。
- 松弱：绿色。
- 激进：红色。
- 跟注站：黄色。
- 常客：紫色。
- 娱乐玩家：青色。
- 未分类/未知类型：灰色。

自定义类型若没有配置颜色，默认使用灰色；用户可以在单个玩家上覆盖颜色。

列表展示规则：

- 类型颜色用于整条玩家列表项的背景、边框或左侧大面积色块。
- 类型标签本身只作为文字确认，不再承担主要识别职责。
- 详情页顶部也应继承该玩家类型色，保持列表到详情的视觉一致性。
- 为了和现有小程序统一，第一版推荐“左侧色条 + 低透明度整行 tint”，不推荐高饱和整行纯色。

## 数据模型

新增业务集合/本地字段：`playerNotes`。

```js
{
  _id: "player_note_1783360000000_1234",
  playerId: "WX-0V0I0SH",
  name: "老张",
  alias: ["红帽子", "MGM 200/400 常客"],
  avatarUrl: "",
  avatarFileId: "",
  type: "跟注站",
  typeColor: "#f5b400",
  leakTags: ["不弃顶对", "river少诈唬"],
  note: "完整玩家备注",
  lastSeenAt: 1783360000000,
  lastVenue: "MGM",
  lastStake: "200/400",
  battleHandIds: ["hand_1782828012794_5614"],
  archived: false,
  createdAt: 1783360000000,
  updatedAt: 1783360000000
}
```

新增用户级 leak 标签库字段，建议放在本地 store 与云端用户设置中：

```js
{
  playerLeakTags: ["不弃顶对", "river少诈唬", "跟注过宽"]
}
```

`playerLeakTags` 是可选标签库，不等于每个玩家身上的 `leakTags`。玩家保存时仍把当时选中的标签写入 `playerNotes.leakTags`，这样即使后续从标签库删除某个标签，也不会默认破坏历史玩家 note。

### 设计判断

玩家库不应混入现有 `hands.opponentName`、`hands.opponentType` 或 `hands.notes`。这些字段描述某一手牌的上下文，而玩家库是跨场次长期记忆。

`battleHandIds` 只保存手牌 ID。详情页展示时从现有 `hands`、`handActions` 或云函数按 ID 拉取摘要和回放数据。这样可以避免玩家 note 文档变大，也避免手牌被编辑后玩家详情显示旧数据。

如果实现阶段沿用历史字段名 `linkedHandIds`，必须在产品文案、接口注释和导出文档中统一解释为“对战手牌 ID”。新实现建议直接使用 `battleHandIds`，减少“链接”语义带来的误解。

## 云同步与权限

新增云函数 action：

- `list_player_notes`
- `create_player_note`
- `update_player_note`
- `delete_player_note`
- `list_player_note_hands`
- `get_player_note_hand_replay`

所有云端玩家 note 文档必须写入：

- `playerId`
- `ownerOpenId`

读取、更新、删除都必须同时校验 `playerId` 和 `ownerOpenId`。

对战手牌读取也必须校验账号边界：

- `list_player_note_hands` 只返回当前账号可访问的对战手牌摘要。
- `get_player_note_hand_replay` 只返回指定手牌的必要回放数据，不返回无关手牌。

### 幂等性

创建、更新、删除都应支持 `clientMutationId`，沿用现有 `sync_operations` 机制，避免网络重试造成重复玩家或重复删除。

### Payload 控制

`sync_stats` 不应返回完整 `playerNotes`，避免统计页 payload 变大。玩家库应通过独立 action 分页或按需读取。

玩家详情也不能一次性加载完整历史手牌。列表页只返回玩家 note 轻量字段；详情页按 `battleHandIds` 拉取手牌摘要；用户点击播放时，再加载该手牌的回放数据。

### 照片存储

玩家照片第一版支持真实照片。小程序端使用微信选择媒体能力获得本地临时文件；云可用时上传到云存储并保存 `avatarFileId` 和可展示的 `avatarUrl`。云不可用或上传失败时不阻断玩家创建，但要保留无图状态并提示照片保存失败。照片不进入 `sync_stats`，也不进入默认 agent export。

## 自动识别照片中的玩家

自动识别照片中的玩家不进入第一版。技术上这通常是人脸识别链路：

1. 人脸检测：判断照片里是否有人脸、脸的位置和质量。
2. 人脸特征提取：把脸转成特征向量或服务商内部可检索模板。
3. 人脸库管理：为每个玩家维护一个或多个注册照。
4. 人脸搜索/比对：新照片上传后，在玩家人脸库里找相似度最高的人。
5. 人工确认：相似度达到阈值也不能直接自动合并，必须让用户确认。

实现复杂度中高。主要难点不是调用 API，而是照片质量、多人合照、相似玩家误判、阈值调参、误识别后的数据污染，以及人脸信息属于高敏感个人信息。客观建议是后续最多做“相似玩家候选提示”，不要自动确认。

## 本地备份与兼容

`store.ensureStoreShape` 应把缺失的 `playerNotes` 补为空数组。`exportBackup`、`importBackup`、`clearAllData` 都必须覆盖 `playerNotes`。

旧备份没有 `playerNotes` 时必须正常启动，不触发迁移错误。

## 验收标准

1. 底部 tab 显示为“场次 / 手牌 / 玩家 / 统计 / 我的”。
2. 原“复盘”入口文案改为“手牌”，仍能进入手牌列表。
3. 原“记牌”tab 被玩家 tab 替换，但用户仍能从场次页或手牌页找到记牌入口。
4. 用户能新增一个包含照片、名字、类型、leak 标签和 note 的玩家。
5. 玩家库列表能显示照片、名字、类型颜色和 leak 标签。
6. 玩家库列表中，不同玩家类型的整条列表项使用不同类型色，用户不需要依赖小圆点才能识别类型。
7. 用户能通过关键词搜索玩家。
8. 用户能按玩家类型筛选。
9. 用户能进入详情查看完整 note。
10. 用户能在玩家详情看到“对战手牌”，即 Hero 和该玩家打过的具体手牌。
11. 对战手牌展示样式与现有手牌列表保持一致，至少包含 Hero 手牌、Hero 位置、公共牌、盈亏、行动摘要、日期/场地/盲注和播放入口。
12. 有回放数据的对战手牌可以播放。
13. 无回放数据的对战手牌可跳转详情，不造成页面错误。
14. 用户能编辑玩家信息，列表和详情同步更新。
15. 用户在新增/编辑玩家时能选择已有 leak 标签、新建 leak 标签、删除已有可选 leak 标签。
16. 用户能删除玩家，删除后默认列表和搜索不再显示。
17. 云端读写必须隔离账号，不能跨账号读写玩家 note 或对战手牌。
18. 旧数据和现有场次、手牌、统计、我的流程不受影响。

## 测试用例

### 导航与入口

1. `app.json` 页面配置包含 `pages/player-notes/player-notes` 和 `pages/player-note-detail/player-note-detail`。
2. 自定义 tab 顺序为场次、手牌、玩家、统计、我的。
3. 原复盘 tab 文案改为“手牌”，路径仍指向 `pages/review-list/review-list`。
4. 原记牌 tab 不再出现在底部 tab。
5. 场次页或手牌页存在可发现的记牌入口。

### 数据模型与本地 store

1. `ensureStoreShape` 接收没有 `playerNotes` 的旧备份时，返回 `playerNotes: []`。
2. 创建玩家时，名字为空或全空格，应返回校验失败。
3. 创建玩家时，名字前后空格被去除。
4. 创建玩家时，重复 leak 标签被去重。
5. 创建玩家时，空 leak 标签被去除。
6. 未设置自定义颜色时，玩家类型能映射到稳定 `typeColor`。
7. 添加对战手牌时，只保存 `battleHandIds` 或兼容字段 `linkedHandIds`，不复制完整 hand 文档。
8. 删除对战手牌只从玩家档案移除 ID，不删除原手牌。
9. 更新玩家 note 时，`updatedAt` 变化，`createdAt` 保持不变。
10. 软删除玩家时，`archived` 变为 `true`，数据仍存在。
11. `exportBackup` 包含 `playerNotes`。
12. `importBackup` 能恢复 `playerNotes`。
13. `clearAllData` 后 `playerNotes` 为空。

### 搜索与筛选

1. 按玩家名字搜索能命中。
2. 按别名搜索能命中。
3. 按 note 内容搜索能命中。
4. 按 leak 标签搜索能命中。
5. 搜索关键词前后空格不影响结果。
6. 英文关键词大小写不影响结果。
7. 按玩家类型筛选只返回对应类型。
8. 关键词和类型同时存在时，只返回同时满足的玩家。
9. `archived: true` 的玩家默认不出现在搜索结果。
10. 无匹配结果时返回空数组，并由页面展示无结果状态。
11. 默认排序按 `lastSeenAt desc`，缺失时按 `updatedAt desc`。

### 对战手牌与播放

1. 玩家详情能加载 `battleHandIds` 或兼容字段 `linkedHandIds` 对应的手牌摘要。
2. 对战手牌区域标题显示为“对战手牌”，不显示“链接手牌”。
3. 对战手牌只展示 Hero 和当前玩家打过的手牌；不展示与该玩家无关的手牌。
4. 对战手牌卡片结构与现有手牌列表一致，显示 Hero 手牌、Hero 位置、公共牌、盈亏、行动摘要和元信息。
5. 对战手牌元信息显示 `Hero vs 当前玩家`，并包含日期、场地或场次、盲注。
6. 具备 `ledgerState` 的对战手牌显示播放按钮。
7. 具备 `streetInputs` 或 `handActions` 的对战手牌显示播放按钮。
8. 缺少回放数据的对战手牌显示“暂无回放”或跳转 affordance。
9. 点击“暂无回放”的手牌仍能跳转手牌详情。
10. 播放对战手牌只加载该手牌的回放数据。
11. 原手牌被删除或不可访问时，玩家详情显示“手牌不可用”，不崩溃。

### 云函数

1. `create_player_note` 缺少 `playerId` 时返回 `MISSING_PLAYER_ID`。
2. `create_player_note` 缺少名字时返回校验错误。
3. `create_player_note` 成功后写入 `playerId` 和 `ownerOpenId`。
4. 相同 `clientMutationId` 重复创建，不产生重复文档。
5. `list_player_notes` 只返回当前 `playerId + ownerOpenId` 的玩家 note。
6. `update_player_note` 不能更新其他账号的玩家 note。
7. `delete_player_note` 不能删除其他账号的玩家 note。
8. `delete_player_note` 成功时执行软删除，不物理删除。
9. `list_player_note_hands` 只返回当前账号可访问的对战手牌摘要。
10. `get_player_note_hand_replay` 不能读取其他账号手牌。
11. `sync_stats` 返回体不包含完整 `playerNotes`。
12. 玩家照片不出现在 `sync_stats` 和默认 agent export 返回体中。

### 页面与交互

1. 玩家库为空时展示空状态和新增入口。
2. 新增玩家保存成功后返回列表，新增玩家出现在列表顶部。
3. 列表项展示照片或默认头像、名字、类型颜色、leak 标签。
4. 不同玩家类型的列表项整条背景或主体色块不同，类型色不是只存在于一个小圆点中。
5. 照片为空时展示默认头像，不出现破图。
6. 点击列表项进入详情页，展示完整 note。
7. 编辑详情保存后，详情和列表展示同步更新。
8. 新增/编辑玩家时，选择已有 leak 标签会立即进入已选区，再次点击或点删除可取消选择。
9. 新增/编辑玩家时，可以创建新的 leak 标签；创建后该标签进入当前玩家已选标签，并出现在当前用户可选标签库中。
10. 新增/编辑玩家时，可以删除已有可选 leak 标签；删除后该标签不再出现在可选标签库中。
11. leak 标签库维护入口只出现在新增/编辑玩家 note 流程中，不放到“我的”页面。
12. 删除玩家时弹出二次确认。
13. 删除确认取消时，玩家仍保留。
14. 删除确认后，玩家从默认列表消失。
15. 搜索无结果时展示无结果状态和清除筛选入口。
16. 切换类型筛选时，搜索框内容保留。
17. 保存失败时展示错误，并保留用户已输入内容。

### 回归

1. 场次列表页启动正常。
2. 手牌列表页启动正常。
3. 玩家库页启动正常。
4. 统计页启动正常，且没有因为玩家 note 增加 payload。
5. 我的页启动正常。
6. 现有 `hands.opponentName` 和 `hands.opponentType` 行为不变。
7. 现有备份导入测试不因新增字段失败。

## 当前实现口径

Hand ledger player binding update:

- The full hand ledger "set player" sheet must integrate with Player Notes.
- The search box in the full hand ledger "set player" sheet only searches player name and alias. It must not show all saved players before the user enters a search query.
- A seat can search existing player notes by name or alias, then bind one directly from the sheet.
- A seat can also create a new player note from the same sheet by saving the current player name, selected player type, and note inputs, then bind it immediately.
- Bound seat state and hand `playerSnapshots` must persist `playerNoteId`, player name, player type, player note, and leak tag snapshot.
- After the hand is saved, the saved `handId` must be appended to every bound player note's `battleHandIds`, so Player Note detail can show the hand under battle hands automatically.
- The saved hand must also persist the primary opponent's `opponentPlayerNoteId`, `opponentName`, `opponentType`, and related note/leak snapshot, so hand list/detail views can show which player the hand was played against.
- Manual battle-hand linking from Player Note detail remains available, but full hand ledger save must not rely on that manual step.

第一版采用离线优先：玩家 note 的创建、编辑、删除、搜索、类型筛选、对战手牌绑定都先写入本地 `store.playerNotes`，云不可用时不阻断用户记录。云可用时，客户端通过 `create_player_note`、`update_player_note`、`delete_player_note` 后台同步；列表读取先返回本地数据，再通过 `list_player_notes` 后台合并云端数据，避免页面启动被云超时拖慢。

`sync_stats` 不回传完整 `playerNotes`，只负责统计所需数据；完整备份、导入、恢复流程必须包含 `playerNotes`。跨设备即时同步如果后续要做得更强，应在玩家库入口增加显式刷新或分页拉取，而不是把玩家 note 塞回统计 payload。

新增/编辑玩家页面的照片区放在表单最上方，点击照片后从“拍照”或“手机相册”选择图片。本地文件只作为微信选择、裁剪、压缩过程中的临时文件；正式写入玩家 note 的头像必须来自云存储 `fileID`，同时保存到 `avatarUrl` 和 `avatarFileId`。云不可用、上传失败或图片无法压缩到上传限制内时，不把本地路径写入玩家资料，玩家 note 可继续保存但头像保持为空并提示上传失败。列表页顶部的新增入口采用轻量加号按钮，避免在标题区出现过重的红色主按钮；空状态仍保留明确的“新增玩家”主按钮。

照片选择后必须先进入头像裁剪确认流程。第一版优先使用微信原生 `wx.cropImage`，固定 `1:1` 裁剪比例，让用户在系统裁剪界面中缩放、移动照片，把脸部放到头像区域后再确认。确认后的裁剪图必须先压缩并通过 `wx.getFileInfo` 检查大小，目标是不超过微信云上传 2MB 限制；超过限制时不能调用 `wx.cloud.uploadFile`，避免触发 80051 系统错误。如果当前基础库不支持裁剪接口，则退回使用原图并继续走压缩、大小检查和云上传流程。

头像展示需要做本机缓存优化。玩家 note 的正式字段仍只保存云存储 `fileID`，上传路径为 `player-notes/avatar-<timestamp>-<random>.<ext>`；客户端在上传成功后把当前裁剪图保存为本机展示缓存，并以云 `fileID` 为 key 记录缓存路径。玩家库列表和玩家详情优先使用本机缓存路径展示头像，没有缓存时才使用云 `fileID`，同时后台通过 `wx.cloud.downloadFile` 拉取并缓存。缓存字段不得写入玩家 note、备份、云函数数据或 agent export。

新增 leak 标签时，要同时加入当前玩家的已选 `leakTags` 和当前用户的 `settings.playerLeakTags`。编辑页的 leak 标签库必须可维护：可新增、可选中/取消选中，也可删除标签；删除标签时同步从当前玩家已选标签和 `settings.playerLeakTags` 中移除。保存玩家时再做一次反向合并：把玩家身上的自定义 leak 标签写回标签库，避免新增后重新打开编辑页时标签丢失。

`settings.playerLeakTags` 的写入必须同时更新主本地 store 快照和独立 settings 快照；新增或删除 leak 标签时要等待云端 settings 保存完成后再认为操作完成，避免用户立刻重新进入编辑页时被旧云端 settings 覆盖。

玩家库列表卡片采用“大头像 + 右侧信息区”布局，头像作为第一视觉元素，文字、类型、对战手牌数、leak 标签和 note 摘要在右侧铺开，不保留大面积空白。不同玩家类型要驱动整条卡片的背景、边框、侧边色条和类型 badge，而不是只改变小标签颜色；第一版至少覆盖 `紧弱`、`松弱`、`激进`、`跟注站`、`鱼`、`常客`、`职业`、`娱乐玩家`、`未分类`。

玩家库列表卡片高度保持紧凑，第一版控制在约 `168rpx` 的卡片主体高度，头像列使用约 `124rpx`，保证一屏能展示更多玩家。内置玩家类型颜色不读取旧数据里缓存的 `typeColor` 覆盖值，避免旧 `鱼` 类型因为历史灰色缓存继续显示灰色；`鱼` 使用绿色 `#21d4a8`。

新增/编辑页底部保存区必须适配安全区，按钮宽度收敛在内容容器内，不得贴住系统 Home indicator 或向右溢出。底部动作使用普通视图控件承载，不使用微信原生 `button` 默认样式，避免设备端按钮伪边框、默认 padding 或最小宽度造成溢出。玩家详情页左上返回按钮在编辑态执行取消编辑，在查看态返回玩家列表；从玩家详情打开对战手牌详情时使用替换跳转，确保手牌页系统返回可直接回到玩家列表层级。

## 实现顺序建议

1. 先做导航结构调整和入口校验，确保记牌入口没有丢失。
2. 做数据模型、store 方法、类型颜色映射、leak 标签和搜索筛选单元测试。
3. 做对战手牌的数据读取、摘要生成和可播放判定。
4. 做云函数 action 和权限测试。
5. 做 data-service/cloud-data-api 接口。
6. 做玩家列表页、详情页和手牌回放入口。
7. 最后跑页面回归和真实预览。

## 后续可选增强

1. 在手牌详情里反向关联玩家 note。
2. 从照片识别相似玩家候选。
3. 从累计手牌中生成对手统计画像。
4. 回收站和恢复已删除玩家。
