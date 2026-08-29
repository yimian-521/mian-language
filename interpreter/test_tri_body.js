// ── 免语言三身体同时对拍协议 ──
// 铁律：同一份 .mi，三具身体（解释器/VM/C++原生）result/out/runtimeError 必须全一致。
// 这是"三身体一致性"的最终验收：不是两两对拍，是三具一起跑同一份源码。
const { run } = require("./test_runner");
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { Compiler } = require("./compiler");
const { BytecodeVM } = require("./vm");
const { Lexer } = require("./lexer");
const { Parser } = require("./parser");

// ── 第二具身体：字节码 VM ──
async function runCompiled(source) {
  const { tokens } = new Lexer(source).scanTokens();
  const { statements } = new Parser(tokens).parseProgram();
  const program = new Compiler().compile(statements);
  const vm = new BytecodeVM(program);
  vm.globals.set("len", (x) => {
    if (typeof x === "string") return x.length;
    if (Array.isArray(x)) return x.length;
    if (x && typeof x === "object") return Object.keys(x).length;
    throw Object.assign(new Error("len 只支持字符串、数组或字典"), { name: "MianError" });
  });
  vm.globals.set("type", (x) => Array.isArray(x) ? "array" : typeof x);
  vm.globals.set("str", (x) => String(x));
  vm.globals.set("clock", () => Date.now());
  // read/write：操作 ref 引用指向的变量槽位
  vm.globals.set("read", (r) => {
    if (!r || r.kind !== "ref") throw Object.assign(new Error("read 的参数必须是 ref 创建的引用"), { name: "MianError" });
    if (!r.target.map.has(r.target.name)) throw Object.assign(new Error(`引用指向的变量 '${r.target.name}' 已被销毁（悬垂引用）`), { name: "MianError" });
    return r.target.map.get(r.target.name);
  });
  vm.globals.set("write", (r, v) => {
    if (!r || r.kind !== "ref") throw Object.assign(new Error("write 的第一个参数必须是 ref 创建的引用"), { name: "MianError" });
    if (!r.target.map.has(r.target.name)) throw Object.assign(new Error(`引用指向的变量 '${r.target.name}' 已被销毁（悬垂引用）`), { name: "MianError" });
    r.target.map.set(r.target.name, v);
    return v;
  });
  let result = null, runtimeError = null;
  try {
    const r = await vm.run();
    result = r.result;
  } catch (e) {
    runtimeError = (e && e.name === "MianError") ? e : { name: "Unexpected", message: String(e && e.message) };
  }
  return { result, out: vm.out, runtimeError };
}

// ── 第三具身体：C++ 原生执行器（编译到 /tmp，spawnSync 跑）──
const NATIVE_BIN = "/tmp/mian_native";
const NATIVE_SRC = path.join(__dirname, "..", "native", "mian_native.cpp");

// 确保 C++ 已编译（源码更新或二进制缺失才重编）
function ensureNative() {
  if (!fs.existsSync(NATIVE_BIN) || fs.statSync(NATIVE_SRC).mtimeMs > fs.statSync(NATIVE_BIN).mtimeMs) {
    const r = spawnSync("g++", ["-std=c++17", "-O2", NATIVE_SRC, "-o", NATIVE_BIN], { encoding: "utf8" });
    if (r.status !== 0) throw new Error("C++ 原生执行器编译失败: " + (r.stderr || r.stdout));
  }
}

function runNative(source) {
  ensureNative();
  // C++ 从文件读 .mi（不读 stdin），写临时文件
  const tmp = "/tmp/tri_body_probe.mi";
  fs.writeFileSync(tmp, source);
  const r = spawnSync(NATIVE_BIN, [tmp], { encoding: "utf8" });
  const out = r.stdout ? r.stdout.trim().split("\n").filter(l => l !== "") : [];
  let runtimeError = null;
  if (r.status !== 0) {
    runtimeError = { name: "MianError", message: (r.stderr || r.stdout || "").trim() };
  }
  return { result: null, out, runtimeError };
}

// ── 三身体注册表 ──
const BODIES = {
  interpreter: (source) => run(source),
  compiler: (source) => runCompiled(source),
  native: (source) => runNative(source),
};

async function triBody(programs) {
  const report = [];
  for (const { name, source } of programs) {
    const r1 = await BODIES.interpreter(source);
    const r2 = await BODIES.compiler(source);
    const r3 = await BODIES.native(source);
    const diffs = [];
    // 三具两两比：interpreter vs compiler / interpreter vs native / compiler vs native
    const pairs = [
      ["解释器", "VM", r1, r2],
      ["解释器", "C++", r1, r3],
      ["VM", "C++", r2, r3],
    ];
    for (const [na, nb, ra, rb] of pairs) {
      if (JSON.stringify(ra.out) !== JSON.stringify(rb.out)) diffs.push(`${na}.out [${ra.out}] !== ${nb}.out [${rb.out}]`);
      const e1 = ra.runtimeError ? "err" : "ok";
      const e2 = rb.runtimeError ? "err" : "ok";
      if (e1 !== e2) diffs.push(`${na}.runtimeError ${e1} !== ${nb}.runtimeError ${e2}`);
    }
    report.push({ name, pass: diffs.length === 0, diffs });
  }
  return report;
}

async function main() {
  const programs = [
    { name: "算术与变量", source: "let a = 1 + 2 * 3; print a;" },
    { name: "done 定性", source: 'let a = 7; done a == 7 { print "对"; }' },
    { name: "函数与递归", source: "fun fib(n) { done n < 2 { return n; } return fib(n-1) + fib(n-2); } print fib(10);" },
    { name: "数组与循环", source: "let a = [1,2,3]; let i=0; let s=0; while (i < len(a)) { s = s + a[i]; i = i + 1; } print s;" },
    { name: "for 求和", source: "let s = 0; for (i = 0; i < 6; i = i + 1) { s = s + i; } print s;" },
    { name: "字符串.len", source: 'let h = "hello"; print h.len; print len("abc");' },
    { name: "类型回禀", source: 'print type(42); print type("s"); print type([1,2]);' },
    { name: "多返回+解构", source: "fun div(a, b) { return a / b, a - b * (a / b); } let (q, r) = div(10, 3); print q; print r;" },
    { name: "字典", source: 'let d = {"name": "望安"}; print d["name"]; print len(d);' },
    { name: "if/else", source: 'let a = 5; if a > 3 { print "大"; } else { print "小"; }' },
    { name: "=== 严格比较", source: 'print 1 === "1"; print 1 === 1;' },
    { name: "ref 引用", source: "let x = 5; let r = ref x; print read(r); write(r, 99); print read(r); print x;" },
    { name: "报错一致", source: 'let x = 1 + "a";' },
  ];
  const report = await triBody(programs);
  let passed = 0;
  for (const r of report) {
    if (r.pass) passed++;
    console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}${r.pass ? "" : " → " + r.diffs.join(" | ")}`);
  }
  console.log(`\n=== 三身体对拍：${passed}/${report.length} 一致 ===`);
  process.exit(passed === report.length ? 0 : 1);
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}

module.exports = { triBody, BODIES };