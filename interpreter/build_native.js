#!/usr/bin/env node
// 编译免语言 C++ 原生执行器
// 用法：node build_native.js
// 说明：/sdcard 无执行位，二进制必须编译到 /tmp（Android FUSE 限制）
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "native", "mian_native.cpp");
const OUT = "/tmp/mian_native";

if (!fs.existsSync(SRC)) {
  console.error(`✗ C++ 源码不存在: ${SRC}`);
  process.exit(1);
}

console.log("编译免语言 C++ 原生执行器...");
const r = spawnSync("g++", ["-std=c++17", "-O2", SRC, "-o", OUT], { encoding: "utf8" });
if (r.status !== 0) {
  console.error("✗ 编译失败:");
  console.error(r.stderr || r.stdout);
  process.exit(1);
}

console.log(`✓ 编译成功: ${OUT}`);
console.log(`  用法: ${OUT} <文件.mi>`);
process.exit(0);