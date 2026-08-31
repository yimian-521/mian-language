// 免语言真搜索驱动：宿主语言给免语言递一只"原生手"（web）
// AST + 求值器走免语言，网络走宿主的 https——这就是 native function 的真义
// 目标：真搜 tavily 引擎（和 lite 同效果），搜"hello world"，打印结果条数
const https = require("https");
const fs = require("fs");
const { Lexer } = require("./lexer");
const { Parser } = require("./parser");
const { Evaluator } = require("./evaluator");

// 真请求：免语言卡拉起，宿主手干活
// key 走环境变量，不硬编码进源码（第八步：硬限制/静默罪证预防）
async function web(query) {
  const apiKey = process.env.TAVILY_KEY || "";
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 45000);   // 45s 上限，别再卡 20s
  try {
    const resp = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: apiKey, query, max_results: 3, search_depth: "basic" }),
      signal: controller.signal,
    });
    const j = await resp.json();
    return "OK:" + (j.results || []).length + "条:" + (j.results[0] ? j.results[0].title.slice(0, 40) : "无标题");
  } finally {
    clearTimeout(t);
  }
}

const source = fs.readFileSync("./examples/really_search.mi", "utf8");
const { tokens } = new Lexer(source).scanTokens();
const { statements, errors } = new Parser(tokens).parseProgram();
if (errors.length) {
  console.error("语法错误:", errors);
  process.exit(1);
}

// 关键：把 host 的 web 塞进免语言的环境，语言里 web("hello world") 就能真发请求
const ev = new Evaluator();
ev.env.set("web", { value: web, strength: "strong" });

ev.interpret(statements).then(() => {
  // print 的输出存在 ev.out——免语言干完活，宿主把结果亮出来
  for (const line of ev.out) console.log("[免语言 print] " + line);
  console.log("--- 真搜索完成 ---");
}).catch(e => {
  console.error("搜索失败:", e.message);
});