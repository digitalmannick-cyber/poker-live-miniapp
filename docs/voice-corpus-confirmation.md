# 语音牌谱语料确认表

来源：飞书文档《2026年5月手牌复盘原始文本汇总》

用途：把真实语音转文字牌谱整理成“原始语音文本 / Agent 解析草案 / 需要你确认”的对照表。

## 已确认的通用口语规则

- COV = CO 位
- 巴腾 / 巴特 = BTN
- 勾 = J，圈 = Q
- 靠：动作上下文里按 call 理解
- 合牌 = river / runout
- 200400800 / 200/400/800 = 200/400 + straddle 800
- 没说级别时继承当前 session 选择的级别
- 未说花色的公共牌可自动补合理花色，但不能和 Hero 手牌重复
- 彩虹表示不同花色
- 后门红桃兆表示 turn 发出红桃

## Agent 识别结果总览（先确认这里）

确认方式：先看每手的“识别结果”，再对照后面的“原始语音文本”。如果识别正确，在该手下面写“确认”；如果不对，直接改字段值即可。

### 2026-05-12

#### 手牌 #1 — 66 【-44000¥】

原始语音文本

> 昨天不知道是怎么回事，可能总体状态都不好，感觉打得不好。这个牌是在200、400，然后当时跟那个胡总。他很乱搞的嘛，翻牌前很多3B、4B的。然后这个牌是COV open，然后Button call。我在小盲也拿66，我也call。开1400，call 1400，我在小盲也call 1400。然后他在大盲搞了个6600，squeeze 6600出来。然后COV和Button都fold了，我直接推all in，因为他短码，他就4万了嘛。结果他call他是AA，flop还发了345，我然后也没有跑赢

识别结果：
- 级别：200/400
- Hero 位置：SB
- Hero 手牌：66
- 有效筹码：40000
- 本手输赢：-44000
- 对手位置：BB
- 对手昵称：胡总
- 对手类型：松凶娱乐玩家
- 当前底池 / 最终底池：待确认
- 公牌：flop 345，turn 空，river 空
- 行动线总结：翻前：CO C1400→BTN C1400→Hero SB C1400→BB 胡总 SQZ6600→CO F→BTN F→Hero AI→BB C；flop runout 345
- 心路历程：Hero 认为胡总翻前 3B/4B 很乱且只有约 4 万短码，所以用 66 面对 squeeze 直接 all-in。
- 标签：可优化
- 确认：COV 就是 CO 位；potSize 要按两家 all-in 约 80000估；标签是“明显错误”。

#### 手牌 #2 — AK 【-8300¥】

原始语音文本

> AK是个鱼在中位open吧，我在小盲拿到AK同色，我对他做个3 bet 5000，他有效10万嘛。然后他call，flop发个勾56彩虹，我打个3300，1/3，他call。转牌又掉张勾，还是彩虹，没有后门花兆，我check了，打了个1万6的锅，打了一个6000多，我check fold了

识别结果：
- 级别：继承当前 session
- Hero 位置：SB
- Hero 手牌：AKs
- 有效筹码：100000
- 本手输赢：-8300
- 对手位置：MP
- 对手昵称：空
- 对手类型：鱼
- 当前底池：turn 入口锅 16000
- 公牌：flop J56 rainbow，turn J，river 空
- 行动线总结：翻前：MP R?→Hero SB 3B5000→MP C；翻牌 J56r：Hero B3300→MP C；转牌 J：Hero X→MP B6000+→Hero F
- 心路历程：Hero 认为转牌第二张 J 且没有后门花，继续打/跟价值不足，因此 check-fold。
- 标签：可优化
- 待确认：中位是否按 MP；转牌下注记 6000 还是 6000+；session 级别是多少
- 确认：中位是 MP；转牌下注6000+；session 级别是继承session级别

#### 手牌 #3 — QQ 【-34500¥】

原始语音文本

> 这个圈圈是换到300、600，然后我在前位开，应该是COV call，然后这个鱼在小盲位call，然后大盲位call，四人底池。Flop发个2、3、6，两张方块，我有方块圈。我打了个半pot，打了个3000，然后COV call 3000，小盲这个鱼跳出了raise 6000，大盲弃牌。然后COV这个人只有4万码，我在想要不要再蕊，把那个后面短码那隔离掉，我想算了，因为这边这个小盲这个鱼，我这个牌还是挺边缘的，所以我接下来要call一下，call了然后COV弃牌了。转牌掉了个方块3，就有葫芦面了，但是花也出来了。然后小盲这个鱼很快也过牌了，那我也过牌了，后卫。但我现在想是不是转牌的时候应该要打一下，打个轻注，然后合牌求收档呢？如果被raise的话，可以轻松fold掉了。因为鱼应该没有这么高thinking level。然后但我check了。然后合牌掉了个草花7，白板牌。然后鱼打了，他就是又用眼睛向上瞅，然后在那算。这种马脚感觉是不是很大的牌力，中等牌力的一个马脚嘛。然后但是他打了一个pot size，所以我就call了。结果他是A勾方块，nuts花

识别结果：
- 级别：300/600
- Hero 位置：EP / 前位
- Hero 手牌：QQ（含方块 Q）
- 本手输赢：-34500
- 对手位置：SB
- 对手昵称：空
- 对手类型：鱼
- 当前底池：待确认
- 公牌：flop 2d3d6x，turn 3d，river 7c
- 行动线总结：翻前：Hero EP R→CO C→SB C→BB C；翻牌 2d3d6x：Hero B3000→CO C3000→SB R6000→BB F→Hero C→CO F；转牌 3d：SB X→Hero X；河牌 7c：SB B100%pot→Hero C
- 摊牌：SB A♦J♦，nuts flush
- 心路历程：Hero 认为 QQ 在多人池较边缘，没有再 raise 隔离短码；转牌复盘觉得可用轻注薄价值/保护，若被 raise 可以轻松 fold；河牌因对手现场马脚和 pot bet 选择 call。
- 标签：多人池、可优化
- 待确认：Hero 具体是 UTG、UTG+1 还是 EP；flop 第三张 6 的花色；river pot bet 金额。
- 确认：Hero 是 EP；flop 第三张 6 的花色？ 说两张方块 就随机两张牌是方块，像这手牌说转牌掉个方块3，那么flop的3就不是方块3了，所以flop 2和6是方块；river pot bet potsize就是当前底池大小。

#### 手牌 #4 — QJo 【-22500¥】

原始语音文本

> 这个勾圈是杂色。这个牌当时我在UTG open，然后button那条鱼call，然后小盲这个这个鱼跳出来raise 3，squeeze到4500，很小一个size。他很乱来的嘛，也不知道不知道他具体什么牌力。然后我觉得我，这会我刚补了码，我有十几万，我觉得要跟他，要跟他那个单挑。然后我就raise到15000，我觉得我这个牌不能call，对，我这勾圈肯定不能call嘛，但是也不想弃，我就再raise到15000，然后button那个鱼fold了，然后小盲这个鱼call 15000，flop发10、16。两张方块，我没有方块。他check给我打了一个7500，1/4。他check call，turn掉了一个4，好像是草花4吧。结果他直接all in出来了，all in二十几万。他可能没看到我后手有十几万。然后我也啥也没有嘛，我只能弃了。他这边，这个牌，哎呀，这个鱼是挺鱼的，但我没有运气。这个牌我有一张10，我有葫芦都easy call了，就蛮好的。但是没有运气嘛。然后这个鱼打完这手牌就走了

识别结果：
- 级别：继承当前 session
- Hero 位置：UTG
- Hero 手牌：QJo
- 有效筹码：十几万，建议先留空
- 本手输赢：-22500
- 对手位置：SB
- 对手昵称：空
- 对手类型：鱼 / 松凶
- 公牌：flop T6x 两方块待确认，turn 4c，river 空
- 行动线总结：翻前：Hero UTG R→BTN C→SB SQZ4500→Hero 4B15000→BTN F→SB C；翻牌 T6xdd：SB X→Hero B7500→SB C；转牌 4c：SB AI→Hero F
- 心路历程：Hero 觉得 QJo 不适合 call，但也不想直接弃，选择 4B 隔离松凶 SB 鱼；turn 无牌面对超大 all-in 只能弃牌。
- 标签：明显错误、诈唬
- 待确认：flop“10、16”到底是哪三张；session 级别；标签是否标“明显错误”。
- 确认：flop“10、16”到底是哪三张  这牌文本就是写的不好，我也记不清楚了，但是你上面识别成T6x x如果未提可以是随机牌 这种方式我觉得是可以的，我想起来这个牌应该是TT6俩方块 16是语音说十十6，识别成了10、16导致的。；session 级别；标签标“明显错误”。
### 2026-05-14

#### 手牌 #1 — JTs 【-22400】

原始语音文本

> 这个10勾红桃是在100、200打的，因为没有桌子嘛，然后在等位，等开桌，就打了会100、200。100、200的后备桌，但是这张桌子很好，桌上有五六个不会玩的人，然后这个牌 uTG有个余定碰的，然后到button，button这个人开1000，我在大盲拿到10勾红桃，我raise到4500，他有2万2这样。因为他，我想他可能是用一个position raise，说我想抢这个瓷钱，结果他推出来了。推出来了，我想了一会，我觉得他推得很快，我觉得他AK也不会推那么快，我觉得可能是AK啊、A圈啊，也有可能。然后我觉得也有可能是圈圈，然后我但我觉得我投入了4500，我不想弃了，我就去call了。然后结果flop还给我发了一张勾，turn上变成了卡顺，好像就是十。发成勾九八这种啊。然后但是最后没发出来，然后他是圈圈。就这个我觉得是个还是个错误了，以后还是要避免这种错误，这一两天也会有这种问题

