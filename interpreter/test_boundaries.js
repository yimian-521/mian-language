// 边界护栏实测：用注入的小上限，验证护栏真能拦死循环/深递归，且报的是免语言的错
const { run } = require("./test_runner");

(async () => {
  console.log("=== ① 死循环护栏（loopLimit=10 注入）===");
  let r = await run("let i = 0; while (i < 1) { i = i * 2; }", { loopLimit: 10 });
  console.log(r.runtimeError
    ? `✓ 拦住了："${r.runtimeError.message}"`
    : "✗ 没拦住！死循环把机器拖死了？");

  console.log("\n=== ② for 死循环护栏（loopLimit=10）===");
  r = await run("for (i = 0; i < 1; i = i * 2) { i = i + 0; }", { loopLimit: 10 });
  console.log(r.runtimeError
    ? `✓ 拦住了："${r.runtimeError.message}"`
    : "✗ 没拦住！");

  console.log("\n=== ③ 递归深护栏（depthLimit=5 注入）===");
  r = await run("fun go(n) { return go(n + 1); } return go(0);", { depthLimit: 5 });
  console.log(r.runtimeError
    ? `✓ 拦住了："${r.runtimeError.message}"`
    : "✗ 没拦住！递归爆栈了？");

  console.log("\n=== ④ 递归贴着上限仍能跑（depthLimit=8 允许冲）===");
  r = await run("fun go(n) { done n > 7 { return n; } return go(n + 1); } return go(0);", { depthLimit: 8 });
  console.log(r.result === 8
    ? "✓ 在护栏内跑通了"
    : `✗ result=${r.result}, err=${r.runtimeError ? r.runtimeError.message : "无"}`);

  console.log("\n=== ⑤ 正常循环在护栏内照跑（loopLimit=50）===");
  r = await run("let i = 0; let s = 0; while (i < 5) { s = s + i; i = i + 1; } return s;", { loopLimit: 50 });
  console.log(r.result === 10 ? "✓ 正常循环不受护栏干扰" : `✗ result=${r.result}`);
})();