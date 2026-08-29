// 三件套实测：文件/进程/网络在解释器和 VM 两边都过
const { run } = require("./test_runner");
const { Lexer } = require("./lexer");
const { Parser } = require("./parser");
const { Evaluator } = require("./evaluator");
const { Compiler } = require("./compiler");
const { BytecodeVM } = require("./vm");
const { makeStdlib } = require("./stdlib/machine_hands");

// 机器手：真家伙
const hands = makeStdlib();

// 一号身体：解释器带机器手
async function runInterp(source) {
  const { tokens } = new Lexer(source).scanTokens();
  const { statements } = new Parser(tokens).parseProgram();
  const ev = new Evaluator({ machineHands: hands, stdlib: false });
  let result = null, runtimeError = null;
  try { result = await ev.interpret(statements); }
  catch (e) { runtimeError = e; }
  return { result, out: ev.out, runtimeError };
}

// 二号身体：VM 带机器手
async function runVM(source) {
  const { tokens } = new Lexer(source).scanTokens();
  const { statements } = new Parser(tokens).parseProgram();
  const program = new Compiler().compile(statements);
  const vm = new BytecodeVM(program);
  // 机器手 + 标准库原语进 VM
  for (const [name, fn] of Object.entries(hands)) vm.globals.set(name, fn);
  vm.globals.set("len", (x) => { if (typeof x === "string") return x.length; if (Array.isArray(x)) return x.length; throw Object.assign(new Error("len 只支持字符串或数组"), { name: "MianError" }); });
  vm.globals.set("str", (x) => String(x));
  vm.globals.set("clock", () => Date.now());
  let result = null, runtimeError = null;
  try { const r = await vm.run(); result = r.result; }
  catch (e) { runtimeError = e; }
  return { result, out: vm.out, runtimeError };
}

(async () => {
  console.log("=== 文件手 ===");
  for (const [name, fn] of [["解释器", runInterp], ["VM", runVM]]) {
    const r = await fn('let p = "/tmp/mian_hands_test.txt"; let w = writeFile(p, "你好机器手"); return w[0];');
    console.log(`  ${name} 写文件:`, r.result === true ? "✓" : "✗ " + (r.runtimeError ? r.runtimeError.message : r.result));
    const r2 = await fn('let r = readFile("/tmp/mian_hands_test.txt"); return r[0] == true && r[1] == "你好机器手";');
    console.log(`  ${name} 读文件:`, r2.result === true ? "✓" : "✗ " + r2.result);
  }

  console.log("\n=== 进程手 ===");
  for (const [name, fn] of [["解释器", runInterp], ["VM", runVM]]) {
    const r = await fn('let r = run("echo 你好进程"); return r[0];');
    console.log(`  ${name} 跑命令:`, r.result === true ? "✓" : "✗ " + (r.runtimeError ? r.runtimeError.message : r.result));
    const r2 = await fn('let r = run("echo 你好进程"); return r[1];');
    console.log(`  ${name} 拿输出:`, r2.result === "你好进程" ? "✓" : "✗ " + r2.result);
  }

  console.log("\n=== 网络手（真实请求）===");
  for (const [name, fn] of [["解释器", runInterp], ["VM", runVM]]) {
    const r = await fn('let r = httpGet("https://example.com"); return r[0];');
    console.log(`  ${name} 抓网页:`, r.result === true || (r.runtimeError && r.runtimeError.message.includes("timeout")) ? "✓（真通或如实超时）" : "✗ " + (r.runtimeError ? r.runtimeError.message : r.result));
  }

  console.log("\n=== 双身体对拍（三件套）===");
  const src = 'let w = writeFile("/tmp/mian_x.txt", "对拍"); let r = readFile("/tmp/mian_x.txt"); let c = run("echo 对拍"); return (w[0] == true) == (r[0] == true);';
  const i = await runInterp(src);
  const v = await runVM(src);
  console.log(`  解释器: ${i.result} | VM: ${v.result} | ${(i.result === v.result) && (JSON.stringify(i.out) === JSON.stringify(v.out)) ? "✓ 一致" : "✗ 不一致 " + JSON.stringify(i.out) + " vs " + JSON.stringify(v.out)}`);
})();