识别结果：
- 级别：100/200
- Hero 位置：BB
- Hero 手牌：JhTh
- 有效筹码：22000
- 本手输赢：-22400
- 对手位置：BTN
- 对手昵称：空
- 对手类型：待确认
- 公牌：runout 含 J，turn 出顺子听牌，具体牌面待确认
- 行动线总结：翻前：BTN R1000→Hero BB 3B4500→BTN AI22000→Hero C；runout 未跑赢
- 摊牌：BTN QQ
- 心路历程：Hero 觉得对手快速 all-in 不太像 AK，也可能是 AK/AQ/QQ；因为已投入 4500 不想弃而 call，复盘认为这是错误。
- 标签：明显错误、3Bet池
- 待确认：“UTG 有个余定碰”是否只是桌况；具体 runout；对手类型。
- 确认：“UTG 有个余定碰”是 有个鱼limp；具体 runout J976；对手类型。

#### 手牌 #2 — TcKc 【-14000】

原始语音文本

> 这首十K。草花呢，是我在200 400打的。然后Button开，Button是一条鱼，当时对这个牌是300 600打的。对，300 600打的。然后，当时是四人桌，桌上有一个鱼，所以在打。然后这个牌是他在Button开，我在小盲拿这个牌，然后我对他作为他开1500，作为3B到8000。他call，flop发十六七，然后六七是草花，我是中对买买花嘛，我就check了。我本来是想打个check raise的，因为我们俩后手有效可能是有七八万这样8万这样吧，应该是。所以我觉得是可以这样打。然后他打，他就结果他也check了。然后转牌掉了个9，黑桃9，单八成顺嘛。然后我打了个6000，bet了个小注6000，他call。然后合牌掉了个黑桃A。啊。然后我觉得我在这边去打一个阻止注，阻止注没有意义。他一些比我小的牌啊，他也会弃掉，不会去call了。但是而且他，我觉得他范围里有一部分8吧，就是但是比较少，比较少的8。比如说我去打一个小注，他去raise我，就把自己陷入到一个很难的绝境。所以我这牌是打算做一个check call的，因为A是我的一个范围。结果我check了之后，锅里面2万8，他打了一个3万。那在我的范围优势上，他去打一个这么大的注，我觉得那他一定是有强牌了。但是结合前面的，我觉得他有可能是一些两对的牌。比如说A6啊、A7呀。甚至是A9，这种两对牌，我觉得可能是这种，所以我想了一下，我就ch-还是check fold了面对他

识别结果：
- 级别：300/600
- 人数：4
- Hero 位置：SB
- Hero 手牌：TcKc
- 有效筹码：80000
- 本手输赢：-14000
- 对手位置：BTN
- 对手类型：鱼
- 当前底池：river 前锅 28000
- 公牌：flop T67（6c7c），turn 9s，river As
- 行动线总结：翻前：BTN R1500→Hero SB 3B8000→BTN C；翻牌 T67：Hero X→BTN X；转牌 9s：Hero B6000→BTN C；河牌 As：Hero X→BTN B30000→Hero F
- 心路历程：Hero flop 有中对加买花，原计划 check-raise；river 认为阻止注没有意义，且对手大注更像强牌或两对，最终 check-fold。
- 标签：可优化、3Bet池
- 待确认：flop 是否 T♣6♣7x；river 面对 30000 是否记为 overbet/pot+。
- 确认：flop 是否 Tx6♣7♣；river 面对 30000 是记为 overbet/pot+。
#### 手牌 #3 — AKs 【+9000】

原始语音文本

> 这牌是当时打200、400，然后COV的有个rag儿call open的。我在小盲，做了个3比1，因为我们俩有效太深了，都有20万。我觉得我这边做一个小三比就好了，然后翻后去控池他。所以我3比到4500，他call。然后flop发18、3，然后有两张红桃，我买花嘛。我check，他打了个半池4500，我check call。转牌掉个草花圈，我check，他很快check。然后river又掉张红桃圈。我成了同花顺。我觉得我在这边打没有意义，因为他一些比我就是比较弱的牌，他不会去call了。但我check之后呢，比如他有些是，勾圈买花，勾圈买，Flop勾圈卡顺嘛。我觉得他这边成了三条圈的话，我check之后，他肯定是要三条圈肯定要打他，然后我去check raise，才能从这种牌里去收一些价值。所以我就check，结果他很快也check，然后我showdown，我赢了

识别结果：
- 级别：200/400
- Hero 位置：SB
- Hero 手牌：AKs，红桃可能性高
- 有效筹码：200000
- 本手输赢：+9000
- 对手位置：CO
- 对手类型：call open 较宽玩家
- 公牌：flop A83 两红桃，turn Qc，river Qh
- 行动线总结：翻前：CO R/C?→Hero SB 3B4500→CO C；翻牌 A83hh：Hero X→CO B4500→Hero C；转牌 Qc：Hero X→CO X；河牌 Qh：Hero X→CO X
- 心路历程：Hero 因双方 20 万深筹码选择小 3B 控池；river 成强牌后认为下注难拿到弱牌支付，选择 check 诱导 Qx/三条 Q 或 bluff 后再 check-raise。
- 标签：精彩、深筹码、3Bet池
- 待确认：CO 是 open 还是 call open 后 Hero squeeze；Hero AK 是否红桃同色；river 是同花顺还是普通同花。
- 确认：CO 是 open；Hero AK 是红桃同色；flop 应该是T83 18是我语音说的十八 识别成了18 实际上是T8， river 普通同花。

### 2026-05-16

#### 手牌 #1 — TKs 【+85000】

原始语音文本

> 10K这手牌，然后打的是300、600，枪口位那个0305那个鱼open，然后169 call 1500，我squeeze到6000，那个鱼call，169 call，然后flop发圈、9、6彩虹应该是，然后全部check。 turn掉个勾，我成了nuts顺。然后前卫那个05、03跳出来打1000，1万4。他后手总共有8万的码。169 fold。我在这边想，是call他呢？还是raise还是推all in？首先我觉得call，因为还有当时探上这个出来有后门方板花张，就有可能他是买花，让他实现去实现权益。而且后门出了方块之后，我觉得可能有一些他的顶对啊，他可能会不支付我了，miss value。然后如果raise呢？我觉得也不好。他可能raise完他call住，合牌可能面对我的bet，他也可能弃牌了。所以我在想，这边我就直接推all in了。然后他很快call，他应该是个set吧，或者两对啊之类的。然后合牌发一张白板。好像发了个3什么的，然后我赢了

识别结果：
- 级别：300/600
- Hero 位置：待确认 确实没说
- Hero 手牌：KTs
- 有效筹码：80000（对手）
- 本手输赢：+85000
- 对手位置：UTG
- 对手昵称：0305 / 0503 应该是口误 实际上是一个人
- 对手类型：鱼
- 公牌：flop Q96 rainbow，turn J，river blank / 3x
- 行动线总结：翻前：UTG 0305 R1500→169 C1500→Hero SQZ6000→0305 C→169 C；翻牌 Q96r：all X；转牌 J：0305 B14000→169 F→Hero AI→0305 C；river runout blank
- 心路历程：Hero 认为 call 会让后门方块/顶对实现权益且可能 miss value；普通 raise 又可能让对手 river 弃牌，所以转牌成 nuts 后直接 all-in 获取最大价值和保护。
- 标签：精彩、价值下注、多人池
- 确认：Hero 位置 确实没说 ，识别后空着 然后手工补充；对手昵称统一 0305 还是 0503 是口误 应该是一个人；对手摊牌是 set/两对还是推测 是推测应该set；river 我说白板的意思是没有改变牌面关系的一张牌，就是不组成顺子和同花的手牌，可以在这个范围内随机一张牌。

#### 手牌 #2 — JJ 【-15000】

原始语音文本

> 勾勾是169在巴腾开1500，我在这个大盲位上，有效可能有12万这样吧。然后我就3B到9000，他call。Flop发圈、2、3，2、3是黑桃，然后我有一个黑桃勾，打个6000，他直接raise到2万4。首先呢，我觉得这个牌我在OP没有位置，即使我现在是领先的，但是我有一个帽子去抓169的这个基因，还是冒蛮大风险的。然后他其实他还剩很多的，以后呢，面对他的时候还是要保护我的中等范围，以免他乱来，然后把我的权益打掉了。这牌我不想去打。用这个牌去在这个呃这个底池里打这么大的炮，所以我直接就弃掉了

识别结果：
- 级别：继承当前 session
- Hero 位置：BB
- Hero 手牌：JsJx
- 有效筹码：120000
- 本手输赢：-15000
- 对手位置：BTN
- 对手昵称：169
- 对手类型：待确认
- 公牌：flop Q23 多黑桃待确认
- 行动线总结：翻前：BTN 169 R1500→Hero BB 3B9000→BTN C；翻牌 Q23sss?：Hero B6000→BTN R24000→Hero F
- 心路历程：Hero 认为 OOP 即使领先也很难继续，担心 169 用较宽/乱来的范围打掉中等牌权益，因此选择 fold。
- 标签：可优化、3Bet池
- 待确认：session 级别；flop 花色；169 类型。

#### 手牌 #5 — J9s 【-9000】

原始语音文本

> 这个9勾也是面对169，我在UTG+1开，然后弃到他大盲，他就raise到9000。我有位置，我觉得他翻后打得不好。正常如果这个牌我对上一个好raiser可能直接弃掉。但我觉得对上他，一旦我击中大牌的话，还是能够从他身上拿一些价值。然后我靠了，flop发圈66彩虹，他check，我也check。转牌掉一张8，红桃8。我又没有买后门花，只是卡顺，然后败了个一万多，我直接弃掉

