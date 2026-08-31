// ── 免语言版 RetryCourt 的宿主驱动 ──
// 机器契约（如实回禀，绝不插嘴）：
//   engineReady(名)      → bool
//   attemptSearch(引擎,词) → [bool, 信息]  一次尝试，成败都回禀
//   sleep(毫秒)           → 睡完回来
const fs = require("fs");
const { Lexer } = require("./lexer");
const { Parser } = require("./parser");
const { Evaluator, MianValue } = require("./evaluator");
const { StrengthResolver } = require("./strength_resolver");

function engineReady(name) {
  const map = {
    tavily: !!process.env.TAVILY_KEY,
    google: !!(process.env.GOOGLE_API_KEY && process.env.GOOGLE_CX),
    serpapi: !!process.env.SERPAPI_KEY,
    bocha: !!process.env.BOCHA_KEY,
    exa: !!process.env.EXA_KEY,
    github: !!process.env.GITHUB_TOKEN,
  };
  return map[name] === true;
}

// 一次尝试：成功回 [true, 摘要]；失败回 [false, 原因]。机器不重试，重试是语言的裁决。
async function attemptSearch(engine, query) {
  if (engine === "tavily" && process.env.TAVILY_KEY) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      try {
        const resp = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ api_key: process.env.TAVILY_KEY, query, max_results: 3, search_depth: "basic" }),
          signal: controller.signal,
        });
        if (!resp.ok) return [false, "HTTP " + resp.status];
        const j = await resp.json();
        const n = (j.results || []).length;
        const title = j.results && j.results[0] ? j.results[0].title.slice(0, 40) : "无标题";
        return [true, "OK:" + n + "条:" + title];
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      return [false, "network:" + e.message.slice(0, 40)];
    }
  }
  // 其他引擎：机器如实回禀"此引擎原生握手尚未接"，语言自会聚合与熔断
  return [false, "no-native-hand:" + engine];
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

const source = fs.readFileSync("./examples/retrycourt_full.mi", "utf8");
const { tokens, errors: lexErrors } = new Lexer(source).scanTokens();
const { statements, errors: parseErrors } = new Parser(tokens).parseProgram();
if (lexErrors.length || parseErrors.length) {
  console.error("语法错误：", lexErrors.map(e => e.message).concat(parseErrors.map(e => e.message)));
  process.exit(1);
}
new StrengthResolver().resolve(statements, ["engineReady", "attemptSearch", "sleep"]);

const ev = new Evaluator();
ev.env.set("engineReady", new MianValue(engineReady, "strong", "host:engineReady"));
ev.env.set("attemptSearch", new MianValue(attemptSearch, "strong", "host:attemptSearch"));
ev.env.set("sleep", new MianValue(sleep, "strong", "host:sleep"));

ev.interpret(statements).then(() => {
  for (const line of ev.out) console.log(line);
}).catch(e => {
  console.error("[免语言错误]", e.message);
});