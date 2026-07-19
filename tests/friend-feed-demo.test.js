const assert = require("assert");
const fs = require("fs");
const path = require("path");

const demoPath = path.join(
  __dirname,
  "..",
  "web-preview",
  "friend-feed-demo.html",
);
assert.ok(fs.existsSync(demoPath), "好友动态 Demo HTML 应存在");

const html = fs.readFileSync(demoPath, "utf8");

assert.match(html, /好友动态/);
assert.match(html, /id="activityFeed"/);
assert.doesNotMatch(html, /data-feed=/);
assert.ok(
  html.indexOf("3 分钟前") < html.indexOf("12 分钟前") &&
    html.indexOf("12 分钟前") < html.indexOf("28 分钟前") &&
    html.indexOf("28 分钟前") < html.indexOf("昨天 23:18"),
  "不同发布范围的动态应统一按发布时间倒序展示",
);
assert.match(html, /广场/);
assert.match(html, /全部好友/);
assert.match(html, /指定好友/);
assert.match(html, /BB/);
assert.match(html, /夜鸦/);
assert.match(html, /toggleLike/);
assert.match(html, /openComments/);
assert.match(html, /class="action-icon like-icon"/, "点赞应使用小图标");
assert.match(html, /class="action-icon comment-icon"/, "评论应使用小图标");
assert.match(html, /class="action-count"/, "小图标旁应显示互动数量");
assert.match(html, /aria-label="点赞"/);
assert.match(html, /aria-label="查看评论"/);
assert.match(
  html,
  /\.post-actions button\s*{[^}]*border:\s*0;/s,
  "互动按钮应无边框",
);
assert.match(
  html,
  /\.post-actions button\s*{[^}]*background:\s*transparent;/s,
  "互动按钮应无底色",
);
assert.doesNotMatch(
  html,
  /\.post-actions\s*{[^}]*grid-template-columns:/s,
  "互动区不应使用两列大按钮",
);
assert.doesNotMatch(
  html,
  /button\.textContent\s*=/,
  "点赞时不应覆盖图标按钮的全部内容",
);
assert.match(html, /sendComment/);
assert.match(html, /扑克贴纸/);
assert.match(html, /消息/);
assert.match(html, /prefers-reduced-motion/);
assert.doesNotMatch(html, /row\.innerHTML=.*text/);