识别结果：
- 级别：继承当前 session
- Hero 位置：UTG+1
- Hero 手牌：J9s
- 本手输赢：-9000
- 对手位置：BB
- 对手昵称：169
- 对手类型：翻后较差 / 待确认
- 公牌：flop Q66 rainbow，turn 8h，river 空
- 行动线总结：翻前：Hero UTG+1 R→BB 169 3B9000→Hero C；翻牌 Q66r：BB X→Hero X；转牌 8h：BB B10000+→Hero F
- 心路历程：Hero 认为如果对手是好 raiser 可以直接弃，但 169 翻后较差，击中大牌可拿价值，所以翻前有位置 call；turn 权益不足 fold。
- 标签：可优化
- 待确认：turn 下注是否 10000+；session 级别。

#### 手牌 #6 — AK 【+53000】

原始语音文本

> 这个圈圈呢，是我当时那个巴巴卡，那个叫，反正打得满紧的那个巴巴卡，他加进来，然后他UTG开，我在跟他离两个人的位置，也就是MP吧，我做了一个3B到，他开1200，我做3B到4000，然后我下家一条鱼扣的call 4000，这个巴巴卡跳起来raise到21500。我觉得这个赛子很大，他总共就8万的有效。我觉得可能很像是AK的牌，当然也不可，也不排除可能有KK啊这种。但我就不想翻牌前跟他打光，而且我后面扣的call那个鱼也是个短码，他只有4万的码。所以我并不怕，比如说他推进来，或者他call啊，这种。所以我就我觉得，我这个翻牌前我想了蛮久，最后我就call了这个21500。然后下家扣的call那条鱼弃了。然后flop发K圈三，有买黑桃花，有两张黑桃。然后他打了一个c bet了个15000，我call。然后转牌掉张4，他check了，我也check了。然后我当时锅里面已经有7万了吧，但是他后手只有4万，4万多。我觉得在这边也没必要打，而且他一些买牌，他也不会过牌给我，就是不，不用担心去让对方免费世界equity。所以我，他check之后我也check，然后转牌掉一个白板，掉个什么6啊这种，然后他直接推all in，我秒call了。他是set 4，就翻牌前的44

识别结果：
- 级别：继承当前 session
- Hero 位置：MP
- Hero 手牌：AK
- 有效筹码：80000（主对手），后位鱼约 40000
- 本手输赢：+53000
- 对手位置：UTG
- 对手昵称：巴巴卡
- 对手类型：紧
- 公牌：flop KQ3 两黑桃，turn 4，river 6 / blank
- 行动线总结：翻前：UTG 巴巴卡 R1200→Hero MP 3B4000→后位鱼 C4000→UTG 4B21500→Hero C→鱼 F；翻牌 KQ3ss：UTG B15000→Hero C；转牌 4：UTG X→Hero X；河牌 blank：UTG AI40000+→Hero C
- 摊牌：UTG 44
- 心路历程：Hero 认为 UTG 大 4B 很像 AK，也可能 KK；不想翻前打光且后位短码鱼威胁不大，所以 call。turn 对手后手较少，买牌不会免费实现太多权益，因此 check back。
- 标签：Hero Call、深筹码、4Bet池
- 待确认：标题 AK 和原文“圈圈”冲突，是否按 AK；session 级别；river 具体牌。

### 2026-05-17

#### 手牌 #2 — KK 【+20000】

原始语音文本

> 逐一过吧。先说第一手KK。KK是一去的时候，桌子很好。然后有一个特别鱼的老板应该是。然后就开的500、1000嘛，打了一个半小时。然后我整没什么牌，就没怎么动。然后打了一手这个KK，这个KK我在前位limp，然后那个Jason也limp。结果老板跑去上厕所了，这手牌他不在。然后button那条鱼开3000，小盲扣的call 3000，然后大盲跳出来raise到1万4。我想这个牌我还是要肯定是要隔离的嘛。但我会有15万嘛。然后大妈那个NG她比我多，所以我就limp 4BB到3万7，然后都fold了

识别结果：
- 级别：500/1000
- Hero 位置：EP / UTG 待确认
- Hero 手牌：KK
- 有效筹码：150000
- 本手输赢：+20000
- 对手位置：BB
- 对手昵称：NG?
- 对手类型：待确认
- 公牌：无
- 行动线总结：翻前：Hero EP limp→Jason limp→BTN R3000→SB C3000→BB R14000→Hero limp-4B37000→all F
- 心路历程：Hero 用 KK 设计 limp-trap/limp-4B 隔离加注者，翻前直接拿下。
- 标签：价值下注
- 待确认：BB 昵称是否 NG；Hero 具体位置；“limp 4BB 到 3万7”是否是 limp-4bet 到 37000。

#### 手牌 #3 — KK 【+70000】

原始语音文本

> 第二手KK是当时打300、600，然后那个61那条鱼在。这牌是我，他在UTG开1500，当时短桌好像是五人桌吧。 fold到我，我大盲，我3b到9000，他可能有效是7万这样。然后他直接推我，我秒call。他是AK，然后没发出来，我我赢了

识别结果：
- 级别：300/600
- 人数：5
- Hero 位置：BB
- Hero 手牌：KK
- 有效筹码：70000
- 本手输赢：+70000
- 对手位置：UTG
- 对手昵称：61
- 对手类型：鱼
- 公牌：无，all-in runout 未记录
- 行动线总结：翻前：UTG 61 R1500→folds to Hero BB→Hero 3B9000→UTG AI→Hero C
- 摊牌：UTG AK
- 心路历程：Hero 面对 UTG 鱼的 open 和 shove，用 KK 正常 3B/call all-in。
- 标签：精彩、3Bet池
- 待确认：如果准确，可直接写“确认”。

#### 手牌 #4 — JJ 【-17000】

原始语音文本

> 这个勾勾呢，是当时包了桌打会，没有桌子，等到最后又开了张三六，三百六百。然后这个牌是fold到我小盲，然后大盲是那个Kevin，他是要打的。然后我就open了3000，他call。flop发圈八二，两张方块。我是两张黑的黑的勾。然后我check，他打了个4000，我靠， check call。转牌掉7。我check，打了个1万，我check call。然后河牌掉了个10。我check，打了个2万8。我想了半天弃了。首先呢，我觉得这个人，Kevin这个人呢，他还是很紧的，不会去投机的。即使这个牌呢，我想不明白，但我觉得还是要fold。就是当时我有考虑，就觉得他肯定是要么两对以上的牌力，要么是买花miss吧。但对于他的类型，我倾向于是两对以上的牌力。但是又没有，感觉是没有圈10的。也可能是set吧，这种。然后反正合牌我fold掉了

识别结果：
- 级别：300/600
- Hero 位置：SB
- Hero 手牌：黑色 JJ
- 本手输赢：-17000
- 对手位置：BB
- 对手昵称：Kevin
- 对手类型：紧
- 公牌：flop Q82 两方块，turn 7，river T
- 行动线总结：翻前：folds to Hero SB R3000→BB Kevin C；翻牌 Q82dd：Hero X→BB B4000→Hero C；转牌 7：Hero X→BB B10000→Hero C；河牌 T：Hero X→BB B28000→Hero F
- 心路历程：Hero 认为 Kevin 偏紧，不会乱投机；虽然存在 miss draw，但对手三街更偏价值，最终 fold。
- 标签：Hero Call、可优化
- 待确认：river T 花色；标签是否合适。

#### 手牌 #6 — 78s 【-7500】

原始语音文本

> 78红桃这手牌是我在UTG+1开，然后fold到大盲，这个小鱼在做了一个3B到7500，我俩有效200个BB嘛，我就call了。然后flop发923彩虹，我又买后门花，后门是，他败了一个2/3吧。然后我想看一下solver这个地方是不是要call去缠打他

识别结果：
- 级别：继承当前 session
- Hero 位置：UTG+1
- Hero 手牌：7h8h
- 有效筹码：200BB
- 本手输赢：-7500
- 对手位置：BB
- 对手类型：小鱼
- 公牌：flop 923 rainbow
- 行动线总结：翻前：Hero UTG+1 R→BB 小鱼 3B7500→Hero C?；翻牌 923r：BB B67%pot→Hero ?
- 心路历程：Hero 有后门花，想确认面对 flop 2/3 下注是否可以 call 继续缠打。
- 标签：可优化
- 待确认：Hero 最后 flop 是 fold 吗；session 级别。

### 2026-05-26

#### 手牌 #1 — 78s 【-6000】

原始语音文本

> 七八方块这牌当时打的是200、400。然后我在枪口位开，桌上有一条鱼，他是跟我隔一家，就在我下下家，他什么牌都会call open，就是靠玩很，玩很松嘛。这个这个牌我枪口位开，他又call。发圈、K、8，两张黑桃吧。然后我check，他check。转牌又掉张黑桃三这种，我直接打了一个两倍超炮，打了个5000，锅里面是2000、2600这样，然后他call。我看了一眼牌， call。就是马脚挺明显，就是明显是买牌嘛。然后合牌结果掉张草花A。我是怕我在这边打，偷不掉他。就他买A黑桃的这些牌，然后中了A之后，他不会弃，他会call。然后所以就没有偷，我就check了，然后他也check了，结果他是A6杂色

识别结果：
- 级别：200/400
- Hero 位置：UTG
- Hero 手牌：7d8d
- 本手输赢：-6000
- 对手位置：待确认
- 对手类型：松鱼
- 公牌：flop QK8 两黑桃，turn 3s，river Ac
- 行动线总结：翻前：Hero UTG R→松鱼 C；翻牌 QK8ss：Hero X→松鱼 X；转牌 3s：Hero B5000(overbet)→松鱼 C；河牌 Ac：Hero X→松鱼 X
- 摊牌：villain A6o
- 心路历程：Hero 转牌用超池攻击明显听牌/现场信息；river A 命中对手很多 A-high 黑桃听牌，因此放弃。
- 标签：诈唬、可优化
- 待确认：open size；turn 5000 是否约 200% pot；对手具体位置。

