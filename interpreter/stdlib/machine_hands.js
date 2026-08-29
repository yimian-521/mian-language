// ── 免语言标准库（三件套：文件 / 网络 / 进程）──
// 基本盘：基本功不落后。这些是"机器的重活"，语言下命令、机器回禀。
// 契约：所有函数返回 [成功?, 数据|原因]——不抛、不吞、不替语言做决定（与问-答契约一致）。

const fs = require("fs");
const { exec } = require("child_process");

// ══ 文件 ══
// readFile(路径) → [true, 内容] | [false, 原因]（读不存在报错但不静默）
function readFileSyncNative(p) {
  try { return [true, fs.readFileSync(p, "utf8")]; }
  catch (e) { return [false, "read-error:" + e.message.slice(0, 80)]; }
}
function writeFileNative(p, content) {
  try { fs.writeFileSync(p, String(content), "utf8"); return [true, p]; }
  catch (e) { return [false, "write-error:" + e.message.slice(0, 80)]; }
}
function existsFile(p) {
  try { return [true, fs.existsSync(p)]; }
  catch (e) { return [false, "exists-error"]; }
}

// ══ 进程 ══
// run(命令) → [true, stdout] | [false, 原因]（进程侧重活，语言只管下命令、收结果）
function runCmd(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { timeout: 30000 }, (err, stdout, stderr) => {
      if (err) resolve([false, (err.message || "执行失败").slice(0, 120) + (stderr ? " | " + stderr.slice(0, 80) : "")]);
      else resolve([true, (stdout || "").trim()]);
    });
  });
}

// ══ 网络 ══
// httpGet(网址) → [true, 内容] | [false, 原因]
async function httpGetNative(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const resp = await fetch(url, { signal: controller.signal });
      if (!resp.ok) return [false, "HTTP " + resp.status];
      return [true, await resp.text()];
    } finally { clearTimeout(timer); }
  } catch (e) { return [false, "network-error:" + e.message.slice(0, 80)]; }
}

// ══ 并发 ══
// spawn(函数数组, 参数数组) → 并发跑多个函数，返回结果数组
// 函数数组 = [fnRef1, fnRef2, ...]，参数数组 = [args1, args2, ...]（每个 args 是实参数组）
// 返回 [true, [结果1, 结果2, ...]]——并发执行，全部完成才回（Promise.all）
// 这是 Search Vault "多引擎同时搜"的能力：语言把多个函数交给机器并行，机器干完一起回禀
async function spawnNative(fns, argLists) {
  try {
    if (!Array.isArray(fns)) return [false, "spawn 第一个参数要是函数数组"];
    const tasks = fns.map((fn, i) => {
      const args = (argLists && argLists[i]) || [];
      // 每个 fn 可能是函数引用（mfun）或原生函数——由语言侧保证可调用
      if (typeof fn === "function") return Promise.resolve().then(() => fn(...args));
      return Promise.resolve(fn);   // 非函数：原样返回（语言侧会报错）
    });
    const results = await Promise.all(tasks);
    return [true, results];
  } catch (e) { return [false, "spawn-error:" + (e && e.message || String(e)).slice(0, 120)]; }
}

// ══ 延时 ══
// sleep(毫秒) → 等 N 毫秒后返回 [true, 0]（异步等待的基础）
function sleepNative(ms) {
  return new Promise((resolve) => setTimeout(() => resolve([true, 0]), Math.max(0, ms || 0)));
}

// ══ 打包（语言侧的统一“机器手”）══
function makeStdlib() {
  return {
    readFile: readFileSyncNative,
    writeFile: writeFileNative,
    fileExists: existsFile,
    run: runCmd,
    httpGet: httpGetNative,
    spawn: spawnNative,
    sleep: sleepNative,
  };
}

module.exports = { makeStdlib, readFileSyncNative, writeFileNative, existsFile, runCmd, httpGetNative, spawnNative, sleepNative };