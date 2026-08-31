// ── 进程树驱动版执行器验证 ──
// 用进程树跑 .mi，输出必须与直接解释器一致
const { runWithTree } = require("./mian_tree_driver");
const { run } = require("../test_runner");

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}

(async () => {
  console.log("=== ① 进程树跑算术 ===");
  const src1 = "let a = 1 + 2 * 3; print a;";
  const r1 = await runWithTree(src1);
  const direct1 = await run(src1);
  check("输出一致", r1.out.join("|") === direct1.out.join("|"), `${r1.out} vs ${direct1.out}`);
  check("无错误", r1.error === null, r1.error);

  console.log("=== ② 进程树跑 done + 函数 ===");
  const src2 = 'fun add(a, b) { return a + b; } let s = add(3, 4); done s == 7 { print "对"; } print s;';
  const r2 = await runWithTree(src2);
  const direct2 = await run(src2);
  check("输出一致", r2.out.join("|") === direct2.out.join("|"), `${r2.out} vs ${direct2.out}`);
  check("无错误", r2.error === null, r2.error);

  console.log("=== ③ 进程树跑数组 + 字符串 ===");
  const src3 = 'let a = [1,2,3]; let s = 0; let i = 0; while (i < len(a)) { s = s + a[i]; i = i + 1; } print s; let h = "hi"; print h.len;';
  const r3 = await runWithTree(src3);
  const direct3 = await run(src3);
  check("输出一致", r3.out.join("|") === direct3.out.join("|"), `${r3.out} vs ${direct3.out}`);
  check("无错误", r3.error === null, r3.error);

  console.log("=== ④ 词法错误如实回禀 ===");
  const r4 = await runWithTree('print "oops;');
  check("报词法错误", r4.error && r4.error.includes("词法错误"), r4.error);

  console.log("=== ⑤ 语法错误如实回禀 ===");
  const r5 = await runWithTree("let a = 1 print a;");
  check("报语法错误", r5.error && r5.error.includes("语法错误"), r5.error);

  console.log(`\n=== 进程树驱动执行器：${pass}/${pass + fail} 通过 ===`);
  process.exit(fail === 0 ? 0 : 1);
})();