#### 手牌 #2 — A6s 【-11500¥】

原始语音文本

> 这个A6呢，也是跟这个鱼打的。这个也是我在，而我在中位open的，然后他在button call。Flop发883彩虹，我check，他也check。不是彩虹，是883两张草花好像。然后转牌掉个6，我打了个翻牌前是open 1000嘛，然后turn上我是打了个1500，他call。合牌掉个2，就45是顺子了。然后我打了个3000，对，打了个3000，锅里有5000，打了个3000，他raise到9000。但是我想我这牌应该就输45一手牌，我觉得没有那么巧吧。然后我就call了，结果鱼是8、10红桃，对，他flop中了三条，然后在买花面，他都没有打

识别结果：
- 级别：继承当前 session
- Hero 位置：MP
- Hero 手牌：A6s
- 本手输赢：-11500
- 对手位置：BTN
- 对手类型：鱼
- 公牌：flop 883 两草花，turn 6，river 2
- 行动线总结：翻前：Hero MP R1000→BTN C；翻牌 883cc：Hero X→BTN X；转牌 6：Hero B1500→BTN C；河牌 2：Hero B3000→BTN R9000→Hero C
- 摊牌：BTN T8hh
- 心路历程：Hero 认为 river 主要只输 45，概率不高，因此 call；结果对手 slowplay trips。
- 标签：Hero Call、可优化
- 待确认：Hero A6s 花色；是否继承 200/400 session。

#### 手牌 #3 — TJs 【+18000¥】

原始语音文本

> 这牌是巴腾那个鱼老外，一个年轻的小伙。我对他的印象还不是很深，不知道他叫什么，之后再补充吧。然后他巴腾open 1000，我在我在小盲，他在CO位open 1000，我在小盲，3B他4500。因为我们俩有效都蛮深的，有12，十四五万吧，就300BB以上，所以我open 3B的小一点。然后他call，flop发10、9、7，彩虹。然后我选择了check call，我check，他打了一个半pot 5000，我check call。转牌掉8。然后有买后门红桃，我check，他打了，2万的锅子打了一个8000，我check call，合牌掉5，草花5白板，我check，他也check了。然后呢我秀牌，我是单张顺嘛，就是勾圈是nuts顺，我是有勾嘛。然后他muck

识别结果：
- 级别：继承当前 session
- Hero 位置：SB
- Hero 手牌：JTs
- 有效筹码：120000-150000
- 本手输赢：+18000
- 对手位置：CO/BTN 待确认
- 对手类型：鱼 / 年轻外国玩家
- 公牌：flop T97 rainbow，turn 8（后门红桃），river 5c
- 行动线总结：翻前：CO/BTN R1000→Hero SB 3B4500→villain C；翻牌 T97r：Hero X→villain B5000→Hero C；转牌 8：Hero X→villain B8000→Hero C；河牌 5c：Hero X→villain X
- 摊牌：Hero J-high straight，villain muck
- 心路历程：Hero 深筹码用小 3B 控池；flop/turn 用对子加听牌/顺子权益 check-call，river 选择 check 后摊牌赢。
- 标签：精彩、3Bet池、深筹码
- 待确认：对手位置 CO 还是 BTN；Hero JTs 花色；session 级别。

#### 手牌 #4 — AA 【+31000¥】

原始语音文本

> 这AA是当时UDG那个法国Polo Open，然后CY在在COV对他做了一个3B到3500。然后我在巴特，我想了一下，因为我们筹码都蛮深的。我就我这边去扣的4B到8500，我觉得意义不太大。我就call了3500。因为法国那个UDG那个法国人他有点乱搞的，他可能会去可能会去四，可能会去5B抢这个池的，我觉得可能会4B抢这个池的，所以我就扣的call 3B了。然后，结果法国人弃了，fro法八七，八七四。对，然后五六是NAS，然后他check，我也check。他没打，我也，我觉得我在这边也没必要打了，要去控池了，那就如果这种球，如果是一个扣call 3B到这么深筹码，然后我也check了。然后转牌掉了个白板二这种牌，然后他打了个过滤器，前面打了个6500，挺蛮重的。我觉得我call就好， call。然后合牌掉一个，又掉个A出来。那么我成了最大的三条。我觉得在这边我觉得他是没有一些顺子，他顺子肯定会打的。然后他打了个满炮21000，我觉得我这边想引诱他做一些bluff，我就min raise到4万。结果他弃掉。这边明显他是一些空气牌，这边他有一些牌他没必要打，我觉得他可能K圈啊、10 K啊、K勾啊这种牌吧 然后这个发现就是这个CY他打了大局之后，现在打小局，下来打小局，就是会偷鸡的时候会偷得很重，而且会连续开枪，连续开两枪、连续开三枪。然后开打都是打比较重的size

识别结果：
- 级别：继承当前 session
- Hero 位置：BTN
- Hero 手牌：AA
- 本手输赢：+31000
- 对手位置：CO
- 对手昵称：CY
- 对手类型：待确认
- 公牌：flop 待确认（疑似 874），turn 2，river A
- 行动线总结：翻前：UTG Polo R→CO CY 3B3500→Hero BTN C3500→UTG F；翻牌 ?：CY X→Hero X；转牌 2：CY B6500→Hero C；河牌 A：CY B21000→Hero R40000→CY F
- 心路历程：Hero 深筹码用 AA 平跟 3B，想给 UTG/Polo 留 back-raise 或继续入池空间；river 成三条 A 后小 raise，目标是从 CY 大注范围中榨取价值。
- 标签：精彩、3Bet池、深筹码
- 待确认：flop 具体是否 874；“过滤器”是什么语音误识别；session 级别。

#### 手牌 #5 — KJs 【-25000】

原始语音文本

> 这手牌是当时我在大盲位，然后这个牌是300、600。然后Button open，Button是一个reg，亚洲的，然后是一个年轻的亚洲人，然后开1000。我在大盲，然后这个牌是大盲，然后call 1000。然后flop发K、7、3，彩虹。我中了顶对K，然后带一个后门花，后门是红桃。他打了个1万3，满炮。我想了一下，因为他在button开，他的范围很宽，满炮1万3，我想了想call了一下。然后turn掉个9，他check，我也check。然后合牌掉个2，他又打了一个满炮，3万9。我想了想，我觉得他范围里还是有一些miss的，有一些miss的牌，但也有一些顶对，也有一些set。我想想还是弃了，因为我觉得他在button开1000的范围里，然后如果他是两对以上的牌力的话，他其实不需要打满炮的，所以我觉得他可能还是一些miss的牌，我觉得我还是fold掉了。结果他亮牌是勾圈杂色，纯空气。他这个是，他这个是第一次这样打，所以我没有办法去抓他。因为他之前也没有这么打过的记录

识别结果：
- 级别：300/600
- Hero 位置：BB
- Hero 手牌：KJs（有后门红桃）
- 本手输赢：-25000
- 对手位置：BTN
- 对手类型：年轻亚洲 reg
- 公牌：flop K73 rainbow，turn 9，river 2
- 行动线总结：翻前：BTN R1000→Hero BB C；翻牌 K73r：BTN B13000(pot)→Hero C；转牌 9：BTN X→Hero X；河牌 2：BTN B39000(pot)→Hero F
- 摊牌信息：BTN QJo bluff
- 心路历程：Hero 知道 BTN open 很宽，river 有 missed draw，但第一次见到这种 line，缺少历史信息，最终选择 fold。
- 标签：Bad Fold、可优化
- 待确认：flop pot bet 13000 是否漏了前面行动或底池信息；标签用 Bad Fold 还是可优化。

## 待确认牌谱

### 2026-05-12

#### 手牌 #1 — 66 【-44000¥】

原始语音文本

> 昨天不知道是怎么回事，可能总体状态都不好，感觉打得不好。这个牌是在200、400，然后当时跟那个胡总。他很乱搞的嘛，翻牌前很多3B、4B的。然后这个牌是COV call，然后Button call。我在小盲也拿66，我也call。开1400，call 1400，我在小盲也call 1400。然后他在大盲搞了个6600，squeeze 6600出来。然后COV和Button都fold了，我直接推all in，因为他短码，他就4万了嘛。结果他call他是AA，flop还发了345，我然后也没有跑赢

Agent 解析草案

- playedDate：2026-05-12
- stakeLevel：200/400
- playerCount / tableSize：待确认
- hasStraddle / straddleAmount：否 / 空
- heroPosition：SB
- heroCardsInput：66
- effectiveStack：40000
- potSize：待确认
- currentProfit：-44000
- opponentType：松凶娱乐玩家
- opponentName：胡总
- villainPosition：BB
- board：flop 345（花色待自动补），turn 空，river 空
- streetInputs：preflop actionLine = CO call1400→BTN call1400→Hero SB call1400→BB 胡总 squeeze6600→CO fold→BTN fold→Hero allin→BB call，pot 待确认；flop/turn/river 空
- streetSummary：翻前：CO C1400→BTN C1400→Hero SB C1400→BB 胡总 SQZ6600→CO F→BTN F→Hero AI→BB C；flop runout 345
- showdown：胡总 AA
- mindJourney：Hero 认为胡总翻前 3B/4B 很乱且只有约 4 万短码，所以用 66 面对 squeeze 选择直接 all-in。
- tags：可优化

需要你确认

- COV 是 CO 位 limp/call 1400，对吗？
- 这手 potSize 要按两家 all-in 约 80000/88000 估，还是先留空？
- tags 用“可优化”还是“明显错误”？

#### 手牌 #2 — AK 【-8300¥】

原始语音文本

