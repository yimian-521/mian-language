// 免语言——强度求解器（静态分析 pass）
// 灵感正是"接近处理器"：C/C++ 的类型不是运行时装的盒子，是编译期符号表里的裁决。
// 值强度同理——本 pass 在运行前把每个表达式节点的强度定死，贴在 node 上。
// 运行时求值器只"读"这个已裁决的强度，不重新计算。这 = 静态类型语言的前奏。

const { STRENGTH } = require("./evaluator");

// 内置原生名册：静态知道它们是"原生手"（调用结果=强值裁决）
const NATIVE_NAMES = new Set(["clock", "len", "type", "str"]);

class StrengthResolver {
  constructor() {
    // 符号栈：每一层是 Map(name -> { strength, kind })
    // kind: "value" | "fn"（用户函数） | "native"（宿主手）
    this.scopes = [];
  }

  resolve(statements, givenNames = null) {
    // 顶层：原生标准库 + 宿主注入的原生手都可静态声明
    this.scopes.push(new Map());
    for (const n of NATIVE_NAMES) {
      this.scopes[0].set(n, { strength: STRENGTH.STRONG, kind: "native" });
    }
    if (givenNames) {
      for (const n of givenNames) {
        this.scopes[0].set(n, { strength: STRENGTH.STRONG, kind: "native" });
      }
    }
    for (const s of statements) this.decl(s);
    this.scopes.pop();
  }

  // 当前层查名字（从内到外）
  lookup(name) {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const hit = this.scopes[i].get(name);
      if (hit) return hit;
    }
    return null;
  }

  decl(stmt) {
    switch (stmt.kind) {
      case "let":
        // 先求 initializer（其强度已贴到子节点）
        this.expr(stmt.initializer);
        // let 绑定的变量 = 中值（有时效承诺）
        this.scopes[this.scopes.length - 1].set(stmt.name.lexeme, { strength: STRENGTH.MEDIUM, kind: "value" });
        stmt.staticStrength = STRENGTH.MEDIUM;
        break;
      case "letDestructure":
        this.expr(stmt.initializer);
        for (const n of stmt.names) {
          this.scopes[this.scopes.length - 1].set(n, { strength: STRENGTH.MEDIUM, kind: "value" });
        }
        stmt.staticStrength = STRENGTH.MEDIUM;
        break;
      case "fun": {
        // 函数定义=强值事实；函数名先于 body 入簿，支持递归
        this.scopes[this.scopes.length - 1].set(stmt.name, { strength: STRENGTH.STRONG, kind: "fn" });
        stmt.staticStrength = STRENGTH.STRONG;
        // body 新作用域
        this.scopes.push(new Map());
        for (const p of stmt.params) {
          this.scopes[this.scopes.length - 1].set(p, { strength: STRENGTH.MEDIUM, kind: "value" }); // 参数=中值
        }
        for (const s of stmt.body) this.decl(s);
        this.scopes.pop();
        break;
      }
      case "print":
        this.expr(stmt.value);
        break;
      case "return":
        this.expr(stmt.value);
        break;
      case "if":
        this.expr(stmt.condition);
        this.scopes.push(new Map());
        for (const s of stmt.thenBranch) this.decl(s);
        this.scopes.pop();
        if (stmt.elseBranch) {
          this.scopes.push(new Map());
          for (const s of stmt.elseBranch) this.decl(s);
          this.scopes.pop();
        }
        stmt.staticStrength = STRENGTH.WEAK;   // if = 或许态 = 弱值（可能世界）
        stmt.staticBorn = "if";
        break;
      case "done":
        this.expr(stmt.condition);
        this.scopes.push(new Map());
        for (const s of stmt.statements) this.decl(s);
        this.scopes.pop();
        break;
      case "while":
        this.expr(stmt.condition);
        this.scopes.push(new Map());
        for (const s of stmt.body) this.decl(s);
        this.scopes.pop();
        stmt.staticStrength = STRENGTH.WEAK;  // 循环不产单一裁决，产可能路径
        break;
      case "for":
        if (stmt.init) this.expr(stmt.init);
        if (stmt.condition) this.expr(stmt.condition);
        this.scopes.push(new Map());
        for (const s of stmt.body) this.decl(s);
        this.scopes.pop();
        if (stmt.increment) this.expr(stmt.increment);
        stmt.staticStrength = STRENGTH.WEAK;
        break;
      case "block":
        this.scopes.push(new Map());
        for (const s of stmt.statements) this.decl(s);
        this.scopes.pop();
        break;
      case "exprStmt":
        this.expr(stmt.expr);
        break;
      default:
        break; // 未知语句类型不下断言——运行时会报
    }
  }

  expr(node) {
    if (!node) return;
    switch (node.kind) {
      case "literal":
        node.staticStrength = STRENGTH.STRONG;
        node.staticBorn = "literal";
        break;
      case "variable": {
        const hit = this.lookup(node.name);
        // 静态解不出来的（比如用了没声明）留给运行时报"未声明"；不在这里断言
        node.staticStrength = hit ? hit.strength : null;
        node.staticKind = hit ? hit.kind : null;
        node.staticBorn = hit ? `ref ${node.name}` : null;
        break;
      }
      case "grouping":
        this.expr(node.expr);
        node.staticStrength = node.expr.staticStrength;   // 透传
        break;
      case "unary":
        this.expr(node.right);
        node.staticStrength = STRENGTH.MEDIUM;
        break;
      case "binary": {
        this.expr(node.left);
        this.expr(node.right);
        const op = node.operator.lexeme;
        const isCmp = ["==", "!=", "===", "!==", "<", "<=", ">", ">="].includes(op);
        node.staticStrength = isCmp ? STRENGTH.STRONG : STRENGTH.MEDIUM;
        node.staticBorn = isCmp ? "comparison" : "arithmetic";
        break;
      }
      case "call": {
        this.expr(node.callee);
        for (const a of node.args) this.expr(a);
        // 静态裁决调用结果强度：
        // 原生手 → 强值裁决；用户函数调用 → 中值承诺
        if (node.callee && node.callee.kind === "variable" && node.callee.staticKind === "native") {
          node.staticStrength = STRENGTH.STRONG;
        } else {
          node.staticStrength = STRENGTH.MEDIUM;
        }
        node.staticBorn = "call";
        break;
      }
      case "assign":
        this.expr(node.value);
        if (node.name && node.name.kind === "variable") {
          const hit = this.lookup(node.name.name);
          if (hit) node.name.staticStrength = hit.strength;
        }
        node.staticStrength = STRENGTH.MEDIUM;   // 赋值=有时效承诺
        node.staticBorn = "assign";
        break;
      case "array": {
        for (const i of node.items) this.expr(i);
        node.staticStrength = STRENGTH.MEDIUM;   // 可改容器=中值
        node.staticBorn = "array";
        break;
      }
      case "dict": {
        for (const e of node.entries) this.expr(e.value);
        node.staticStrength = STRENGTH.MEDIUM;   // 可改容器=中值
        node.staticBorn = "dict";
        break;
      }
      case "index":
        this.expr(node.callee);
        this.expr(node.index);
        node.staticStrength = STRENGTH.MEDIUM;
        node.staticBorn = "index";
        break;
      case "getattr":
        this.expr(node.callee);
        node.staticStrength = STRENGTH.STRONG;  // 属性读取=无时效裁决
        node.staticBorn = "getattr";
        break;
      default:
        node.staticStrength = null;
    }
  }
}

module.exports = { StrengthResolver, NATIVE_NAMES };