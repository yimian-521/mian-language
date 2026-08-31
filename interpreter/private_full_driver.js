// ── 免语言版完整私用搜索宿主驱动 ──
// 机器侧契约：engineReady 回禀 bool, search 回禀结果字符串（如实报 FAIL, 不吞不编）
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

// 机器负责网络/JSON；语言决定重试、退避、熔断
async function search(query) {
  const apiKey = process.env.TAVILY_KEY;
  if (!apiKey) return "FAIL:无钥匙（语言应已问过 engineReady）";
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    try {
      const resp = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: apiKey, query, max_results: 3, search_depth: "basic" }),
        signal: controller.signal,
      });
      if (!resp.ok) return `FAIL:HTTP ${resp.status}`;
      const j = await resp.json();
      const n = (j.results || []).length;
      const title = j.results && j.results[0] ? j.results[0].title.slice(0, 40) : "无标题";
      return `OK:${n}条:${title}`;
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    return "FAIL:" + e.message.slice(0, 60);
  }
}

const source = fs.readFileSync("./examples/private_full.mi", "utf8");
const { tokens, errors: lexErrors } = new Lexer(source).scanTokens();
const { statements, errors: parseErrors } = new Parser(tokens).parseProgram();
if (lexErrors.length || parseErrors.length) {
  console.error("语法错误：", lexErrors.map(e => e.message).concat(parseErrors.map(e => e.message)));
  process.exit(1);
}
new StrengthResolver().resolve(statements, ["engineReady", "search"]);

const ev = new Evaluator();
ev.env.set("engineReady", new MianValue(engineReady, "strong", "host:engineReady"));
ev.env.set("search", new MianValue(search, "strong", "host:search"));

ev.interpret(statements).then(() => {
  for (const line of ev.out) console.log(line);
}).catch(e => console.error("[免语言错误]", e.message));