> AK是个鱼在中位open吧，我在小盲拿到AK同色，我对他做个3 bet 5000，他有效10万嘛。然后他call，flop发个勾56彩虹，我打个3300，1/3，他call。转牌又掉张勾，还是彩虹，没有后门花兆，我check了，打了个1万6的锅，打了一个6000多，我check fold了

Agent 解析草案

- playedDate：2026-05-12
- stakeLevel：继承当前 session
- playerCount / tableSize：待确认
- hasStraddle / straddleAmount：空
- heroPosition：SB
- heroCardsInput：AKs
- effectiveStack：100000
- potSize：16000（turn 入口锅，按原文）
- currentProfit：-8300
- opponentType：鱼
- opponentName：空
- villainPosition：MP
- board：flop J56 rainbow，turn J，river 空
- streetInputs：preflop = MP 鱼 open→Hero SB 3B5000→MP call；flop = Hero bet3300→MP call；turn = Hero check→MP bet6000+→Hero fold；river 空
- streetSummary：翻前：MP R?→Hero SB 3B5000→MP C；翻牌 J56r：Hero B3300→MP C；转牌 J：Hero X→MP B6000+→Hero F
- showdown：空
- mindJourney：Hero 认为转牌第二张 J 且没有后门花，继续打/跟价值不足，因此 check-fold。
- tags：可优化

需要你确认

- “鱼在中位 open”是否按 MP 记录？
- 转牌下注记 6000 还是 6000+？
- 这手继承的 session 级别是多少？

#### 手牌 #3 — QQ 【-34500¥】

原始语音文本

> 这个圈圈是换到300、600，然后我在前位开，应该是COV call，然后这个鱼在小盲位call，然后大盲位call，四人底池。Flop发个2、3、6，两张方块，我有方块圈。我打了个半pot，打了个3000，然后COV call 3000，小盲这个鱼跳出了raise 6000，大盲弃牌。然后COV这个人只有4万码，我在想要不要再蕊，把那个后面短码那隔离掉，我想算了，因为这边这个小盲这个鱼，我这个牌还是挺边缘的，所以我接下来要call一下，call了然后COV弃牌了。转牌掉了个方块3，就有葫芦面了，但是花也出来了。然后小盲这个鱼很快也过牌了，那我也过牌了，后卫。但我现在想是不是转牌的时候应该要打一下，打个轻注，然后合牌求收档呢？如果被raise的话，可以轻松fold掉了。因为鱼应该没有这么高thinking level。然后但我check了。然后合牌掉了个草花7，白板牌。然后鱼打了，他就是又用眼睛向上瞅，然后在那算。这种马脚感觉是不是很大的牌力，中等牌力的一个马脚嘛。然后但是他打了一个pot size，所以我就call了。结果他是A勾方块，nuts花

Agent 解析草案

- playedDate：2026-05-12
- stakeLevel：300/600
- playerCount / tableSize：待确认
- heroPosition：EP / 前位
- heroCardsInput：QQ（含方块 Q）
- effectiveStack：待确认
- potSize：待确认
- currentProfit：-34500
- opponentType：鱼
- opponentName：空
- villainPosition：SB
- board：flop 2d3d6x，turn 3d，river 7c
- streetInputs：preflop = Hero EP open→CO call→SB 鱼 call→BB call；flop = Hero bet3000→CO call3000→SB raise6000→BB fold→Hero call→CO fold；turn = SB check→Hero check；river = SB pot bet→Hero call
- streetSummary：翻前：Hero EP R→CO C→SB C→BB C；翻牌 2d3d6x：Hero B3000→CO C3000→SB R6000→BB F→Hero C→CO F；转牌 3d：SB X→Hero X；河牌 7c：SB B100%pot→Hero C
- showdown：SB A♦J♦，nuts flush
- mindJourney：Hero 认为 QQ 在多人池较边缘，没有再 raise 隔离短码；转牌复盘觉得可用轻注薄价值/保护，若被 raise 可以轻松 fold；河牌因对手现场马脚和 pot bet 选择 call。
- tags：多人池、可优化

需要你确认

- Hero 前位具体是 UTG、UTG+1 还是 EP？
- flop 第三张 6 的花色可以自动补非方块吗？
- river pot bet 的具体金额是否知道？

#### 手牌 #4 — QJo 【-22500¥】

原始语音文本

> 这个勾圈是杂色。这个牌当时我在UTG open，然后button那条鱼call，然后小盲这个这个鱼跳出来raise 3，squeeze到4500，很小一个size。他很乱来的嘛，也不知道不知道他具体什么牌力。然后我觉得我，这会我刚补了码，我有十几万，我觉得要跟他，要跟他那个单挑。然后我就raise到15000，我觉得我这个牌不能call，对，我这勾圈肯定不能call嘛，但是也不想弃，我就再raise到15000，然后button那个鱼fold了，然后小盲这个鱼call 15000，flop发10、16。两张方块，我没有方块。他check给我打了一个7500，1/4。他check call，turn掉了一个4，好像是草花4吧。结果他直接all in出来了，all in二十几万。他可能没看到我后手有十几万。然后我也啥也没有嘛，我只能弃了。他这边，这个牌，哎呀，这个鱼是挺鱼的，但我没有运气。这个牌我有一张10，我有葫芦都easy call了，就蛮好的。但是没有运气嘛。然后这个鱼打完这手牌就走了

Agent 解析草案

- playedDate：2026-05-12
- stakeLevel：继承当前 session
- heroPosition：UTG
- heroCardsInput：QJo
- effectiveStack：十几万（建议留空或约 100000+）
- potSize：待确认
- currentProfit：-22500
- opponentType：鱼 / 松凶
- opponentName：空
- villainPosition：SB
- board：flop T6x 两方块（原文“10、16”需确认），turn 4c，river 空
- streetInputs：preflop = Hero UTG open→BTN 鱼 call→SB 鱼 squeeze4500→Hero 4B15000→BTN fold→SB call；flop = SB check→Hero bet7500→SB call；turn = SB allin→Hero fold
- streetSummary：翻前：Hero UTG R→BTN C→SB SQZ4500→Hero 4B15000→BTN F→SB C；翻牌 T6xdd：SB X→Hero B7500→SB C；转牌 4c：SB AI→Hero F
- showdown：空
- mindJourney：Hero 觉得 QJo 不适合 call，但也不想直接弃，选择 4B 隔离松凶 SB 鱼；turn 无牌面对超大 all-in 只能弃牌。
- tags：明显错误、诈唬

需要你确认

- flop “10、16”到底是哪三张牌？
- 这手是否继承当前 session 级别？
- tags 是否标“明显错误”，还是只标“可优化/诈唬”？

### 2026-05-14

#### 手牌 #1 — JTs  -22400

原始语音文本

> 这个10勾红桃是在100、200打的，因为没有桌子嘛，然后在等位，等开桌，就打了会100、200。100、200的后备桌，但是这张桌子很好，桌上有五六个不会玩的人，然后这个牌 uTG有个余定碰的，然后到button，button这个人开1000，我在大盲拿到10勾红桃，我raise到4500，他有2万2这样。因为他，我想他可能是用一个position raise，说我想抢这个瓷钱，结果他推出来了。推出来了，我想了一会，我觉得他推得很快，我觉得他AK也不会推那么快，我觉得可能是AK啊、A圈啊，也有可能。然后我觉得也有可能是圈圈，然后我但我觉得我投入了4500，我不想弃了，我就去call了。然后结果flop还给我发了一张勾，turn上变成了卡顺，好像就是十。发成勾九八这种啊。然后但是最后没发出来，然后他是圈圈。就这个我觉得是个还是个错误了，以后还是要避免这种错误，这一两天也会有这种问题

Agent 解析草案

- playedDate：2026-05-14
- stakeLevel：100/200
- heroPosition：BB
- heroCardsInput：JhTh
- effectiveStack：22000
- potSize：待确认
- currentProfit：-22400
- opponentType：待确认
- opponentName：空
- villainPosition：BTN
- board：flop 含 J，turn 出顺子听牌，具体待确认；river 空
- streetInputs：preflop = BTN open1000→Hero BB 3B4500→BTN allin→Hero call；postflop runout only
- streetSummary：翻前：BTN R1000→Hero BB 3B4500→BTN AI22000→Hero C；runout 未跑赢
- showdown：BTN QQ
- mindJourney：Hero 觉得对手快速 all-in 不太像 AK，也可能是 AK/AQ/QQ；因为已投入 4500 不想弃而 call，复盘认为这是错误。
- tags：明显错误、3Bet池

需要你确认

- “UTG 有个余定碰”只是桌况，不进入行动线，对吗？
- flop/turn/runout 具体牌面是否还记得？
- 对手类型是否要填“鱼/不会玩的人”，还是留空？

#### 手牌 #2 — TcKc -14000

原始语音文本

> 这首十K。草花呢，是我在200 400打的。然后Button开，Button是一条鱼，当时对这个牌是300 600打的。对，300 600打的。然后，当时是四人桌，桌上有一个鱼，所以在打。然后这个牌是他在Button开，我在小盲拿这个牌，然后我对他作为他开1500，作为3B到8000。他call，flop发十六七，然后六七是草花，我是中对买买花嘛，我就check了。我本来是想打个check raise的，因为我们俩后手有效可能是有七八万这样8万这样吧，应该是。所以我觉得是可以这样打。然后他打，他就结果他也check了。然后转牌掉了个9，黑桃9，单八成顺嘛。然后我打了个6000，bet了个小注6000，他call。然后合牌掉了个黑桃A。啊。然后我觉得我在这边去打一个阻止注，阻止注没有意义。他一些比我小的牌啊，他也会弃掉，不会去call了。但是而且他，我觉得他范围里有一部分8吧，就是但是比较少，比较少的8。比如说我去打一个小注，他去raise我，就把自己陷入到一个很难的绝境。所以我这牌是打算做一个check call的，因为A是我的一个范围。结果我check了之后，锅里面2万8，他打了一个3万。那在我的范围优势上，他去打一个这么大的注，我觉得那他一定是有强牌了。但是结合前面的，我觉得他有可能是一些两对的牌。比如说A6啊、A7呀。甚至是A9，这种两对牌，我觉得可能是这种，所以我想了一下，我就ch-还是check fold了面对他

