const assert = require("assert");
const fs = require("fs");
const path = require("path");

const demoPath = path.join(
  __dirname,
  "..",
  "web-preview",
  "friend-list-message-demo.html",
);
assert.ok(fs.existsSync(demoPath), "好友列表与消息中心 Demo HTML 应存在");

const html = fs.readFileSync(demoPath, "utf8");

assert.match(html, /好友列表/);
assert.match(html, /消息中心/);
assert.match(html, /class="player-card"/);
assert.match(html, /玩家类型/);
assert.match(html, /Leak/);
assert.match(html, /Note/);
assert.match(html, /累计时长/);
assert.match(html, /手牌数/);
assert.match(html, /好友申请/);
assert.match(html, /接受/);
assert.match(html, /拒绝/);
assert.match(html, /全部已读/);
assert.match(html, /查看名片/);
assert.match(html, /导入到玩家库/);
assert.match(html, /acceptRequest/);
assert.match(html, /rejectRequest/);
assert.match(html, /markAllRead/);
assert.match(html, /openCardPreview/);
assert.match(html, /content unavailable|内容已不可访问/);
assert.match(html, /prefers-reduced-motion/);
assert.doesNotMatch(
  html,
  /innerHTML\s*=/,
  "Demo 不应通过 innerHTML 注入状态内容",
);
