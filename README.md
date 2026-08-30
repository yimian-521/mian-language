# 免语言（Mian）

> Python 级写感 + C 级性能，一门"免于二选一"的原创编程语言。

[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-v0.5.0-brightgreen)](CHANGELOG.md)

**不模仿、不套壳**——手写 lexer/parser/求值器/字节码 VM/C++ 原生执行器，原创概念（值强度 / 五段账本 / done 定性态）真正定义成语法，目标是让语言自己写自己（自举）。

## 快速开始

```bash
cd interpreter
node mian.js examples/key_audit.mi     # 跑一个示例
node mian.js your_file.mi              # 跑你的 .mi 文件
node mian.js your_file.mi --ledger     # 开五段账本，看每个值的一生
node mian.js test                      # 一键验收（65 测试 + 双身体对拍 + 三身体对拍 + 三件套 + 边界 + import）
```

## 安装为命令

```bash
cd interpreter
npm link        # 之后可以用 mian 命令
mian hello.mi
```

## 语言速览

```js
// 一切皆函数
fun fib(n) { done n < 2 { return n; } return fib(n-1) + fib(n-2); }
print fib(10);            // 55

// done = 定性态（事实裁决），if = 或许态（试探分叉）
done 1 + 1 == 2 { print "事实"; }
if 5 > 3 { print "大"; } else { print "小"; }

// 值强度三档等值
let a = 1;
print a == 1;     // true   动态对等（或许态）
print a === "1";  // false  静态比较（类型严格）
print a === 1;    // true

// 数组、字典、多返回、解构
let d = {"name": "望安", "age": 3};
print d["name"];                  // 望安
fun div(a, b) { return a / b, a - b * (a / b); }
let (q, r) = div(10, 3);
print r;                          // 0（余数）

// import 跨文件
import "math_utils.mi";
print double(21);                 // 42
```

## 三身体（行为一致性铁律）

同一份 `.mi`，三具身体输出必须逐字一致：

| 身体 | 文件 | 说明 |
|---|---|---|
| JS 树游解释器 | `evaluator.js` | 快速工作台 |
| JS 字节码 VM | `compiler.js` + `vm.js` | 对拍镜 |
| C++ 原生执行器 | `../native/mian_native.cpp` | 零 Node 真身（/sdcard 无执行位，编译到 /tmp 跑） |

`mian test` 一条命令验三具身体没分叉。

## 原创概念

- **值强度**：if=弱值（可能世界）、赋值=中值（有时效承诺）、比较=强值（无时效裁决）；`===` 把定性比较定义成语法
- **五段账本**：每个值的一生（出生/存储/传输/消费/销毁）可追踪、默认可见
- **done 定性态**：不是 else 的 if，是"事实不成立=下一个事实"
- **机器被调用契约**：语言下命令，机器只回禀 [成功?, 数据|原因]，绝不插嘴决策

## 哲学

> 语言的本质是**可定义性**——只要有最小可定义单位（函数），就能定义一切可被定义的。不模仿别的语言，是真正创造：自举（语言自己写自己）是这个本质的终极形态。

## 目录

```
免语言/
├── 免语言框架.md        # 设计理念与决定（概念树，非日记）
├── 免语言标准语法.md    # 用户手册（教的都能跑）
├── 参考档案_内部.md     # 借/改/原创出处账本
├── 横向语言调研档案.md  # 各家语言取舍调研
├── interpreter/         # JS 解释器 + VM + CLI + 测试
├── native/              # C++ 原生执行器
└── process/             # 进程树（四层指挥体系，可定义一切）
```