Agent 解析草案

- playedDate：2026-05-14
- stakeLevel：300/600
- playerCount / tableSize：4
- heroPosition：SB
- heroCardsInput：TcKc
- effectiveStack：80000
- potSize：28000（river 前锅，按原文）
- currentProfit：-14000
- opponentType：鱼
- opponentName：空
- villainPosition：BTN
- board：flop T67（6c7c），turn 9s，river As
- streetInputs：preflop = BTN open1500→Hero SB 3B8000→BTN call；flop = Hero check→BTN check；turn = Hero bet6000→BTN call；river = Hero check→BTN bet30000→Hero fold
- streetSummary：翻前：BTN R1500→Hero SB 3B8000→BTN C；翻牌 T67：Hero X→BTN X；转牌 9s：Hero B6000→BTN C；河牌 As：Hero X→BTN B30000→Hero F
- showdown：空
- mindJourney：Hero flop 有中对加买花，原计划 check-raise；river 认为阻止注没有意义，且对手大注更像强牌或两对，最终选择 check-fold。
- tags：可优化、3Bet池

需要你确认

- flop 是否 T♣6♣7x，Hero 为 T♣K♣？
- river 面对 30000 是否记录为 overbet/pot+？

#### 手牌 #3 — AKs +9000

原始语音文本

> 这牌是当时打200、400，然后COV的有个rag儿call open的。我在小盲，做了个3比1，因为我们俩有效太深了，都有20万。我觉得我这边做一个小三比就好了，然后翻后去控池他。所以我3比到4500，他call。然后flop发18、3，然后有两张红桃，我买花嘛。我check，他打了个半池4500，我check call。转牌掉个草花圈，我check，他很快check。然后river又掉张红桃圈。我成了同花顺。我觉得我在这边打没有意义，因为他一些比我就是比较弱的牌，他不会去call了。但我check之后呢，比如他有些是，勾圈买花，勾圈买，Flop勾圈卡顺嘛。我觉得他这边成了三条圈的话，我check之后，他肯定是要三条圈肯定要打他，然后我去check raise，才能从这种牌里去收一些价值。所以我就check，结果他很快也check，然后我showdown，我赢了

Agent 解析草案

- playedDate：2026-05-14
- stakeLevel：200/400
- heroPosition：SB
- heroCardsInput：AKs（红桃可能性高）
- effectiveStack：200000
- currentProfit：+9000
- opponentType：call open 较宽玩家
- opponentName：空
- villainPosition：CO
- board：flop A83 两红桃，turn Qc，river Qh
- streetInputs：preflop = CO call/open?→Hero SB 3B4500→CO call；flop = Hero check→CO bet4500→Hero call；turn = Hero check→CO check；river = Hero check→CO check
- streetSummary：翻前：CO R/C?→Hero SB 3B4500→CO C；翻牌 A83hh：Hero X→CO B4500→Hero C；转牌 Qc：Hero X→CO X；河牌 Qh：Hero X→CO X
- showdown：Hero 赢，具体对手牌未说明
- mindJourney：Hero 因双方 20 万深筹码选择小 3B 控池；river 成强牌后认为下注难拿到弱牌支付，选择 check 诱导 Qx/三条 Q 或 bluff 后再 check-raise。
- tags：精彩、深筹码、3Bet池

需要你确认

- 翻前 CO 是 open 还是 call open 后 Hero squeeze？
- Hero AK 是红桃同色吗？
- river 是同花顺还是普通同花？

### 2026-05-16

#### 手牌 #1 — TKs +85000

原始语音文本

> 10K这手牌，然后打的是300、600，枪口位那个0305那个鱼open，然后169 call 1500，我squeeze到6000，那个鱼call，169 call，然后flop发圈、9、6彩虹应该是，然后全部check。 turn掉个勾，我成了nuts顺。然后前卫那个05、03跳出来打1000，1万4。他后手总共有8万的码。169 fold。我在这边想，是call他呢？还是raise还是推all in？首先我觉得call，因为还有当时探上这个出来有后门方板花张，就有可能他是买花，让他实现去实现权益。而且后门出了方块之后，我觉得可能有一些他的顶对啊，他可能会不支付我了，miss value。然后如果raise呢？我觉得也不好。他可能raise完他call住，合牌可能面对我的bet，他也可能弃牌了。所以我在想，这边我就直接推all in了。然后他很快call，他应该是个set吧，或者两对啊之类的。然后合牌发一张白板。好像发了个3什么的，然后我赢了

Agent 解析草案

- playedDate：2026-05-16
- stakeLevel：300/600
- heroPosition：待确认
- heroCardsInput：KTs
- effectiveStack：80000（对手）
- currentProfit：+85000
- opponentType：鱼
- opponentName：0305 / 0503
- villainPosition：UTG
- board：flop Q96 rainbow，turn J，river blank / 3x
- streetInputs：preflop = UTG 0305 open1500→169 call1500→Hero squeeze6000→0305 call→169 call；flop = all check；turn = 0305 bet14000→169 fold→Hero allin→0305 call；river runout blank
- streetSummary：翻前：UTG 0305 R1500→169 C1500→Hero SQZ6000→0305 C→169 C；翻牌 Q96r：all X；转牌 J：0305 B14000→169 F→Hero AI→0305 C；river runout blank
- showdown：对手可能 set 或两对，未确认
- mindJourney：Hero 认为 call 会让后门方块/顶对实现权益且可能 miss value；普通 raise 又可能让对手 river 弃牌，所以转牌成 nuts 后直接 all-in 获取最大价值和保护。
- tags：精彩、价值下注、多人池

需要你确认

- Hero 当时位置是什么？
- 对手昵称统一记 0305 还是 0503？
- 对手摊牌到底是 set、两对，还是只是推测？
- river 白板具体是 3 吗？

#### 手牌 #2 — JJ  -15000

原始语音文本

> 勾勾是169在巴腾开1500，我在这个大盲位上，有效可能有12万这样吧。然后我就3B到9000，他call。Flop发圈、2、3，2、3是黑桃，然后我有一个黑桃勾，打个6000，他直接raise到2万4。首先呢，我觉得这个牌我在OP没有位置，即使我现在是领先的，但是我有一个帽子去抓169的这个基因，还是冒蛮大风险的。然后他其实他还剩很多的，以后呢，面对他的时候还是要保护我的中等范围，以免他乱来，然后把我的权益打掉了。这牌我不想去打。用这个牌去在这个呃这个底池里打这么大的炮，所以我直接就弃掉了

Agent 解析草案

- playedDate：2026-05-16
- stakeLevel：继承当前 session
- heroPosition：BB
- heroCardsInput：JsJx
- effectiveStack：120000
- currentProfit：-15000
- opponentType：待确认
- opponentName：169
- villainPosition：BTN
- board：flop Q23（两/三张黑桃待确认），turn 空，river 空
- streetInputs：preflop = BTN 169 open1500→Hero BB 3B9000→BTN call；flop = Hero bet6000→BTN raise24000→Hero fold
- streetSummary：翻前：BTN 169 R1500→Hero BB 3B9000→BTN C；翻牌 Q23sss?：Hero B6000→BTN R24000→Hero F
- showdown：空
- mindJourney：Hero 认为 OOP 即使领先也很难继续，担心 169 用较宽/乱来的范围打掉中等牌权益，因此选择 fold。
- tags：可优化、3Bet池

需要你确认

- 这手继承的 session 级别是多少？
- flop Q23 的花色具体是什么？
- 对 169 的类型要填鱼、松凶还是留空？

#### 手牌 #5 — 9js -9000

原始语音文本

> 这个9勾也是面对169，我在UTG+1开，然后弃到他大盲，他就raise到9000。我有位置，我觉得他翻后打得不好。正常如果这个牌我对上一个好raiser可能直接弃掉。但我觉得对上他，一旦我击中大牌的话，还是能够从他身上拿一些价值。然后我靠了，flop发圈66彩虹，他check，我也check。转牌掉一张8，红桃8。我又没有买后门花，只是卡顺，然后败了个一万多，我直接弃掉

Agent 解析草案

- playedDate：2026-05-16
- stakeLevel：继承当前 session
- heroPosition：UTG+1
- heroCardsInput：J9s
- currentProfit：-9000
- opponentType：翻后较差 / 待确认
- opponentName：169
- villainPosition：BB
- board：flop Q66 rainbow，turn 8h，river 空
- streetInputs：preflop = Hero UTG+1 open→BB 169 3B9000→Hero call；flop = BB check→Hero check；turn = BB bet10000+→Hero fold
- streetSummary：翻前：Hero UTG+1 R→BB 169 3B9000→Hero C；翻牌 Q66r：BB X→Hero X；转牌 8h：BB B10000+→Hero F
- showdown：空
- mindJourney：Hero 认为如果对手是好 raiser 可以直接弃，但 169 翻后较差，击中大牌可拿价值，所以翻前有位置 call；turn 权益不足 fold。
- tags：可优化

需要你确认

- turn 下注是否记为 10000+？
- 这手继承的 session 级别是多少？

#### 手牌 #6 — AK +53000

原始语音文本

