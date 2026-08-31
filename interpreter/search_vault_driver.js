// ── 免语言版多引擎搜索的宿主驱动 ──
// 语言跑 search_vault.mi，机器只做两件事（问-答契约）：
//   engineReady(名字) → 回禀"有没有钥匙"（bool）
//   search(词)         → 执行真网络搜索并回禀结果字符串
// 不替语言做任何决策：不选引擎、不吞错误、没有 fallback 自己乱跳。
const fs = require("fs");
const { Lexer } = require("./lexer");
const { Parser } = require("./parser");
const { Evaluator } = require("./evaluator");
const { StrengthResolver } = require("./strength_resolver");

// 机器侧契约：哪些引擎有 key（读环境变量，硬编码不允许）
function engineReady(name) {
  const map = {
    tavily: !!process.env.TAVILY_KEY,
    google: !!(process.env.GOOGLE_API_KEY && process.env.GOOGLE_CX),
    serpapi: !!process.env.SERPAPI_KEY,
    bocha: !!process.env.BOCHA_KEY,
    github: !!process.env.GITHUB_TOKEN,
  };
  return map[name] === true;
}

// 机器侧契约：真搜索（先支持 tavily，其它引擎同构，待语言决定再扩展）
async function search(query) {
  const apiKey = process.env.TAVILY_KEY;
  if (!apiKey) return "无钥匙：语言该先问 engineReady，机器不补钥匙。";
  try {
    const resp = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: apiKey, query, max_results: 3, search_depth: "basic" }),
    });
    const j = await resp.json();
    const n = (j.results || []).length;
    const title = j.results && j.results[0] ? j.results[0].title.slice(0, 40) : "无标题";
    return "OK:" + n + "条:" + title;
  } catch (e) {
    // 机器如实回禀失败，不吞、不编、不替语言决定下一步
    return "FAIL:" + e.message.slice(0, 80);
  }
}

const source = fs.readFileSync("./examples/search_vault.mi", "utf8");
const { tokens, errors: lexErrors } = new Lexer(source).scanTokens();
const { statements, errors: parseErrors } = new Parser(tokens).parseProgram();
if (lexErrors.length || parseErrors.length) {
  console.error("语法错误：", lexErrors.map(e => e.message).concat(parseErrors.map(e => e.message)));
  process.exit(1);
}

// 强度静态 pass：语言先想清楚（编译期裁决），机器才照办
new StrengthResolver().resolve(statements, ["engineReady", "search"]);

const ev = new Evaluator();
ev.env.set("engineReady", new (require("./evaluator").MianValue)(engineReady, "strong", "host:engineReady"));
ev.env.set("search", new (require("./evaluator").MianValue)(search, "strong", "host:search"));

ev.interpret(statements).then(() => {
  for (const line of ev.out) console.log(line);
}).catch(e => {
  console.error("[免语言错误]", e.message);
});