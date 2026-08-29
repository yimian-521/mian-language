// ── 免语言 cross-mode 对拍协议 ──
// 框架 D2 铁律：同一份源码，两种模式 result/out/runtimeError 必须一致。
// 这是那个 AI 指出的真盲点，也是双执行器体的入场券：
//   一号身体 = 增量解释器（树游，已存在）
//   二号身体 = 全量编译器（字节码 VM，待建）——把 runner2 换成它，协议不变。
// 协议契约：对每份 .mi，双身体各自独立执行，然后对拍三件事：
//   result 一致 / out 一致 / runtimeError 都有或都无（错误类型一致）
const { run } = require("./test_runner");

// 双身体注册表：一号树游解释器，二号字节码 VM（真·第二具身体）
const { Compiler } = require("./compiler");
const { BytecodeVM } = require("./vm");
const { Lexer } = require("./lexer");
const { Parser } = require("./parser");

async function runCompiled(source) {
  const { tokens } = new Lexer(source).scanTokens();
  const { statements } = new Parser(tokens).parseProgram();
  const program = new Compiler().compile(statements);
  const vm = new BytecodeVM(program);
  // 标准库原语：len/str/type/clock——与一号身体同款，注入 VM 全局
  vm.globals.set("len", (x) => {
    if (typeof x === "string") return x.length;
    if (Array.isArray(x)) return x.length;
    if (x && typeof x === "object") return Object.keys(x).length;
    throw Object.assign(new Error("len 只支持字符串或数组"), { name: "MianError" });
  });
  vm.globals.set("type", (x) => Array.isArray(x) ? "array" : typeof x);
  vm.globals.set("str", (x) => String(x));
  vm.globals.set("clock", () => Date.now());
  let result = null, runtimeError = null;
  try {
    const r = await vm.run();   // VM run 是 async（原生手可能异步）
    result = r.result;
  } catch (e) {
    runtimeError = (e && e.name === "MianError") ? e : { name: "Unexpected", message: String(e && e.message) };
  }
  return { result, out: vm.out, runtimeError };
}

const BODIES = {
  interpreter: (source) => run(source),
  compiler: (source) => runCompiled(source),
};

async function crossMode(programs) {
  const report = [];
  for (const { name, source } of programs) {
    const r1 = await BODIES.interpreter(source);
    const r2 = await BODIES.compiler(source);
    const diffs = [];
    if (r1.result !== r2.result) diffs.push(`result ${r1.result} !== ${r2.result}`);
    if (JSON.stringify(r1.out) !== JSON.stringify(r2.out)) diffs.push(`out ${JSON.stringify(r1.out)} !== ${JSON.stringify(r2.out)}`);
    const e1 = r1.runtimeError ? r1.runtimeError.name : null;
    const e2 = r2.runtimeError ? r2.runtimeError.name : null;
    if (e1 !== e2) diffs.push(`runtimeError ${e1} !== ${e2}`);
    report.push({ name, pass: diffs.length === 0, diffs });
  }
  return report;
}

// 主函数（双身体对拍 + 诚实报差距）
async function main() {
  const programs = [
    { name: "算术与变量", source: "let a = 1 + 2 * 3; return a;" },
    { name: "done 定性", source: 'let a = 7; done a == 7 { print "对"; }' },
    { name: "函数与递归", source: "fun add(a, b) { return a + b; } return add(3, 4);" },
    { name: "数组与循环", source: "let a = [1,2,3]; let i=0; let s=0; while (i < len(a)) { s = s + a[i]; i = i + 1; } return s;" },
    { name: "报错一致", source: 'let x = 1 + "a";' },
  ];
  // 已知差距：空——VM 已支持 fun/array/while，全部进 programs 对拍
  const knownGaps = [];
  const report = await crossMode(programs);
  let passed = 0;
  for (const r of report) {
    if (r.pass) passed++;
    console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}${r.pass ? "" : " → " + r.diffs.join(" | ")}`);
  }
  console.log(`\n=== cross-mode: ${passed}/${report.length} 对拍一致 ===`);
  if (knownGaps.length) {
    console.log("已知差距（待 VM 下一战）：");
    for (const g of knownGaps) console.log(`  ⏳ ${g.name}`);
  }
  process.exit(passed === report.length ? 0 : 1);
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}

module.exports = { crossMode, BODIES };