> 这个圈圈呢，是我当时那个巴巴卡，那个叫，反正打得满紧的那个巴巴卡，他加进来，然后他UTG开，我在跟他离两个人的位置，也就是MP吧，我做了一个3B到，他开1200，我做3B到4000，然后我下家一条鱼扣的call 4000，这个巴巴卡跳起来raise到21500。我觉得这个赛子很大，他总共就8万的有效。我觉得可能很像是AK的牌，当然也不可，也不排除可能有KK啊这种。但我就不想翻牌前跟他打光，而且我后面扣的call那个鱼也是个短码，他只有4万的码。所以我并不怕，比如说他推进来，或者他call啊，这种。所以我就我觉得，我这个翻牌前我想了蛮久，最后我就call了这个21500。然后下家扣的call那条鱼弃了。然后flop发K圈三，有买黑桃花，有两张黑桃。然后他打了一个c bet了个15000，我call。然后转牌掉张4，他check了，我也check了。然后我当时锅里面已经有7万了吧，但是他后手只有4万，4万多。我觉得在这边也没必要打，而且他一些买牌，他也不会过牌给我，就是不，不用担心去让对方免费世界equity。所以我，他check之后我也check，然后转牌掉一个白板，掉个什么6啊这种，然后他直接推all in，我秒call了。他是set 4，就翻牌前的44

Agent 解析草案

- playedDate：2026-05-16
- stakeLevel：继承当前 session
- heroPosition：MP
- heroCardsInput：AK
- effectiveStack：80000（主对手），后位鱼约 40000
- currentProfit：+53000
- opponentType：紧
- opponentName：巴巴卡
- villainPosition：UTG
- board：flop KQ3 两黑桃，turn 4，river 6 / blank
- streetInputs：preflop = UTG 巴巴卡 open1200→Hero MP 3B4000→后位鱼 call4000→UTG 4B21500→Hero call→鱼 fold；flop = UTG bet15000→Hero call；turn = UTG check→Hero check；river = UTG allin40000+→Hero call
- streetSummary：翻前：UTG 巴巴卡 R1200→Hero MP 3B4000→后位鱼 C4000→UTG 4B21500→Hero C→鱼 F；翻牌 KQ3ss：UTG B15000→Hero C；转牌 4：UTG X→Hero X；河牌 blank：UTG AI40000+→Hero C
- showdown：UTG 44
- mindJourney：Hero 认为 UTG 大 4B 很像 AK，也可能 KK；不想翻前打光且后位短码鱼威胁不大，所以 call。turn 对手后手较少，买牌不会免费实现太多权益，因此 check back。
- tags：Hero Call、深筹码、4Bet池

需要你确认

- 标题是 AK，但原文开头像“圈圈”，最终按 AK 记录对吗？
- 这手继承的 session 级别是多少？
- river 具体白板是哪张？

### 2026-05-17

#### 手牌 #2 — KK +20000

原始语音文本

> 逐一过吧。先说第一手KK。KK是一去的时候，桌子很好。然后有一个特别鱼的老板应该是。然后就开的500、1000嘛，打了一个半小时。然后我整没什么牌，就没怎么动。然后打了一手这个KK，这个KK我在前位limp，然后那个Jason也limp。结果老板跑去上厕所了，这手牌他不在。然后button那条鱼开3000，小盲扣的call 3000，然后大盲跳出来raise到1万4。我想这个牌我还是要肯定是要隔离的嘛。但我会有15万嘛。然后大妈那个NG她比我多，所以我就limp 4BB到3万7，然后都fold了

Agent 解析草案

- playedDate：2026-05-17
- stakeLevel：500/1000
- heroPosition：EP / UTG 待确认
- heroCardsInput：KK
- effectiveStack：150000（Hero），BB/NG 覆盖
- currentProfit：+20000
- opponentType：待确认
- opponentName：NG?
- villainPosition：BB
- board：无
- streetInputs：preflop = Hero EP limp→Jason limp→BTN 鱼 open3000→SB call3000→BB raise14000→Hero limp-4B37000→all fold
- streetSummary：翻前：Hero EP limp→Jason limp→BTN R3000→SB C3000→BB R14000→Hero limp-4B37000→all F
- showdown：无
- mindJourney：Hero 用 KK 设计 limp-trap/limp-4B 隔离加注者，翻前直接拿下。
- tags：价值下注

需要你确认

- BB 对手昵称是 NG 吗？
- Hero 具体是 UTG 还是更宽泛前位？
- “limp 4BB 到 3万7”理解为 limp-4bet 到 37000，对吗？

#### 手牌 #3 — KK +70000

原始语音文本

> 第二手KK是当时打300、600，然后那个61那条鱼在。这牌是我，他在UTG开1500，当时短桌好像是五人桌吧。 fold到我，我大盲，我3b到9000，他可能有效是7万这样。然后他直接推我，我秒call。他是AK，然后没发出来，我我赢了

Agent 解析草案

- playedDate：2026-05-17
- stakeLevel：300/600
- playerCount / tableSize：5
- heroPosition：BB
- heroCardsInput：KK
- effectiveStack：70000
- currentProfit：+70000
- opponentType：鱼
- opponentName：61
- villainPosition：UTG
- board：无，all-in runout 未记录
- streetInputs：preflop = UTG 61 open1500→folds to Hero BB→Hero 3B9000→UTG allin→Hero call
- streetSummary：翻前：UTG 61 R1500→folds to Hero BB→Hero 3B9000→UTG AI→Hero C
- showdown：UTG AK
- mindJourney：Hero 面对 UTG 鱼的 open 和 shove，用 KK 正常 3B/call all-in。
- tags：精彩、3Bet池

需要你确认

- 这手没有明显待确认项；如果准确，可直接写“确认”。

#### 手牌 #4 — JJ  -17000

原始语音文本

> 这个勾勾呢，是当时包了桌打会，没有桌子，等到最后又开了张三六，三百六百。然后这个牌是fold到我小盲，然后大盲是那个Kevin，他是要打的。然后我就open了3000，他call。flop发圈八二，两张方块。我是两张黑的黑的勾。然后我check，他打了个4000，我靠， check call。转牌掉7。我check，打了个1万，我check call。然后河牌掉了个10。我check，打了个2万8。我想了半天弃了。首先呢，我觉得这个人，Kevin这个人呢，他还是很紧的，不会去投机的。即使这个牌呢，我想不明白，但我觉得还是要fold。就是当时我有考虑，就觉得他肯定是要么两对以上的牌力，要么是买花miss吧。但对于他的类型，我倾向于是两对以上的牌力。但是又没有，感觉是没有圈10的。也可能是set吧，这种。然后反正合牌我fold掉了

Agent 解析草案

- playedDate：2026-05-17
- stakeLevel：300/600
- heroPosition：SB
- heroCardsInput：黑色 JJ
- currentProfit：-17000
- opponentType：紧
- opponentName：Kevin
- villainPosition：BB
- board：flop Q82 两方块，turn 7，river T
- streetInputs：preflop = folds to Hero SB open3000→BB Kevin call；flop = Hero check→BB bet4000→Hero call；turn = Hero check→BB bet10000→Hero call；river = Hero check→BB bet28000→Hero fold
- streetSummary：翻前：folds to Hero SB R3000→BB Kevin C；翻牌 Q82dd：Hero X→BB B4000→Hero C；转牌 7：Hero X→BB B10000→Hero C；河牌 T：Hero X→BB B28000→Hero F
- showdown：空
- mindJourney：Hero 认为 Kevin 偏紧，不会乱投机；虽然存在 miss draw，但对手三街更偏价值，最终 fold。
- tags：Hero Call、可优化

需要你确认

- 河牌 T 的花色是否知道？
- tags 用 Hero Call + 可优化 是否合适？

#### 手牌 #6 — 78s -7500

原始语音文本

> 78红桃这手牌是我在UTG+1开，然后fold到大盲，这个小鱼在做了一个3B到7500，我俩有效200个BB嘛，我就call了。然后flop发923彩虹，我又买后门花，后门是，他败了一个2/3吧。然后我想看一下solver这个地方是不是要call去缠打他

Agent 解析草案

- playedDate：2026-05-17
- stakeLevel：继承当前 session
- heroPosition：UTG+1
- heroCardsInput：7h8h
- effectiveStack：200BB
- currentProfit：-7500
- opponentType：小鱼
- opponentName：空
- villainPosition：BB
- board：flop 923 rainbow
- streetInputs：preflop = Hero UTG+1 open→BB 小鱼 3B7500→Hero call?；flop = BB bet67%→Hero 待确认
- streetSummary：翻前：Hero UTG+1 R→BB 小鱼 3B7500→Hero C?；翻牌 923r：BB B67%pot→Hero ?
- showdown：空
- mindJourney：Hero 有后门花，想确认面对 flop 2/3 下注是否可以 call 继续缠打。
- tags：可优化

需要你确认

- Hero 最后 flop 是 fold 了吗？currentProfit -7500 看起来像只损失翻前 3B call/或直接弃，请确认。
- 这手继承的 session 级别是多少？

### 2026-05-26

#### 手牌 #1 — 78s -6000

原始语音文本

> 七八方块这牌当时打的是200、400。然后我在枪口位开，桌上有一条鱼，他是跟我隔一家，就在我下下家，他什么牌都会call open，就是靠玩很，玩很松嘛。这个这个牌我枪口位开，他又call。发圈、K、8，两张黑桃吧。然后我check，他check。转牌又掉张黑桃三这种，我直接打了一个两倍超炮，打了个5000，锅里面是2000、2600这样，然后他call。我看了一眼牌， call。就是马脚挺明显，就是明显是买牌嘛。然后合牌结果掉张草花A。我是怕我在这边打，偷不掉他。就他买A黑桃的这些牌，然后中了A之后，他不会弃，他会call。然后所以就没有偷，我就check了，然后他也check了，结果他是A6杂色

Agent 解析草案

