// ── 三身体对拍验收：JS 解释器 vs C++ 原生执行器 ──
// 同一份 .mi，两具身体输出必须逐字一致（三身体铁律）
// 用法：node test_cpp_native.js   （需 g++，二进制在 /tmp 编译）
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const NATIVE_SRC = "/storage/emulated/0/Download/Operit/免语言/native/mian_native.cpp";
const WORK = "/tmp/mian_cpp_check";
const BIN = "/tmp/mian_native";

// ── 对拍用例：只放两具身体都支持的功能 ──
// （C++ 暂无 for；JS 已支持全部。诚实差距另列）
const CASES = [
  ["算术优先级", "let a = 1 + 2 * 3; print a;"],
  ["布尔回禀", 'done 1 < 2 { print "true"; } done 1 > 2 { print "false"; } print 7;'],
  ["while 求和", "let i = 0; let s = 0; while (i < 5) { s = s + i; i = i + 1; } print s;"],
  ["for 求和", "let s = 0; for (i = 0; i < 6; i = i + 1) { s = s + i; } print s;"],
  ["函数与递归", "fun fib(n) { done n < 2 { return n; } return fib(n-1) + fib(n-2); } print fib(10);"],
  ["数组求和", "let a = [1, 2, 3, 4]; let i = 0; let s = 0; while (i < len(a)) { s = s + a[i]; i = i + 1; } print s; print a[2];"],
  ["字符串与.len", 'let h = "hello"; print h.len; print len("abc"); print str(7);'],
  ["ref 引用", "let x = 5; let r = ref x; print read(r); write(r, 99); print read(r); print x;"],
  ["类型回禀", "print type(42); print type(\"x\"); print type([1,2]);"],
  ["赋值换值", "let x = 0; x = 7; print x;"],
  ["逻辑与比较", "print 5 > 3 && 5 < 10; print !false;"],
];

// ── 编译 C++（源码更新或二进制缺失才重编）──
function ensureNative() {
  if (!fs.existsSync(NATIVE_SRC)) return "C++ 源码不存在: " + NATIVE_SRC;
  if (!fs.existsSync(BIN) || fs.statSync(BIN).mtimeMs < fs.statSync(NATIVE_SRC).mtimeMs) {
    fs.mkdirSync("/tmp", { recursive: true });
    fs.copyFileSync(NATIVE_SRC, "/tmp/mian_native_src.cpp");
    const r = spawnSync("g++", ["-std=c++17", "-O2", "/tmp/mian_native_src.cpp", "-o", BIN], { encoding: "utf8" });
    if (r.status !== 0) return "C++ 编译失败: " + (r.stderr || "").slice(0, 500);
  }
  return null;
}

// ── 跑一具身体 ──
function runJS(srcFile) {
  const mian = "/storage/emulated/0/Download/Operit/免语言/interpreter/mian.js";
  const r = spawnSync(process.execPath, [mian, srcFile], { encoding: "utf8", cwd: WORK });
  return { code: r.status, out: (r.stdout || "").trim() };
}
function runCpp(srcFile) {
  const r = spawnSync(BIN, [srcFile], { encoding: "utf8", cwd: WORK });
  return { code: r.status, out: (r.stdout || "").trim() };
}

// ── 主流程 ──
let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}

(async () => {
  console.log("=== 编译 C++ 原生执行器 ===");
  const err = ensureNative();
  if (err) { console.error("✗ " + err); process.exit(1); }
  console.log("  ✓ 就绪");

  fs.mkdirSync(WORK, { recursive: true });
  // import 用例需要库文件
  fs.writeFileSync(path.join(WORK, "lib.mi"), "fun double(x) { return x * 2; }\nlet greeting = \"你好，欢迎导入。\";\n");
  CASES.push(["import 跨文件", 'import "lib.mi"; print double(21); print greeting;']);

  console.log("=== 三身体对拍（JS 解释器 vs C++ 原生）===");
  for (const [name, src] of CASES) {
    const file = path.join(WORK, "case.mi");
    fs.writeFileSync(file, src);
    const js = runJS(file);
    const cpp = runCpp(file);
    const sameOut = js.out === cpp.out;
    const bothOk = js.code === 0 && cpp.code === 0;
    check(name, sameOut && bothOk, `\n    JS:  ${JSON.stringify(js.out)}\n    C++: ${JSON.stringify(cpp.out)}`);
  }

  console.log(`\n=== 三身体对拍：${pass}/${pass + fail} 一致 ===`);
  process.exit(fail === 0 ? 0 : 1);
})();