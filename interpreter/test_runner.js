// 免语言——自由测试框架（可调配置，多测试集）
// 全部用例 async：run 已是异步（某些原生手会发真实网络）
const { Lexer } = require("./lexer");
const { Parser } = require("./parser");
const { Evaluator, Ledger } = require("./evaluator");
const { StrengthResolver } = require("./strength_resolver");

// ── 测试配置中心：一切可调，支持小/中/大三档 ──
const testConfig = {
  loopLimit: 1000000,       // 默认护栏（测试可注入小值防卡死）
  depthLimit: 500,
  small: 10,                // 小矩阵规模
  large: 1000,              // 大矩阵规模（--stress 切换）
};

// ── 从 .mi 源码一行跑通到结果（支持把 config 灌进去）──
async function run(source, options = {}) {
  const evalOpts = {
    ledger: options.ledger !== false,
    ledgerInstance: options.ledgerInstance || null,
    // 边界可配置：默认 100 万次护栏，测试时可调低
    loopLimit: options.loopLimit || testConfig.loopLimit,
    depthLimit: options.depthLimit || testConfig.depthLimit,
    // 机器手（并发/网络/文件）：测试并发能力时注入
    machineHands: options.machineHands || null,
  };
  const { tokens, errors: lexErrors } = new Lexer(source).scanTokens();
  const { statements, errors: parseErrors } = new Parser(tokens).parseProgram();

  // 强度求解器：静态 pass
  const resolver = new StrengthResolver();
  resolver.resolve(statements, options.nativeNames || null);

  const ev = new Evaluator(evalOpts);
  let result = null, runtimeError = null;
  try {
    result = await ev.interpret(statements);
  } catch (e) {
    runtimeError = (e && e.name === "MianError") ? e : { name: "Unexpected", message: String(e && e.message) };
  }
  return { lexErrors, parseErrors, runtimeError, result, out: ev.out, env: ev.env, ledger: ev.ledger };
}