- playedDate：2026-05-26
- stakeLevel：200/400
- heroPosition：UTG
- heroCardsInput：7d8d
- currentProfit：-6000
- opponentType：松鱼
- opponentName：空
- villainPosition：待确认
- board：flop QK8 两黑桃，turn 3s，river Ac
- streetInputs：preflop = Hero UTG open→松鱼 call；flop = Hero check→villain check；turn = Hero overbet5000→villain call；river = Hero check→villain check
- streetSummary：翻前：Hero UTG R→松鱼 C；翻牌 QK8ss：Hero X→松鱼 X；转牌 3s：Hero B5000(overbet)→松鱼 C；河牌 Ac：Hero X→松鱼 X
- showdown：villain A6o
- mindJourney：Hero 转牌用超池攻击明显听牌/现场信息；river A 命中对手很多 A-high 黑桃听牌，因此放弃。
- tags：诈唬、可优化

需要你确认

- 翻前 open size 是否知道？
- turn 5000 是否记为约 200% pot？
- 对手具体位置是什么？

#### 手牌 #2 — A6s 【-11500¥】

原始语音文本

> 这个A6呢，也是跟这个鱼打的。这个也是我在，而我在中位open的，然后他在button call。Flop发883彩虹，我check，他也check。不是彩虹，是883两张草花好像。然后转牌掉个6，我打了个翻牌前是open 1000嘛，然后turn上我是打了个1500，他call。合牌掉个2，就45是顺子了。然后我打了个3000，对，打了个3000，锅里有5000，打了个3000，他raise到9000。但是我想我这牌应该就输45一手牌，我觉得没有那么巧吧。然后我就call了，结果鱼是8、10红桃，对，他flop中了三条，然后在买花面，他都没有打

Agent 解析草案

- playedDate：2026-05-26
- stakeLevel：继承当前 session
- heroPosition：MP
- heroCardsInput：A6s
- currentProfit：-11500
- opponentType：鱼
- opponentName：空
- villainPosition：BTN
- board：flop 883 两草花，turn 6，river 2
- streetInputs：preflop = Hero MP open1000→BTN 鱼 call；flop = Hero check→BTN check；turn = Hero bet1500→BTN call；river = Hero bet3000→BTN raise9000→Hero call
- streetSummary：翻前：Hero MP R1000→BTN C；翻牌 883cc：Hero X→BTN X；转牌 6：Hero B1500→BTN C；河牌 2：Hero B3000→BTN R9000→Hero C
- showdown：BTN T8hh
- mindJourney：Hero 认为 river 主要只输 45，概率不高，因此 call；结果对手 slowplay trips。
- tags：Hero Call、可优化

需要你确认

- Hero A6s 的花色是什么？
- 这手是否继承 200/400 session？

#### 手牌 #3 — TJs 【+18000¥】

原始语音文本

> 这牌是巴腾那个鱼老外，一个年轻的小伙。我对他的印象还不是很深，不知道他叫什么，之后再补充吧。然后他巴腾open 1000，我在我在小盲，他在CO位open 1000，我在小盲，3B他4500。因为我们俩有效都蛮深的，有12，十四五万吧，就300BB以上，所以我open 3B的小一点。然后他call，flop发10、9、7，彩虹。然后我选择了check call，我check，他打了一个半pot 5000，我check call。转牌掉8。然后有买后门红桃，我check，他打了，2万的锅子打了一个8000，我check call，合牌掉5，草花5白板，我check，他也check了。然后呢我秀牌，我是单张顺嘛，就是勾圈是nuts顺，我是有勾嘛。然后他muck

Agent 解析草案

- playedDate：2026-05-26
- stakeLevel：继承当前 session
- heroPosition：SB
- heroCardsInput：JTs
- effectiveStack：120000-150000
- currentProfit：+18000
- opponentType：鱼 / 年轻外国玩家
- opponentName：空
- villainPosition：CO/BTN 待确认
- board：flop T97 rainbow，turn 8（后门红桃），river 5c
- streetInputs：preflop = CO/BTN open1000→Hero SB 3B4500→villain call；flop = Hero check→villain bet5000→Hero call；turn = Hero check→villain bet8000→Hero call；river = Hero check→villain check
- streetSummary：翻前：CO/BTN R1000→Hero SB 3B4500→villain C；翻牌 T97r：Hero X→villain B5000→Hero C；转牌 8：Hero X→villain B8000→Hero C；河牌 5c：Hero X→villain X
- showdown：Hero J-high straight，villain muck
- mindJourney：Hero 深筹码用小 3B 控池；flop/turn 用对子加听牌/顺子权益 check-call，river 选择 check 后摊牌赢。
- tags：精彩、3Bet池、深筹码

需要你确认

- 对手位置是 CO 还是 BTN？
- Hero JTs 花色是什么？
- 这手继承的 session 级别是多少？

#### 手牌 #4 — AA 【+31000¥】

原始语音文本

> 这AA是当时UDG那个法国Polo Open，然后CY在在COV对他做了一个3B到3500。然后我在巴特，我想了一下，因为我们筹码都蛮深的。我就我这边去扣的4B到8500，我觉得意义不太大。我就call了3500。因为法国那个UDG那个法国人他有点乱搞的，他可能会去可能会去四，可能会去5B抢这个池的，我觉得可能会4B抢这个池的，所以我就扣的call 3B了。然后，结果法国人弃了，fro法八七，八七四。对，然后五六是NAS，然后他check，我也check。他没打，我也，我觉得我在这边也没必要打了，要去控池了，那就如果这种球，如果是一个扣call 3B到这么深筹码，然后我也check了。然后转牌掉了个白板二这种牌，然后他打了个过滤器，前面打了个6500，挺蛮重的。我觉得我call就好， call。然后合牌掉一个，又掉个A出来。那么我成了最大的三条。我觉得在这边我觉得他是没有一些顺子，他顺子肯定会打的。然后他打了个满炮21000，我觉得我这边想引诱他做一些bluff，我就min raise到4万。结果他弃掉。这边明显他是一些空气牌，这边他有一些牌他没必要打，我觉得他可能K圈啊、10 K啊、K勾啊这种牌吧 然后这个发现就是这个CY他打了大局之后，现在打小局，下来打小局，就是会偷鸡的时候会偷得很重，而且会连续开枪，连续开两枪、连续开三枪。然后开打都是打比较重的size

Agent 解析草案

- playedDate：2026-05-26
- stakeLevel：继承当前 session
- heroPosition：BTN
- heroCardsInput：AA
- currentProfit：+31000
- opponentType：待确认
- opponentName：CY
- villainPosition：CO
- board：flop 待确认（疑似 874），turn 2，river A
- streetInputs：preflop = UTG Polo open→CO CY 3B3500→Hero BTN call3500→UTG fold；flop = CY check→Hero check；turn = CY bet6500→Hero call；river = CY bet21000→Hero raise40000→CY fold
- streetSummary：翻前：UTG Polo R→CO CY 3B3500→Hero BTN C3500→UTG F；翻牌 ?：CY X→Hero X；转牌 2：CY B6500→Hero C；河牌 A：CY B21000→Hero R40000→CY F
- showdown：无
- mindJourney：Hero 深筹码用 AA 平跟 3B，想给 UTG/Polo 留 back-raise 或继续入池空间；river 成三条 A 后小 raise，目标是从 CY 大注范围中榨取价值。
- tags：精彩、3Bet池、深筹码

需要你确认

- flop 具体是否 874？
- 原文里“过滤器”是什么语音误识别？
- 这手继承的 session 级别是多少？

#### 手牌 #5 — KJs -25000

原始语音文本

> 这手牌是当时我在大盲位，然后这个牌是300、600。然后Button open，Button是一个reg，亚洲的，然后是一个年轻的亚洲人，然后开1000。我在大盲，然后这个牌是大盲，然后call 1000。然后flop发K、7、3，彩虹。我中了顶对K，然后带一个后门花，后门是红桃。他打了个1万3，满炮。我想了一下，因为他在button开，他的范围很宽，满炮1万3，我想了想call了一下。然后turn掉个9，他check，我也check。然后合牌掉个2，他又打了一个满炮，3万9。我想了想，我觉得他范围里还是有一些miss的，有一些miss的牌，但也有一些顶对，也有一些set。我想想还是弃了，因为我觉得他在button开1000的范围里，然后如果他是两对以上的牌力的话，他其实不需要打满炮的，所以我觉得他可能还是一些miss的牌，我觉得我还是fold掉了。结果他亮牌是勾圈杂色，纯空气。他这个是，他这个是第一次这样打，所以我没有办法去抓他。因为他之前也没有这么打过的记录

Agent 解析草案

- playedDate：2026-05-26
- stakeLevel：300/600
- heroPosition：BB
- heroCardsInput：KJs（有后门红桃）
- currentProfit：-25000
- opponentType：年轻亚洲 reg
- opponentName：空
- villainPosition：BTN
- board：flop K73 rainbow，turn 9，river 2
- streetInputs：preflop = BTN open1000→Hero BB call；flop = BTN pot bet13000→Hero call；turn = BTN check→Hero check；river = BTN pot bet39000→Hero fold
- streetSummary：翻前：BTN R1000→Hero BB C；翻牌 K73r：BTN B13000(pot)→Hero C；转牌 9：BTN X→Hero X；河牌 2：BTN B39000(pot)→Hero F
- showdown：BTN QJo bluff
- mindJourney：Hero 知道 BTN open 很宽，river 有 missed draw，但第一次见到这种 line，缺少历史信息，最终选择 fold。
- tags：Bad Fold、可优化

需要你确认

- flop 后 pot bet 13000 是否漏了前面行动或底池信息？
- tags 用 Bad Fold 还是只标“可优化”？

## 后续确认流程

1. 你在每手牌的需要你确认下面写确认结果
2. 我把确认后的手牌写入自动化测试
3. 我只把确认过的可复用说法沉淀成规则
4. 运行测试并推送真机调试
