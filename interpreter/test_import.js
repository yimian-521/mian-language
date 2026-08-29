// 跨文件 import 测试：宿主注入 loader/parser，语言运行 import
const fs = require("fs");
const path = require("path");
const { Lexer } = require("./lexer");
const { Parser } = require("./parser");
const { Evaluator } = require("./evaluator");
const { StrengthResolver } = require("./strength_resolver");
const { run } = require("./test_runner");

// 宿主手：安全 loader（只准读 examples 目录，循环由 loaded 集合防）
const loaded = new Set();
function makeLoader() {
  return (p) => {
    const full = path.resolve("./examples", p);
    if (!full.startsWith(path.resolve("./examples"))) throw new Error("import 越界：只准读 examples 目录");
    if (loaded.has(full)) return "";   // 已加载过：跳过（防循环+防重复）
    loaded.add(full);
    return fs.readFileSync(full, "utf8");
  };
}
function parseSource(source) {
  if (!source) return [];
  const { tokens } = new Lexer(source).scanTokens();
  const { statements } = new Parser(tokens).parseProgram();
  new StrengthResolver().resolve(statements);
  return statements;
}

(async () => {
  const src = 'import "math_utils.mi"; let d = double(21); print d; print greeting;';
  const ev = new Evaluator({ importLoader: makeLoader(), parseSource });
  const { tokens } = new Lexer(src).scanTokens();
  const { statements } = new Parser(tokens).parseProgram();
  new StrengthResolver().resolve(statements);
  await ev.interpret(statements);
  console.log("=== 跨文件 import ===");
  for (const line of ev.out) console.log("  " + line);
  console.log(ev.out.join("|") === "42|你好，欢迎导入。" ? "✓ 导入成功：函数和变量都跨了文件" : "✗ " + ev.out.join("|"));
})();