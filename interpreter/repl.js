#!/usr/bin/env node
// 免语言 REPL：交互式输入，一行一执行
// 环境跨行持久：let a = 1 后，下一行可以 print a
// 用法：node mian.js repl   或  npm run repl
const readline = require("readline");
const fs = require("fs");
const path = require("path");
const { Lexer } = require("./lexer");
const { Parser } = require("./parser");
const { Evaluator } = require("./evaluator");
const { StrengthResolver } = require("./strength_resolver");

// 管道模式（非 TTY）：不显示交互 prompt，纯流水线
const isTTY = process.stdin.isTTY;

// import 安全 loader（跨行共享）
const loadedImports = new Set();
function replImportLoader(p) {
  if (p.includes("..")) throw new Error("import 路径不允许 .. 穿越");
  if (!p.endsWith(".mi")) throw new Error("import 只支持 .mi 文件");
  const full = path.resolve(process.cwd(), p);
  if (loadedImports.has(full)) return "";
  loadedImports.add(full);
  return fs.readFileSync(full, "utf8");
}
function replParseSource(source) {
  if (!source) return [];
  const { tokens } = new Lexer(source).scanTokens();
  const { statements, errors } = new Parser(tokens).parseProgram();
  if (errors.length) throw new Error(`[import 语法错误] ${errors.map(e => e.message).join("; ")}`);
  new StrengthResolver().resolve(statements);
  return statements;
}

// 单一 Evaluator 跨行共享环境
const ev = new Evaluator({ importLoader: replImportLoader, parseSource: replParseSource });
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "mian> ",
});
let pending = 0;   // 计数：正在执行的行数，确保管道模式全部执行完再退出
let closing = false;
let chain = Promise.resolve();   // 串行 promise 链

// 处理一行免语言代码（环境跨行共享）
async function processLine(input) {
  pending++;
  const { tokens, errors: lexErrors } = new Lexer(input).scanTokens();
  const { statements, errors: parseErrors } = new Parser(tokens).parseProgram();
  if (lexErrors.length) {
    for (const e of lexErrors) process.stdout.write(`[词法错误] ${e.message}\n`);
  } else if (parseErrors.length) {
    for (const e of parseErrors) process.stdout.write(`[语法错误] 第${e.line}行 '${e.at}'：${e.message}\n`);
  } else {
    try {
      new StrengthResolver().resolve(statements);
      const result = await ev.interpret(statements);
      // 有 print 输出先亮出
      for (const line of ev.out) process.stdout.write(line + "\n");
      ev.out.length = 0;
      // 表达式有值且非空时显示（写感）
      if (result !== null && result !== undefined && ev.out.length === 0) {
        process.stdout.write(String(result) + "\n");
      }
    } catch (e) {
      const code = e && e.code;
      const prefix = code ? `[${code}]` : "";
      process.stdout.write(`${prefix}${e.message}\n`);
    }
  }
  pending--;
  if (isTTY) rl.prompt();
  if (closing && pending === 0) process.exit(0);
}

console.log("免语言 REPL —— 输入表达式/语句，一行一执行。退出输入 exit 或按 Ctrl+C");
if (isTTY) rl.prompt();

rl.on("line", (line) => {
  const input = line.trim();
  if (input === "" || input.startsWith("//")) { if (isTTY) rl.prompt(); return; }
  if (input === "exit" || input === "quit" || input === ":q") { rl.close(); return; }
  // 串行化：把每行处理挂到 promise 链上，确保上一行执行完再处理下一行
  chain = chain.then(() => processLine(input));
});

rl.on("close", () => {
  // EOF 到达（管道读完）：标记 closing，等所有 pending 执行完再退出
  closing = true;
  if (pending === 0) {
    if (!isTTY) process.exit(0);
    else console.log("再见！");
  }
});