// ── 断言工具 ──
let caseSeq = 0;
function t(name, fn) {
  caseSeq++;
  const p = (async () => { try { await fn(); return { pass: true }; } catch (e) { return { pass: false, error: e.message }; } })();
  return { name, promise: p };
}
function assertEq(actual, expected, msg) {
  if (actual !== expected) throw new Error(`${msg || "值不相等"}：期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}
function assertThrows(fn, msg) {
  try { fn(); } catch (e) { return; }
  throw new Error(msg || "本应抛错但没抛");
}

// ── 测试集注册表（追加式）──
const SUITES = [];

SUITES.push({
  name: "core",
  cases: [
    t("优先级 1+2*3=7", async () => {
      const r = await run("let a = 1 + 2 * 3; return a;");
      assertEq(r.result, 7);
    }),
    t("print 输出与返回值", async () => {
      const r = await run('print "hi";');
      assertEq(r.out.join("|"), "hi");
      assertEq(r.result, null, "print 隐式返回空");
    }),
    t("变量覆盖（有时效承诺）", async () => {
      const r = await run("let a = 1; let a = 2; return a;");
      assertEq(r.result, 2);
    }),
    t("字符串拼接不隐式转换", async () => {
      const r = await run('let s = "a" + "b"; return s;');
      assertEq(r.result, "ab");
      const bad = await run('let x = 1 + "a";');
      assertEq(!!bad.runtimeError, true, "数字+字符串必须报错");
    }),
  ],
});

SUITES.push({
  name: "value-strength",
  cases: [
    t("比较产生强值、随代码怎么跑不变", async () => {
      const r = await run("let a = 1 < 2; let a = 99; return a;");
      assertEq(r.result, 99, "后续赋值可推翻中值");
    }),
    t("done 只吃定性裁决", async () => {
      const r = await run('let a = 7; done a == 7 { print "对"; }');
      assertEq(r.out.join("|"), "对");
      assertEq(!!r.runtimeError, false);
    }),
    t("done 条件不成立=下一个事实，不走 else", async () => {
      const r = await run('let a = 1; done a == 7 { print "错，不该执行"; } print "done之后照常";');
      assertEq(r.out.join("|"), "done之后照常");
    }),
  ],
});

SUITES.push({
  name: "ledger",
  cases: [
    t("birth/consume 记账（开账本）", async () => {
      const r = await run("let a = 42; print a;", { ledger: true });
      const stages = r.ledger.entries.map(e => e.stage);
      assertEq(stages.includes("birth"), true, "有出生记录");
      assertEq(stages.includes("consume"), true, "有消费记录");
    }),
    t("账本可关闭且不产生条目", async () => {
      const r = await run("let a = 42; print a;", { ledger: false });
      assertEq(r.ledger.entries.length, 0, "关闭时零条目");
    }),
    t("账本实例可注入（并发隔离）", async () => {
      const l1 = new Ledger(true);
      await run("let a = 1; print a;", { ledgerInstance: l1 });
      const l2 = new Ledger(true);
      await run("let b = 2; print b;", { ledgerInstance: l2 });
      assertEq(l1.entries.length > 0 && l2.entries.length > 0, true, "两个账本独立产生条目");
      assertEq(l1.entries[0].where, "let a", "账本1只记自己的");
    }),
  ],
});

SUITES.push({
  name: "syntax-boundary",
  cases: [
    t("缺分号报语法错", async () => {
      const r = await run("let a = 1 print a;");
      assertEq(r.parseErrors.length > 0, true, "缺分号应产生语法错误");
    }),
    t("报错代码照样有产出（panic mode）", async () => {
      const r = await run("let a = 1 print a; let b = 2; return b;");
      assertEq(r.parseErrors.length > 0, true);
      assertEq(r.runtimeError, null, "后面语句照常执行");
    }),
    t("不闭合的字符串报词法错", async () => {
      const r = await run('print "oops;');
      assertEq(r.lexErrors.length > 0, true);
    }),
    t("无隐式转换：不同类型比大小报错", async () => {
      const r = await run('let a = 1 < "2";');
      assertEq(!!r.runtimeError, true);
    }),
  ],
});

SUITES.push({
  name: "concurrency",
  cases: [
    t("实例间环境隔离（模拟并发竞态）", async () => {
      const runs = [];
      for (let i = 0; i < 20; i++) runs.push(await run(`let x = ${i}; return x;`));
      runs.forEach((r, i) => assertEq(r.result, i, `第${i}个实例结果独立`));
    }),
    t("并发下账本互不串写", async () => {
      const ledgerA = new Ledger(true), ledgerB = new Ledger(true);
      await run("let a = 1;", { ledgerInstance: ledgerA });
      await run("let b = 2;", { ledgerInstance: ledgerB });
      const aStage = ledgerA.entries.map(e => e.where);
      const bStage = ledgerB.entries.map(e => e.where);
      assertEq(aStage.includes("let b"), false, "A账本没有B的出生");
      assertEq(bStage.includes("let a"), false, "B账本没有A的出生");
    }),
  ],
});

SUITES.push({
  name: "functions",
  cases: [
    t("函数定义与调用", async () => {
      const r = await run("fun add(a, b) { return a + b; } let s = add(3, 4); return s;");
      assertEq(r.result, 7);
      assertEq(!!r.runtimeError, false);
    }),
    t("arity 严格：传错个数报错", async () => {
      const r = await run("fun add(a, b) { return a + b; } let s = add(3);");
      assertEq(!!r.runtimeError, true, "传错个数必须报错");
      assertEq(r.runtimeError.message.includes("2 个参数"), true, "错误信息要说清期望几个");
    }),
    t("递归 fib(10)=55（done 当递归出口）", async () => {
      const r = await run('fun fib(n) { done n < 2 { return n; } return fib(n-1) + fib(n-2); } return fib(10);');
      assertEq(r.result, 55);
      assertEq(!!r.runtimeError, false);
    }),
    t("函数是值：可以存进变量再调用（名字会撒谎）", async () => {
      const r = await run("fun greet() { return 42; } let g = greet; return g();");
      assertEq(r.result, 42, "var g = greet 拿到函数值，g() 照常调用");
    }),
  ],
});

SUITES.push({
  name: "stdlib",
  cases: [
    t("clock 返回数字", async () => {
      const r = await run("let t = clock(); return t;");
      assertEq(typeof r.result === "number", true, "clock 应是数字");
    }),
    t("len 量字符串", async () => {
      const r = await run('let n = len("hello"); return n;');
      assertEq(r.result, 5);
    }),
    t("len 量非字符串报错", async () => {
      const r = await run("let n = len(42);");
      assertEq(!!r.runtimeError, true, "len 只吃字符串");
    }),
    t("type 返回类型名", async () => {
      const r = await run('let t = type("x"); return t;');
      assertEq(r.result, "string");
    }),
  ],
});

SUITES.push({
  name: "strength-static",
  cases: [
    t("静态 pass 写好字面量=strong", async () => {
      const r = await run("let a = 42; return a;");
      assertEq(r.parseErrors.length, 0);
      assertEq(r.runtimeError, null);
    }),
    t("比较结果在账本里 strength=strong", async () => {
      const ledger = new Ledger(true);
      const r = await run('let a = 1 == 1; print a;', { ledgerInstance: ledger });
      const compEntry = ledger.entries.find(e => e.stage === "birth" && e.strength === "strong");
      assertEq(!!compEntry, true, "比较的结果应以 strong 记入账本");
    }),
    t("算术结果在账本里 strength=medium", async () => {
      const ledger = new Ledger(true);
      const r = await run("let a = 1 + 2; print a;", { ledgerInstance: ledger });
      const arithEntry = ledger.entries.find(e => e.stage === "birth" && e.strength === "medium");
      assertEq(!!arithEntry, true, "算术的结果应以 medium 记入账本");
    }),
  ],
});

SUITES.push({
  name: "loops",
  cases: [
    t("while 计数求和", async () => {
      const r = await run("let i = 0; let s = 0; while (i < 5) { s = s + i; i = i + 1; } return s;");
      assertEq(r.result, 10);     // 0+1+2+3+4
      assertEq(!!r.runtimeError, false);
    }),
    t("while 退出记 while_exit 账", async () => {
      const ledger = new Ledger(true);
      const r = await run("let i = 0; while (i < 3) { i = i + 1; }", { ledgerInstance: ledger });
      assertEq(ledger.entries.some(e => e.stage === "while_exit"), true, "退出要记一笔");
    }),
    t("for 三件套经典计数", async () => {
      const r = await run("let s = 0; for (i = 0; i < 6; i = i + 1) { s = s + i; } return s;");
      assertEq(r.result, 15);     // 0+1+...+5
    }),
    t("for 退出记 for_exit 账", async () => {
      const ledger = new Ledger(true);
      const r = await run("for (i = 0; i < 2; i = i + 1) { print i; }", { ledgerInstance: ledger });
      assertEq(ledger.entries.some(e => e.stage === "for_exit"), true, "for 退出也要记账");
    }),
    t("赋值表达式给变量换值（中值承诺）", async () => {
      const r = await run("let x = 0; x = 7; return x;");
      assertEq(r.result, 7);
    }),
  ],
});

SUITES.push({
  name: "arrays",
  cases: [
    t("数组字面量与索引", async () => {
      const r = await run("let a = [10, 20, 30]; return a[1];");
      assertEq(r.result, 20);
    }),
    t("数组配合循环求和", async () => {
      const r = await run("let a = [1, 2, 3, 4]; let i = 0; let s = 0; while (i < len(a)) { s = s + a[i]; i = i + 1; } return s;");
      assertEq(r.result, 10);
    }),
    t("索引越界报错（不静默）", async () => {
      const r = await run("let a = [1, 2]; return a[5];");
      assertEq(!!r.runtimeError, true, "越界必须报错");
    }),
    t("对非数组用索引报错", async () => {
      const r = await run("let x = 5; return x[0];");
      assertEq(!!r.runtimeError, true, "非数组不能索引");
    }),
    t("len 量数组", async () => {
      const r = await run("let a = [1, 2, 3, 4, 5]; return len(a);");
      assertEq(r.result, 5);
    }),
  ],
});

SUITES.push({
  name: "closures",
  cases: [
    t("闭包快照：声明时刻的值定格，不随调用者环境变", async () => {
      // 第11章经典病：函数在 a="outer" 时声明，之后 a 改成别的，闭包还得看 old
      const r = await run('let x = "定义时"; fun see() { return x; } x = "改掉了"; return see();');
      assertEq(r.result, "定义时", "闭包应捕获声明时刻的值");
    }),
    t("函数是值传出去后环境变了，闭包仍持旧值", async () => {
      const r = await run('let base = 10; fun getter() { return base; } let fn = getter; base = 99; return fn();');
      assertEq(r.result, 10, "fn 是在 base=10 时抽离的，之后 base 变了 fn 也不该变");
    }),
    t("递归 fib 仍正常（快照里能看见自己）", async () => {
      const r = await run('fun fib(n) { done n < 2 { return n; } return fib(n-1) + fib(n-2); } return fib(10);');
      assertEq(r.result, 55);
      assertEq(!!r.runtimeError, false);
    }),
  ],
});

SUITES.push({
  name: "boundaries",
  cases: [
    t("while 死循环被护栏拦住（小上限注入）", async () => {
      const r = await run("let i = 0; while (i < 1) { i = i * 2; }", { loopLimit: 10 });
      assertEq(!!r.runtimeError, true, "死循环必须被拦");
      assertEq(r.runtimeError.message.includes("10"), true, "报错要写清上限值");
    }),
    t("for 死循环被护栏拦住", async () => {
      const r = await run("for (i = 0; i < 1; i = i * 2) { i = i + 0; }", { loopLimit: 10 });
      assertEq(!!r.runtimeError, true, "for 死循环必须被拦");
    }),
    t("深递归被护栏拦住（小上限注入）", async () => {
      const r = await run("fun go(n) { return go(n + 1); } return go(0);", { depthLimit: 5 });
      assertEq(!!r.runtimeError, true, "深递归必须被拦");
      assertEq(r.runtimeError.message.includes("5"), true, "报错要写清深度上限");
    }),
    t("递归贴上限仍能跑通", async () => {
      const r = await run("fun go(n) { done n > 7 { return n; } return go(n + 1); } return go(0);", { depthLimit: 8 });
      assertEq(r.result, 8, "在护栏内应正常完成");
    }),
    t("正常循环不受护栏干扰", async () => {
      const r = await run("let i = 0; let s = 0; while (i < 5) { s = s + i; i = i + 1; } return s;", { loopLimit: 50 });
      assertEq(r.result, 10, "正常循环不该被误杀");
    }),
  ],
});

SUITES.push({
  name: "logical",
  cases: [
    t("&& 真真为真", async () => {
      const r = await run("return true && true;");
      assertEq(r.result, true);
    }),
    t("&& 真假为假", async () => {
      const r = await run("return true && false;");
      assertEq(r.result, false);
    }),
    t("|| 假真为真", async () => {
      const r = await run("return false || true;");
      assertEq(r.result, true);
    }),
    t("|| 假假为假", async () => {
      const r = await run("return false || false;");
      assertEq(r.result, false);
    }),
    t("&& 混进比较", async () => {
      const r = await run("let a = 5; return a > 3 && a < 10;");
      assertEq(r.result, true);
    }),
  ],
});

SUITES.push({
  name: "strict-eq",
  cases: [
    t("=== 类型严格一致才相等", async () => {
      const r = await run('print 1 === 1; print 1 === "1"; print "a" === "a";');
      assertEq(r.out.join("|"), "true|false|true");
    }),
    t("!== 类型不同直接不等", async () => {
      const r = await run('print 1 !== "1"; print 1 !== 2;');
      assertEq(r.out.join("|"), "true|true");
    }),
    t("=== 是强值（无时效裁决）", async () => {
      const r = await run("let a = 1 === 1; return a;");
      assertEq(r.result, true);
    }),
    t("== 动态对等（或许态）", async () => {
      const r = await run('print 1 == 1; print 1 == "1";');
      assertEq(r.out.join("|"), "true|false");  // 免语言 == 也不隐式转换
    }),
  ],
});

SUITES.push({
  name: "multi-return",
  cases: [
    t("多值返回 + 解构", async () => {
      const r = await run("fun div(a, b) { return a / b, a - b * (a / b); } let (q, r) = div(10, 3); return q;");
      assertEq(r.runtimeError, null);
    }),
    t("解构两个变量都对", async () => {
      const r = await run("fun pair() { return 1, 2; } let (x, y) = pair(); return x + y;");
      assertEq(r.result, 3);
    }),
    t("解构个数不足报错", async () => {
      const r = await run("fun one() { return 1; } let (x, y) = one();");
      assertEq(!!r.runtimeError, true, "右侧只有1个值，解构要2个必须报错");
    }),
  ],
});
SUITES.push({
  name: "dict",
  cases: [
    t("字典字面量与键访问", async () => {
      const r = await run('let d = {"name": "望安", "age": 3}; return d["name"];');
      assertEq(r.result, "望安");
    }),
    t("字典长度", async () => {
      const r = await run('let d = {"a": 1, "b": 2, "c": 3}; return len(d);');
      assertEq(r.result, 3);
    }),
    t("字典缺键报错", async () => {
      const r = await run('let d = {"a": 1}; return d["nope"];');
      assertEq(!!r.runtimeError, true, "缺键必须报错，不静默");
    }),
    t("字典嵌套", async () => {
      const r = await run('let d = {"u": {"name": "望安"}}; return d["u"]["name"];');
      assertEq(r.result, "望安");
    }),
  ],
});

SUITES.push({
  name: "if-else",
  cases: [
    t("if 真分支", async () => {
      const r = await run("let a = 5; if a > 3 { print \"大\"; } else { print \"小\"; }");
      assertEq(r.out.join("|"), "大");
    }),
    t("if 假分支", async () => {
      const r = await run("let a = 1; if a > 3 { print \"大\"; } else { print \"小\"; }");
      assertEq(r.out.join("|"), "小");
    }),
    t("else if 链", async () => {
      const r = await run("let b = 7; if b > 10 { print \"A\"; } else if b > 5 { print \"B\"; } else { print \"C\"; }");
      assertEq(r.out.join("|"), "B");
    }),
    t("if 不带 else 也可以", async () => {
      const r = await run("let a = 1; if a > 3 { print \"走不到\"; } print \"done\";");
      assertEq(r.out.join("|"), "done");
    }),
  ],
});

SUITES.push({ name: "ref", cases: [
    t("ref 创建引用并 read", async () => {
      const r = await run("let x = 5; let r = ref x; print read(r);");
      assertEq(r.out.join("|"), "5");
    }),
    t("write 通过引用改目标", async () => {
      const r = await run("let x = 5; let r = ref x; write(r, 99); print read(r);");
      assertEq(r.out.join("|"), "99");
    }),
    t("write 改的是真实变量", async () => {
      const r = await run("let x = 5; let r = ref x; write(r, 7); print x;");
      assertEq(r.out.join("|"), "7");
    }),
    t("引用指向的名字仍读最新值", async () => {
      const r = await run("let a = 1; let r = ref a; let a = 2; print read(r);");
      assertEq(r.out.join("|"), "2");
    }),
    t("ref 数组元素", async () => {
      const r = await run("let a = [10, 20, 30]; let r = ref a[1]; write(r, 99); print a[1];");
      assertEq(r.out.join("|"), "99");
    }),
    t("ref 字典值", async () => {
      const r = await run('let d = {"age": 3}; let r = ref d["age"]; write(r, 4); print d["age"];');
      assertEq(r.out.join("|"), "4");
    }),
    t("ref 嵌套数组元素", async () => {
      const r = await run("let m = [[1,2],[3,4]]; let r = ref m[1][0]; write(r, 88); print m[1][0];");
      assertEq(r.out.join("|"), "88");
    }),
  ] });

function stressSuites(scale) {
  return [
    {
      name: "stress-bigloop",
      cases: [
        t("大循环求和（scale 注入）", async () => {
          const n = scale;
          const expected = (n - 1) * n / 2;   // 0+1+...+(n-1)
          const r = await run(`let i = 0; let s = 0; while (i < ${n}) { s = s + i; i = i + 1; } return s;`, { loopLimit: n + 10 });
          assertEq(r.result, expected, "大循环求和应精确");
        }),
      ],
    },
    {
      name: "stress-bigarray",
      cases: [
        t("大数组真构造 + 逐项读求和", async () => {
          const n = Math.min(scale, 2000);
          const expected = (n - 1) * n / 2;
          // 真压数组：拼出 [0,1,2,...,n-1] 的字面量源码，构造 n 元素数组后逐项读
          const body = Array.from({ length: n }, (_, i) => i).join(", ");
          const src = `let a = [${body}]; let j = 0; let s = 0; while (j < len(a)) { s = s + a[j]; j = j + 1; } return s;`;
          const r = await run(src, { loopLimit: n + 10 });
          assertEq(r.runtimeError, null, "大数组读求和不该报错：" + (r.runtimeError && r.runtimeError.message));
          assertEq(r.result, expected, "大数组逐项读求和应精确");
        }),
      ],
    },
    {
      name: "stress-deeprecursion",
      cases: [
        t("真深递归直降 N 层（护栏内）", async () => {
          const depth = Math.min(scale, 400);
          const src = `fun go(n) { done n <= 0 { return 0; } return go(n - 1) + 1; } return go(${depth});`;
          const r = await run(src, { depthLimit: depth + 50 });
          assertEq(r.runtimeError, null, "深度内不该被拦：" + (r.runtimeError && r.runtimeError.message));
          assertEq(r.result, depth, "递归层数应恰好回传");
        }),
        t("大深度突破护栏仍被拦", async () => {
          const depth = Math.min(scale, 400);
          const src = `fun go(n) { done n <= 0 { return 0; } return go(n - 1) + 1; } return go(${depth});`;
          const r = await run(src, { depthLimit: Math.max(10, depth - 20) });
          assertEq(!!r.runtimeError, true, "突破深度护栏必须被拦");
        }),
      ],
    },
  ];
}

// ── 运行器 ──
async function main() {
  const args = process.argv.slice(2);
  const only = (args.find(a => a.startsWith("--only=")) || "").split("=")[1];
  const verbose = args.includes("--verbose");
  const filter = (args.find(a => a.startsWith("--filter=")) || "").split("=")[1];
  const stress = args.includes("--stress");
  const thr = (args.find(a => a.startsWith("--threshold=")) || "").split("=")[1];

  // --threshold=N 调边界与规模；--stress 只负责挂载压测套件（规模默认大档 1000，可被 threshold 覆盖）
  if (thr) {
    const n = parseInt(thr, 10);
    if (!Number.isNaN(n) && n > 0) {
      testConfig.loopLimit = n;
      testConfig.depthLimit = Math.min(n, 500);
      testConfig.large = n;
    }
  }

  // 压测套件挂载
  const dynamicSuites = stress ? stressSuites(testConfig.large) : [];

  let total = 0, passed = 0;
  const failures = [];

  const allSuites = [...SUITES, ...dynamicSuites];
  for (const suite of allSuites) {
    if (only && suite.name !== only) continue;
    const cases = filter ? suite.cases.filter(c => c.name.includes(filter)) : suite.cases;
    for (const c of cases) {
      total++;
      const r = await c.promise;
      if (r.pass) passed++;
      else failures.push(`${suite.name}/${c.name}: ${r.error}`);
      if (verbose || !r.pass) {
        console.log(`  ${r.pass ? "✓" : "✗"} ${suite.name} · ${c.name}${r.pass ? "" : " → " + r.error}`);
      }
    }
  }

  console.log("\n=== 汇总：", `${passed}/${total}` + " 通过", stress ? `（压测规模 ${testConfig.large}）` : "", "===");
  if (failures.length) {
    for (const f of failures) console.error("失败:", f);
    process.exit(1);
  }
}

// 只在直接运行时才执行 main；被 require 时不杀进程
if (require.main === module) {
  main().then(() => process.exit(0));
}

module.exports = { run, t, assertEq, assertThrows, SUITES, testConfig, stressSuites };