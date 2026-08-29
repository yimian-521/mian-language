#!/usr/bin/env node
// 免语言 CLI：读 .mi 文件并执行 / 跑测试
// 用法：node mian.js <file.mi> [--ledger]   执行 .mi 文件
//   node mian.js test [--verbose] [--stress] [--threshold=N]   一键全量验收（压测开关直通 test_runner）
const fs = require("fs");
const { Lexer } = require("./lexer");
const { Parser } = require("./parser");
const { Evaluator, Ledger } = require("./evaluator");
const { StrengthResolver } = require("./strength_resolver");

const arg1 = process.argv[2];
const withLedger = process.argv.includes("--ledger");
const verbose = process.argv.includes("--verbose");
const stress = process.argv.includes("--stress");
const thrArg = process.argv.find(a => a.startsWith("--threshold=")) || "";

// ── --version / --help ──
const PKG = require("./package.json");
if (arg1 === "--version" || arg1 === "-v") {
  console.log(`mian ${PKG.version}`);
  process.exit(0);
}
if (arg1 === "--help" || arg1 === "-h") {
  console.log(`免语言 CLI v${PKG.version}
用法:
  mian <文件.mi> [--ledger]    执行 .mi 文件
  mian repl                    交互式 REPL（一行一执行，环境跨行持久）
  mian test [--stress] [--threshold=N] [--verbose]   一键全量验收
  mian --version / --help      显示版本 / 帮助`);
  process.exit(0);
}

// ── 子命令：repl ──
if (arg1 === "repl" || arg1 === "shell" || arg1 === "interactive") {
  require("./repl");
  return;
}

// ── 子命令：test ──
if (arg1 === "test") {
  const { spawnSync } = require("child_process");
  const path = require("path");
  const dir = __dirname;
  const suites = [
    ["主测试 50 例", "test_runner.js", ["--verbose"].filter(() => verbose).concat(stress ? ["--stress"] : [], thrArg ? [thrArg] : [])],
    ["报错库测试", "test_errors.js", []],
    ["双身体对拍", "cross_mode_test.js", []],
    ["三身体对拍（C++ 原生）", "test_cpp_native.js", []],
    ["三件套（文件/进程/网络）", "test_stdlib.js", []],
    ["边界护栏", "test_boundaries.js", []],
    ["跨文件 import", "test_import.js", []],
  ];
  let failed = 0;
  for (const [name, file, extra] of suites) {
    const r = spawnSync(process.execPath, [path.join(dir, file), ...extra], { encoding: "utf8", cwd: dir });
    if (r.status === 0) {
      const lastLines = (r.stdout || "").trim().split("\n").slice(-1)[0] || "";
      console.log(`  ✓ ${name}${lastLines ? "  — " + lastLines.slice(0, 60) : ""}`);
    } else {
      failed++;
      console.log(`  ✗ ${name}（退出码 ${r.status}）`);
      if (!verbose) console.log((r.stdout || "") + (r.stderr || "")).slice(-800);
    }
  }
  console.log(failed === 0 ? "\n=== mian test：全部通过 ===" : `\n=== mian test：${failed} 组失败 ===`);
  process.exit(failed === 0 ? 0 : 1);
}

// ── 默认：执行 .mi 文件 ──
if (!arg1) {
  console.error("用法：node mian.js <文件.mi> [--ledger]  或  node mian.js test");
  process.exit(1);
}

const source = fs.readFileSync(arg1, "utf8");
const { tokens, errors: lexErrors } = new Lexer(source).scanTokens();
const { statements, errors: parseErrors } = new Parser(tokens).parseProgram();

// CLI 也要跑强度静态求解器——不然 done 见到的全是 weak 值，全被拒（三身体对拍逮出的真 bug）
new StrengthResolver().resolve(statements);

if (lexErrors.length || parseErrors.length) {
  for (const e of lexErrors) console.error(`[词法错误] ${e.message}`);
  for (const e of parseErrors) console.error(`[语法错误] 第${e.line}行 '${e.at}'：${e.message}`);
  console.error("有错误，不执行。");
  process.exit(1);
}

// ── CLI 默认 import 安全 loader（与 C++ 原生执行器对齐：同目录 .mi + 循环防护）──
const path = require("path");
const loadedImports = new Set();
function cliImportLoader(p) {
  if (p.includes("..")) throw new Error("import 路径不允许 .. 穿越");
  if (!p.endsWith(".mi")) throw new Error("import 只支持 .mi 文件");
  const base = path.dirname(path.resolve(arg1));
  const full = path.resolve(base, p);
  if (loadedImports.has(full)) return "";
  loadedImports.add(full);
  return fs.readFileSync(full, "utf8");
}
function cliParseSource(source) {
  if (!source) return [];
  const { tokens } = new Lexer(source).scanTokens();
  const { statements, errors } = new Parser(tokens).parseProgram();
  if (errors.length) throw new Error(`[import 语法错误] ${errors.map(e => e.message).join("; ")}`);
  new StrengthResolver().resolve(statements);
  return statements;
}

const ev = new Evaluator({ ledger: withLedger, importLoader: cliImportLoader, parseSource: cliParseSource });
(async () => {
  try {
    await ev.interpret(statements);   // interpret 现在是 async
    // print 输出收集在 ev.out——CLI 的职责是亮出来
    for (const line of ev.out) console.log(line);
  } catch (e) {
    // 按错误分类回禀——用户看到的是"怎么改"，不是分类名
    const kind = e && e.kind;
    const level = e && e.level;
    const code = e && e.code;
    const prefix = code ? `[${code}]` : "";
    if (kind === "boundary") {
      console.error(`${prefix}[越界] ${e.message}`);
    } else if (kind === "contract") {
      console.error(`${prefix}[约定] ${e.message}`);
    } else if (kind === "syntax") {
      console.error(`${prefix}[语法] ${e.message}`);
    } else if (level === "warning") {
      console.error(`${prefix}[警告] ${e.message}`);
    } else {
      console.error(`${prefix}[免语言错误] ${e.message}`);
    }
    if (withLedger) {
      console.log("--- 五段账本（出生/消费/葬礼）---");
      for (const entry of ev.ledger.entries) console.log(`#${entry.seq} [${entry.stage}] ${entry.where || ""} ${entry.value !== undefined ? "→ " + entry.value : ""}`);
    }
    process.exit(1);
  }

  if (withLedger) {
    console.log("--- 五段账本（出生/消费/葬礼）---");
    for (const entry of ev.ledger.entries) console.log(`#${entry.seq} [${entry.stage}] ${entry.where || ""} ${entry.value !== undefined ? "→ " + entry.value : ""}`);
  }
})();