// 报错库测试：验证每个错误码在正确时机被触发，不静默
// 原则：测试不是"代码能跑"，是"该报错时一定报、不该报时不乱报"
const { run, t, assertEq, SUITES } = require("./test_runner");

// ── 辅助：断言报错且带指定错误码 ──
function assertErrorCode(r, code, msg) {
  if (!r.runtimeError) throw new Error(`${msg || ""}：期望报错 ${code}，但没报错`);
  if (r.runtimeError.code !== code) throw new Error(`${msg || ""}：期望 ${code}，实际 ${r.runtimeError.code}（${r.runtimeError.message}）`);
}

SUITES.push({
  name: "errors-code",
  cases: [
    // ── 模板 1：xx 不能直接作为 xx 存在 ──
    t("E901 数字不能作为数组索引用", async () => {
      const r = await run("let x = 5; return x[0];");
      assertErrorCode(r, "E901", "数字当数组索引");
    }),
    t("E204 数组用字符串键报错", async () => {
      const r = await run('let a = [1,2]; return a["x"];');
      assertErrorCode(r, "E204", "数组用字符串键");
    }),
    t("E205 字典用数字索引报错", async () => {
      const r = await run('let d = {"a":1}; return d[0];');
      assertErrorCode(r, "E205", "字典用数字索引");
    }),
    t("E206 字典缺键报错", async () => {
      const r = await run('let d = {"a":1}; return d["nope"];');
      assertErrorCode(r, "E206", "字典缺键");
    }),

    // ── 模板 2：逻辑冲突 ──
    t("E081 变量未声明报错", async () => {
      const r = await run("return nope;");
      assertErrorCode(r, "E081", "未声明变量");
    }),

    // ── 模板 3：xx 不能具备 xx ──
    t("E911 对象没有属性报错", async () => {
      const r = await run('let x = 5; return x.len;');
      assertErrorCode(r, "E911", "数字没有属性");
    }),
    t("E912 赋值目标不是变量报错", async () => {
      const r = await run("5 = 3;");
      assertErrorCode(r, "E912", "赋值目标不是变量");
    }),

    // ── 模板 4：xx 过多 ──
    t("E402 while 死循环被拦", async () => {
      const r = await run("let i = 0; while (i < 1) { i = i * 2; }", { loopLimit: 10 });
      assertErrorCode(r, "E402", "while 死循环");
    }),
    t("E403 for 死循环被拦", async () => {
      const r = await run("for (i = 0; i < 1; i = i * 2) { i = i + 0; }", { loopLimit: 10 });
      assertErrorCode(r, "E403", "for 死循环");
    }),
    t("E404 递归太深被拦", async () => {
      const r = await run("fun go(n) { return go(n + 1); } return go(0);", { depthLimit: 5 });
      assertErrorCode(r, "E404", "递归太深");
    }),

    // ── 模板 5：无 xx ──
    t("E903 len 不支持数字报错", async () => {
      const r = await run("return len(42);");
      assertErrorCode(r, "E903", "len 不支持数字");
    }),
    t("E904 chr 需要数字报错", async () => {
      const r = await run('return chr("x");');
      assertErrorCode(r, "E904", "chr 需要数字");
    }),
    t("E905 get 第一个参数要是字典", async () => {
      const r = await run('return get(42, "x");');
      assertErrorCode(r, "E905", "get 首参非字典");
    }),

    // ── 八步法：第 1 步 符号解析 ──
    // (E081 已覆盖)

    // ── 八步法：第 2 步 前提检查 ──
    t("E202 不同类型比大小报错", async () => {
      const r = await run('return 1 < "2";');
      assertErrorCode(r, "E202", "不同类型比大小");
    }),
    t("E207 除数为零报错", async () => {
      const r = await run("return 1 / 0;");
      assertErrorCode(r, "E207", "除数为零");
    }),

    // ── 八步法：第 4 步 控制流 ──
    t("E401 done 用弱值报错", async () => {
      const r = await run("let a = 1; done a == 2 { print 1; }");
      // done 用 == 是弱值，应报 contract
      assertErrorCode(r, "E401", "done 弱值");
    }),

    // ── 八步法：第 5 步 身份检查 ──
    t("E501 非函数调用报错", async () => {
      const r = await run("let x = 42; return x();");
      assertErrorCode(r, "E501", "非函数调用");
    }),
    t("E203 arity 严格报错", async () => {
      const r = await run("fun f(a, b) { return a + b; } return f(1);");
      assertErrorCode(r, "E203", "arity 错误");
    }),

    // ── 八步法：第 7 步 系统沉默 ──
    t("E701 数组索引越界报错", async () => {
      const r = await run("let a = [1, 2]; return a[5];");
      assertErrorCode(r, "E701", "索引越界");
    }),
    t("E702 字符串索引越界报错", async () => {
      const r = await run('let s = "hi"; return s[5];');
      assertErrorCode(r, "E702", "字符串索引越界");
    }),
    t("E906 解构右边不是数组报错", async () => {
      const r = await run("let (x, y) = 42;");
      assertErrorCode(r, "E906", "解构非数组");
    }),
    t("E907 解构个数不足报错", async () => {
      const r = await run("fun one() { return 1; } let (x, y) = one();");
      assertErrorCode(r, "E907", "解构个数不足");
    }),

    // ── 运行时 vs 编译期合规 ──
    t("合规代码不报错", async () => {
      const r = await run("let a = 1 + 2; return a;");
      if (r.runtimeError) throw new Error("合规代码不应报错：" + r.runtimeError.message);
    }),
    t("正常函数调用不报错", async () => {
      const r = await run("fun add(a, b) { return a + b; } return add(1, 2);");
      if (r.runtimeError) throw new Error("正常调用不应报错：" + r.runtimeError.message);
    }),
    t("正常数组索引不报错", async () => {
      const r = await run("let a = [10, 20]; return a[1];");
      if (r.runtimeError) throw new Error("正常索引不应报错：" + r.runtimeError.message);
    }),
  ],
});