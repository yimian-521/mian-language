// ── 并发能力测试：spawn/sleep 真并发验证 ──
// 验证：①spawn 能并发跑多个免语言函数 ②结果正确聚合 ③真并发（耗时=最慢，不是总和）
// ④参数传递正确 ⑤闭包隔离
const { run, t, assertEq } = require("./test_runner");
const { makeStdlib } = require("./stdlib/machine_hands");

// 注入机器手（spawn/sleep/httpGet 等）
const hands = makeStdlib();

async function main() {
  let passed = 0, total = 0;
  const check = (name, fn) => {
    total++;
    return t(name, async () => { await fn(); passed++; });
  };
  const cases = [
    check("spawn 并发跑多个函数，结果正确", async () => {
      const r = await run("fun add(a,b){ return a+b; } let r = spawn([add, add], [[1,2],[10,20]]); return r[1][0][1] + r[1][1][1];", { machineHands: hands });
      assertEq(r.runtimeError, null, "spawn 不该报错: " + (r.runtimeError && r.runtimeError.message));
      assertEq(r.result, 33, "3 + 30 = 33");
    }),
    check("spawn 返回 [成功, 结果数组] 结构", async () => {
      const r = await run("fun id(x){ return x; } let r = spawn([id, id], [[7],[8]]); return r[0] == true && r[1][0][0] == true && r[1][0][1] == 7 && r[1][1][1] == 8;", { machineHands: hands });
      assertEq(r.result, true);
    }),
    check("spawn 真并发：耗时≈最慢引擎，不是总和", async () => {
      // 三个引擎 sleep 300/100/200ms——真并发应约 300ms，串行要 600ms
      const src = "fun a(){ sleep(300); return 1; } fun b(){ sleep(100); return 2; } fun c(){ sleep(200); return 3; } let r = spawn([a,b,c], [[],[],[]]); return r[1][0][1] + r[1][1][1] + r[1][2][1];";
      const t0 = Date.now();
      const r = await run(src, { machineHands: hands });
      const elapsed = Date.now() - t0;
      assertEq(r.runtimeError, null, "并发不该报错");
      assertEq(r.result, 6, "1+2+3=6");
      assertEq(elapsed < 500, true, `真并发应<500ms(最慢300)，实际 ${elapsed}ms`);
    }),
    check("spawn 闭包隔离：并发函数各自看自己的环境", async () => {
      const r = await run("let base = 10; fun get(){ return base; } let fn1 = get; base = 99; fun get2(){ return base; } let r = spawn([fn1, get2], [[],[]]); return r[1][0][1] + r[1][1][1];", { machineHands: hands });
      // fn1 闭包在 base=10 时声明=10；get2 在 base=99 时=99 → 109
      assertEq(r.result, 109, "fn1 看旧值10，get2 看新值99");
    }),
    check("spawn 非函数元素报错（不静默）", async () => {
      const r = await run("let r = spawn([42, 43], [[],[]]); return r[1][0][0];", { machineHands: hands });
      assertEq(r.result, false, "spawn 里非函数元素应返回 [false, ...]");
    }),
    check("sleep 返回 [true,0] 且等足时长", async () => {
      const t0 = Date.now();
      const r = await run("let r = sleep(100); return r[0];", { machineHands: hands });
      const elapsed = Date.now() - t0;
      assertEq(r.result, true, "sleep 返回成功");
      assertEq(elapsed >= 90, true, `sleep 应等≥90ms，实际 ${elapsed}ms`);
    }),
  ];
  for (const c of cases) {
    const res = await c.promise;
    if (res.pass) console.log(`  ✓ ${c.name}`);
    else { console.log(`  ✗ ${c.name} → ${res.error}`); process.exitCode = 1; }
  }
  console.log(`\n=== 并发能力：${passed}/${total} 通过 ===`);
  if (process.exitCode) process.exit(1);
  process.exit(0);
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });

module.exports = { main };