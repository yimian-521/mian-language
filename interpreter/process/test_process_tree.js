// ── 免语言进程树骨架验证 ──
// 验证四件事：
// ① 四层链：主进程只下命令 → 指挥官只调度 → 子进程只拆派合 → 执行体只执行
// ② 报告路径锁死：ProcessId 烙上后，body 的结果必须走 sub→cmd→main 路径
// ③ 问-答契约：执行体不抛不吞，失败如实回禀
// ④ 五段账本：任务一生 birth/transit/consume/report/destroy 有账
const { buildTree, MainProcess, Commander, SubProcess, ProcessBody, ProcessId, defineGroup } = require("./process_tree");

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}

// ── 模拟真实负载：一个"lexer 扫描器"执行体 ──
function scanner(task) {
  // 假装扫描 .mi 源码，数 token
  const tokens = String(task).split(/\s+/).filter(Boolean);
  if (tokens.includes("ERROR_TOKEN")) throw new Error("扫描到非法 token");
  return tokens.length;
}

(async () => {
const { main, commander } = buildTree("scanner", [scanner]);
console.log("=== ① 四层链 + 五段账本 ===");
const report = await main.command(["let a = 1;", "print a;", "done a == 1 { print \"对\"; }"], "scanner");
console.log("  报告:", report.summary, "完成", report.completedCount, "/", report.totalCount);
check("三个任务全部成功", report.completedCount === 3 && report.summary === "✓3");

console.log("=== ② 报告路径锁死 ===");
try {
  // 从子进程身上直接调 body 的报告路径——必须显示全链
  const sub = commander.subProcesses[0];
  const body = sub.bodies[0];
  check("body 的身份烙着报告路径", body.id.reportPath === `body:body-0 → sub:sub-scanner → cmd:cmd-scanner → main`);
} catch (e) { check("body 的身份烙着报告路径", false, e.message); }

console.log("=== ③ 问-答契约：失败如实回禀 ===");
const bad = await main.command(["ERROR_TOKEN let a = 1;"], "scanner");
check("失败如实回禀原因", bad.completedCount === 0 && bad.results[0].error.includes("非法 token"),
  JSON.stringify(bad));

console.log("=== ④ 侦查旁路 + 账本记录 ===");
check("账本有 birth", main.ledger.some(e => e.stage === "birth"));
check("账本有 report", main.ledger.some(e => e.stage === "report"));
check("账本有 destroy", main.ledger.some(e => e.stage === "destroy"));
console.log("  账本流水：");
for (const e of main.ledger) console.log(`    #${e.seq} [${e.stage}] ${e.where} ${e.value}`);

console.log("=== ⑤ 侦查进程只看不拦 ===");
// 观察器在正常执行时保持沉默
const cleanWatches = commander.watches.map(w => w.finalReport());
check("正常执行观察器零异常", cleanWatches.every(w => w.anomalies.length === 0),
  JSON.stringify(cleanWatches));

// ⑤ 越权门 + ⑥ 分工不入 enum ──
console.log("=== ⑤ 侦察兵只有观察，没有命令 ===");
try {
  const w = commander.watches[0];
  const hasExecute = typeof w.execute === "function" || typeof w.command === "function";
  check("侦查进程没有 execute/command 口子（不然会让别的进程汇报）", !hasExecute);
} catch (e) { check("侦查进程没有 execute/command 口子", false, e.message); }

console.log("=== ⑥ 分工由外部注入，不照抄硬编码风格/类型 ===");
// 建一棵新树：执行体自己声明擅长，不靠任何内置枚举
const { main: main2 } = buildTree("workshop", [
  [(task) => task === "修bug" ? "bug被军师修好" : (() => { throw new Error("我不修这个"); })(), (task) => task === "修bug"],
  [(task) => task === "搬砖" ? "砖被工人搬完" : (() => { throw new Error("我不搬这个"); })(), (task) => task === "搬砖"],
]);
const r1 = await main2.command(["修bug"], "workshop");
const r2 = await main2.command(["搬砖"], "workshop");
check("修bug 被'修bug'认领者接", r1.completedCount === 1 && r1.results[0].data.content === "bug被军师修好", JSON.stringify(r1));
check("搬砖 被'搬砖'认领者接", r2.completedCount === 1 && r2.results[0].data.content === "砖被工人搬完", JSON.stringify(r2));
console.log("  分工形状：谁认领谁干，认领声明来自外部，语言不内置职业表");

console.log("=== ⑦ 自由分工：想造什么能力造什么 ===");
// 别人用免语言时，想到什么分工都行——语言不认"军师/工人"，只认声明
const { main: main3 } = buildTree("studio", [
  [() => "echo:audit", { name: "审计", claims: ["审计"], can: ["查账", "找异常"] }],
  [() => "echo:rewrite", { name: "重构", claims: ["重构"], can: ["改代码"] }],
  [() => "echo:translate", { name: "翻译", claims: ["翻译"], can: ["多语言"] }],
]);
const a = await main3.command([{ task: "请审计一下", need: ["查账"] }], "studio");
const b = await main3.command([{ task: "请翻译", need: ["多语言"] }], "studio");
check("任务带 need 查账 被审计接", a.completedCount === 1 && a.results[0].data.content === "echo:audit", JSON.stringify(a));
check("任务带 need 多语言 被翻译接", b.completedCount === 1 && b.results[0].data.content === "echo:translate", JSON.stringify(b));

console.log("=== ⑧ 分派策略可注入 ===");
// 连"怎么选人"都是扩展点——注入自己的策略：永远给最"轻"的执行体
const { main: main4 } = buildTree("pick", [
  [() => "A", "A"],
  [() => "B", "B"],
], (task, bodies) => bodies[bodies.length - 1]);  // 策略：永远选最后一个
const c = await main4.command(["任意"], "pick");
check("自定义策略生效：选中最后一个执行体", c.completedCount === 1 && c.results[0].data.content === "B", JSON.stringify(c));

console.log("=== ⑨ 分组：一个标准量产同分工进程 ===");
// 按免免说的：侦查只写一个"变量+函数"，其他进程套用这个标准
defineGroup("侦查", {
  name: "侦查",
  claims: ["巡逻"],
  can: ["观察", "汇报"],
  fn: (task) => `侦查报告：${task} 正常`,
});
const { main: main5 } = buildTree("patrol", [
  { $group: "侦查", name: "侦查一号" },   // 只覆盖名字，其余继承标准
  { $group: "侦查", name: "侦查二号" },
  { $group: "侦查" },                     // 连名字都不覆盖，纯继承
]);
const d = await main5.command(["巡逻东墙"], "patrol");
check("巡逻任务被侦查组接住", d.completedCount === 1 && String(d.results[0].data.content).includes("侦查报告"), JSON.stringify(d));
const bodies5 = main5.commanders.get("patrol").subProcesses[0].bodies;
check("三个实例都带组名", bodies5.every(b => b.groupName === "侦查"));
check("三个实例身份各自唯一", new Set(bodies5.map(b => b.id.bodyId)).size === 3,
  bodies5.map(b => b.id.bodyId).join(","));
check("覆盖只改名字不改能力", bodies5[0].name === "侦查一号" && bodies5[0].can.includes("观察"));
check("纯继承实例能力齐全", bodies5[2].can.includes("汇报") && bodies5[2].claims.includes("巡逻"));

console.log(`\n=== 进程树骨架：${pass}/${pass + fail} 通过 ===`);
process.exit(fail === 0 ? 0 : 1);
})();