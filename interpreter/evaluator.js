// 免语言——求值器（树走解释器，值强度公民版）
// 核心决定（X4 第三问的答案）：强度由"出生它的语法"决定，但**存为值自身的属性**。
// 值不再裸奔——每个值从出生起就是"公民"，带强度 + 出生地，账本在出生那一刻就认得到它。

const STRENGTH = { STRONG: "strong", MEDIUM: "medium", WEAK: "weak" };
const { ERRORS: ME, lookup: errLookup, fmt: errFmt } = require("./mian_errors");

class MianError extends Error {
  constructor(message, line, col, kind = "code", level = "error", code = null) {
    super(message);
    this.name = "MianError";
    this.line = line;
    this.col = col;
    this.kind = kind;     // 错误分类：code（用户代码问题）/ system（语言系统问题）/ boundary（越界）/ contract（契约）/ syntax（语法）/ logic（逻辑冲突）/ structure（结构）
    this.level = level;   // 诊断分级：error（致命，程序停）/ warning（非致命，提示但继续）/ note（附加说明）
    this.code = code;     // 唯一错误码（E001...），一旦定永不改
  }
}

// 值公民：不再临时贴标签，出生即有身份
class MianValue {
  constructor(value, strength, bornAt = "unknown") {
    this.value = value;
    this.strength = strength;   // 由语法决定，存为值自身的属性
    this.bornAt = bornAt;       // 出生地（哪个语法构造生下的它）
  }
  toString() {
    return String(this.value);
  }
}

// return 的控制流真身：截断信号
class MianReturnSignal {
  constructor(mv) { this.mv = mv; }
}

// break / continue 的控制流真身：循环截断信号
class MianBreakSignal { }
class MianContinueSignal { }

// 函数是值
class MianFunction {
  // closureEnv = 定义时刻的环境冻结快照（第11章研案：闭包应捕获声明时刻的冻结快照，
  // 不是调用者的活环境。否则"函数是值传出去后原环境变了"就会看到新值=动态作用域泄漏）
  // globalEnv = 顶层活环境引用（函数互引时，快照里缺失的名字懒查到它）
  constructor(name, params, body, closureEnv = null, globalEnv = null) {
    this.name = name;
    this.params = params;
    this.body = body;
    this.arity = params.length;
    this.closureEnv = closureEnv;
    this.globalEnv = globalEnv;
  }
  toString() { return `<fun ${this.name}>`; }
}

// 引用（指针索引的第二块砖）：ref 指向"槽位"，可以是变量槽（env+name）或容器元素（container+key）。
// 指向名字/键而非 C 裸地址，比 C 安全；悬垂检测=目标槽位还在。
class Ref {
  // kind: "var" → 变量槽（env + name）；"elem" → 容器元素（container 的 MianValue + key）
  constructor(kind, env, name, container, key) {
    this.kind = kind;
    this.env = env;          // 变量槽所在环境
    this.name = name;        // 变量名（kind=var 用）
    this.container = container; // 容器 MianValue（kind=elem 用，持有数组/字典）
    this.key = key;          // 数组索引 或 字典键（kind=elem 用）
  }
  // 活着 = 目标槽位还在。变量槽=名字在 env；容器元素=容器还在且键/索引有效。
  alive() {
    if (this.kind === "var") return this.env.has(this.name);
    const v = this.container && this.container.value;
    if (Array.isArray(v)) return typeof this.key === "number" && this.key >= 0 && this.key < v.length;
    if (v && typeof v === "object") return this.key in v;
    return false;
  }
  get() {
    if (this.kind === "var") return this.env.get(this.name).value;
    const v = this.container.value;
    return Array.isArray(v) ? v[this.key] : v[this.key];
  }
  set(val) {
    if (this.kind === "var") {
      this.env.set(this.name, new MianValue(val, STRENGTH.MEDIUM, `write ${this.name}`));
    } else {
      this.container.value[this.key] = val;
    }
  }
  label() {
    if (this.kind === "var") return this.name;
    if (Array.isArray(this.container.value)) return `[${this.key}]`;
    return `["${this.key}"]`;
  }
  toString() { return `<ref ${this.kind === "var" ? this.name : this.label()}>`; }
}

// 宿主并发调用免语言函数（spawn 机器手用）：
// 用 parentEvaluator 的配置 + fn 的闭包快照，新建子求值器跑函数体
// 返回 [成功?, 值|原因]——不抛不吞，与问-答契约一致
async function callMianFunction(fn, args, parentEvaluator) {
  try {
    if (!(fn instanceof MianFunction)) return [false, "不是免语言函数"];
    if (args.length !== fn.arity) return [false, `函数 ${fn.name} 需要 ${fn.arity} 个参数，传了 ${args.length} 个`];
    const childEnv = new Map(fn.closureEnv || (parentEvaluator ? parentEvaluator.env : new Map()));
    for (let i = 0; i < fn.params.length; i++) {
      // 参数剥成裸值再包（args 可能直接是 MianValue 或裸值）
      const raw = (args[i] instanceof MianValue) ? args[i].value : args[i];
      childEnv.set(fn.params[i], new MianValue(raw, STRENGTH.MEDIUM, `param ${fn.params[i]}`));
    }
    const child = new Evaluator({
      ledger: parentEvaluator ? parentEvaluator.ledgerEnabled : true,
      ledgerInstance: parentEvaluator ? parentEvaluator.ledger : null,
      env: childEnv,
      globalEnv: fn.globalEnv || (parentEvaluator ? parentEvaluator.globalEnv : null),
      out: [],
      builtins: parentEvaluator ? parentEvaluator.builtins : null,
      stdlib: false,
      loopLimit: parentEvaluator ? parentEvaluator.loopLimit : 1000000,
      depthLimit: parentEvaluator ? parentEvaluator.depthLimit : 500,
    });
    const r = await child.interpret(fn.body);
    return [true, r];
  } catch (e) {
    return [false, (e && e.message || String(e)).slice(0, 120)];
  }
}

// 五段账本
class Ledger {
  constructor(enabled = true) {
    this.enabled = enabled;
    this.entries = [];
  }
  record(stage, details) {
    if (!this.enabled) return;
    this.entries.push({ seq: this.entries.length + 1, stage, ...details });
  }
  birth(mv, where) { this.record("birth", { value: summarize(mv), where, strength: mv && mv.strength }); }
  consume(mv, where) { this.record("consume", { value: summarize(mv), where, strength: mv && mv.strength }); }
  funeral(mv, where) { this.record("funeral", { value: summarize(mv), where }); }
}

function summarize(v) {
  if (v === null || v === undefined) return String(v);
  if (v instanceof MianValue) return summarize(v.value);
  if (v instanceof MianFunction) return `<fun ${v.name}>`;
  if (typeof v === "object" || typeof v === "string") {
    const s = JSON.stringify(v);
    return s.length > 40 ? s.slice(0, 40) + "…" : s;
  }
  return String(v);
}

class Evaluator {
  constructor(options = {}) {
    this.ledgerEnabled = options.ledger !== false;
    this.ledger = options.ledgerInstance || new Ledger(this.ledgerEnabled);
    this.env = options.env || new Map();
    // 全局注册表：顶层活环境（函数互引用它懒查未定义时缺失的名字）
    this.globalEnv = options.globalEnv || this.env;
    this.trace = options.trace || null;   // 调试：记录"每步把节点当成了什么值"
    this.traceDepth = 0;
    this.out = options.out || [];
    this.builtins = options.builtins || null;
    this.machineHands = options.machineHands || null;  // 机器三件套（文件/网络/进程等宿主手）
    this.importLoader = options.importLoader || null;   // import 的文件加载手（宿主注入，循环依赖防护在宿主）
    this.parseSource = options.parseSource || null;     // import 的文件解析手（宿主注入，同 loader 配套）
    this.callDepth = 0;
    // 边界配置化：测试可调低，生产默认 100 万/500
    this.loopLimit = options.loopLimit || 1000000;
    this.depthLimit = options.depthLimit || 500;
    const self = this;  // 用于 stdlib 里调 callMianFunction（map/filter/fold 需要）
    // 标准库最小集（X2 已定）：clock / len / type / str
    if (options.stdlib !== false && !options.env) {
      this.env.set("clock", new MianValue(() => Date.now(), STRENGTH.STRONG, "stdlib clock"));
      this.env.set("len", new MianValue((s) => {
        if (typeof s === "string") return s.length;
        if (Array.isArray(s)) return s.length;
        if (s && typeof s === "object") return Object.keys(s).length;
        throw new MianError(errFmt(ME.E903.msg, {}), 0, 0, ME.E903.kind, ME.E903.level || "error", "E903");
      }, STRENGTH.STRONG, "stdlib len"));
      this.env.set("type", new MianValue((v) => {
        // 免语言类型名：与 C++ 原生执行器一致（数组要说 array，不说 object）
        if (Array.isArray(v)) return "array";
        return typeof v;
      }, STRENGTH.STRONG, "stdlib type"));
      this.env.set("str", new MianValue((v) => String(v), STRENGTH.STRONG, "stdlib str"));
      // num(s)：字符串 → 数字（str 的逆，自举 parser 需要：lexer 把数字存字符串）
      this.env.set("num", new MianValue((v) => {
        if (typeof v !== "string") throw new MianError("num 需要字符串", 0, 0, "code", "error", "E921");
        const n = Number(v);
        if (Number.isNaN(n)) throw new MianError(`num 不能转成数字: '${v}'`, 0, 0, "code", "error", "E922");
        return n;
      }, STRENGTH.STRONG, "stdlib num"));
      // chr：数字→字符（自举需要：字符串里表示引号等特殊字符）
      this.env.set("chr", new MianValue((v) => {
        if (typeof v !== "number") throw new MianError(errFmt(ME.E904.msg, {}), 0, 0, ME.E904.kind, ME.E904.level || "error", "E904");
        return String.fromCharCode(Math.trunc(v));
      }, STRENGTH.STRONG, "stdlib chr"));
      // get：安全读字典——缺键返回默认值，不报错（自举/查表场景需要）
      this.env.set("get", new MianValue((d, key, def) => {
        if (!d || typeof d !== "object" || Array.isArray(d)) throw new MianError(errFmt(ME.E905.msg, {}), 0, 0, ME.E905.kind, ME.E905.level || "error", "E905");
        return (key in d) ? d[key] : (def === undefined ? null : def);
      }, STRENGTH.STRONG, "stdlib get"));
      // read(r)：读引用指向的目标值。悬垂（目标被销毁）→ 明确报错，不静默。
      this.env.set("read", new MianValue((r) => {
        const ref = (r instanceof MianValue) ? r.value : r;
        if (!(ref instanceof Ref)) throw new MianError("read 的参数必须是 ref 创建的引用", 0, 0, "code", "error", "E915");
        if (!ref.alive()) throw new MianError(`引用指向的目标 ${ref.label()} 已被销毁（悬垂引用）`, 0, 0, "logic", "error", "E916");
        return ref.get();
      }, STRENGTH.STRONG, "stdlib read"));
      // write(r, v)：把引用指向的目标改成 v。目标还活着就写；目标是"可创建槽位"（最后键不存在）则创建。
      // 逆向八步法：创建是显式操作，必须记账（第7步不静默），不默默吞。
      this.env.set("write", new MianValue((r, v) => {
        const ref = (r instanceof MianValue) ? r.value : r;
        if (!(ref instanceof Ref)) throw new MianError("write 的第一个参数必须是 ref 创建的引用", 0, 0, "code", "error", "E917");
        if (ref.kind === "elem" && ref.container) {
          const c = ref.container.value;
          const exists = Array.isArray(c) ? (typeof ref.key === "number" && ref.key >= 0 && ref.key < c.length) : (ref.key in c);
          if (!exists) {
            // 可创建槽位：显式创建 + 记账（不静默）
            if (Array.isArray(c) && typeof ref.key === "number" && ref.key === c.length) {
              c.push(v);   // 数组末尾追加
            } else if (!Array.isArray(c) && typeof ref.key === "string") {
              c[ref.key] = v;   // 字典加新键
            } else {
              throw new MianError(`引用指向的目标 ${ref.label()} 无法创建（越界或非法键）`, 0, 0, "logic", "error", "E920");
            }
            return v;
          }
        }
        if (!ref.alive()) throw new MianError(`引用指向的目标 ${ref.label()} 已被销毁（悬垂引用）`, 0, 0, "logic", "error", "E916");
        ref.set(v);
        return v;
      }, STRENGTH.STRONG, "stdlib write"));
      // ═══ 集合操作（Python 写感精华，纯函数不原地改；函数作参数契合支柱二）═══
      // map(arr, fn)：每个元素过 fn，返回新数组
      this.env.set("map", new MianValue(async (arr, fn) => {
        if (!Array.isArray(arr)) throw new MianError("map 第一个参数要是数组", 0, 0, "code", "error", "E918");
        if (!(fn instanceof MianFunction)) throw new MianError("map 第二个参数要是函数", 0, 0, "code", "error", "E919");
        const out = [];
        for (const item of arr) {
          const r = await callMianFunction(fn, [item], self);
          out.push(r[0] ? r[1] : null);
        }
        return out;
      }, STRENGTH.STRONG, "stdlib map"));
      // filter(arr, fn)：保留 fn 为真的元素，返回新数组
      this.env.set("filter", new MianValue(async (arr, fn) => {
        if (!Array.isArray(arr)) throw new MianError("filter 第一个参数要是数组", 0, 0, "code", "error", "E918");
        if (!(fn instanceof MianFunction)) throw new MianError("filter 第二个参数要是函数", 0, 0, "code", "error", "E919");
        const out = [];
        for (const item of arr) {
          const r = await callMianFunction(fn, [item], self);
          if (r[0] && r[1]) out.push(item);
        }
        return out;
      }, STRENGTH.STRONG, "stdlib filter"));
      // fold(arr, fn, init)：归约，fn(acc, item) 逐项累积
      this.env.set("fold", new MianValue(async (arr, fn, init) => {
        if (!Array.isArray(arr)) throw new MianError("fold 第一个参数要是数组", 0, 0, "code", "error", "E918");
        if (!(fn instanceof MianFunction)) throw new MianError("fold 第二个参数要是函数", 0, 0, "code", "error", "E919");
        let acc = init;
        for (const item of arr) {
          const r = await callMianFunction(fn, [acc, item], self);
          acc = r[0] ? r[1] : acc;
        }
        return acc;
      }, STRENGTH.STRONG, "stdlib fold"));
    }
    // 机器三件套（文件/网络/进程）：注入与 stdlib 开关无关——有手就装手
    if (this.machineHands && !options.env) {
      for (const [name, fn] of Object.entries(this.machineHands)) {
        this.env.set(name, new MianValue(fn, STRENGTH.STRONG, `host:${name}`));
      }
      // 覆写 spawn 为免语言感知版（能并发调 mfun）
      const self = this;
      this.env.set("spawn", new MianValue(async (fns, argLists) => {
        try {
          if (!Array.isArray(fns)) return [false, "spawn 第一个参数要是函数数组"];
          const tasks = fns.map((fn, i) => {
            const args = (argLists && argLists[i]) || [];
            if (typeof fn === "function") return Promise.resolve().then(() => fn(...args));
            if (fn instanceof MianFunction) return callMianFunction(fn, args, self);
            return Promise.resolve([false, "spawn 里的元素不是可调用的函数"]);
          });
          const results = await Promise.all(tasks);
          return [true, results];
        } catch (e) { return [false, "spawn-error:" + (e && e.message || String(e)).slice(0, 120)]; }
      }, STRENGTH.STRONG, "host:spawn"));
    }
  }

  async interpret(statements) {
    for (const s of statements) {
      const v = await this.execute(s);
      if (v instanceof MianReturnSignal) return v.mv ? v.mv.value : null;
    }
    return null;
  }

  // 调试辅助：记录"这一步把输入当成了什么"（边跑边懂）
  _trace(msg) {
    if (!this.trace) return;
    console.log(`  ${"  ".repeat(this.traceDepth)}▶ ${msg}`);
  }

  async execute(node) {
    switch (node.kind) {
      case "let": return this.execLet(node);
      case "letDestructure": return this.execLetDestructure(node);
      case "print": return this.execPrint(node);
      case "return": {
        // 多值返回：return a, b; —— 打包成数组
        if (node.values.length === 1) {
          const mv = await this.evaluate(node.values[0]);
          this.ledger.consume(mv, "return");
          return new MianReturnSignal(mv);
        }
        const mvs = [];
        for (const v of node.values) {
          const mv = await this.evaluate(v);
          mvs.push(mv.value);
          this.ledger.consume(mv, "return");
        }
        return new MianReturnSignal(new MianValue(mvs, STRENGTH.STRONG, "return multi"));
      }
      case "fun": {
        // 创建函数时抓「此刻」环境冻结快照：闭包看得到的值从此定格，
        // 之后哪怕原环境变量被重新赋值，闭包也看不见新值。
        // 存储段记账点：值被"留住"的时刻，正是这里。
        const snapshot = freezeEnv(this.env);
        const fn = new MianFunction(node.name, node.params, node.body, snapshot, this.globalEnv);
        const fnValue = new MianValue(fn, node.staticStrength || STRENGTH.STRONG, `fun ${node.name}`);
        // 递归自引用：把函数自己写进快照，函数体内就能看见自己
        snapshot.set(node.name, fnValue);
        this.env.set(node.name, fnValue);
        this.ledger.birth(fnValue, `fun ${node.name}`);
        return fnValue;
      }
      case "done": return this.execDone(node);
      case "if": return this.execIf(node);
      case "while": return this.execWhile(node);
      case "for": return this.execFor(node);
      case "block": {
        let r = null;
        for (const s of node.statements) {
          const v = await this.execute(s);
          if (v instanceof MianReturnSignal) return v;
          if (v instanceof MianBreakSignal) return v;    // 向上传，让循环捕获
          if (v instanceof MianContinueSignal) return v;
          r = v;
        }
        return r;
      }
      case "break": return new MianBreakSignal();
      case "continue": return new MianContinueSignal();
      case "exprStmt": return this.evaluate(node.expr);
      case "import": return this.execImport(node);
      default: return this.evaluate(node);
    }
  }

  async execLet(node) {
    const mv = await this.evaluate(node.initializer);
    // 赋值是中值承诺：此刻起是它，下一次赋值可推翻
    const rebound = new MianValue(mv.value, STRENGTH.MEDIUM, `let ${node.name.lexeme}`);
    this.env.set(node.name.lexeme, rebound);
    this.ledger.birth(rebound, `let ${node.name.lexeme}`);
    this._trace(`let ${node.name.lexeme} = ${summarize(mv)} → 存入环境 (${rebound.strength})`);
    return rebound;
  }

  // 解构赋值：let (x, y) = f(); —— 调用的返回值是数组，按位置拆包
  async execLetDestructure(node) {
    const mv = await this.evaluate(node.initializer);
    const arr = mv.value;
    if (!Array.isArray(arr)) throw new MianError(errFmt(ME.E906.msg, {}), node.line, node.col, ME.E906.kind, ME.E906.level || "error", "E906");
    if (arr.length < node.names.length) throw new MianError(errFmt(ME.E907.msg, { expect: node.names.length, actual: arr.length }), node.line, node.col, ME.E907.kind, ME.E907.level || "error", "E907");
    for (let i = 0; i < node.names.length; i++) {
      const rebound = new MianValue(arr[i], STRENGTH.MEDIUM, `letDestructure ${node.names[i]}`);
      this.env.set(node.names[i], rebound);
      this.ledger.birth(rebound, `letDestructure ${node.names[i]}`);
    }
    return mv;
  }

  async execPrint(node) {
    const mv = await this.evaluate(node.value);
    this.out.push(mv.toString());
    this.ledger.consume(mv, "print");
    return null;
  }

  async execDone(node) {
    const c = await this.evaluate(node.condition);
    // done 只吃强值裁决；弱值升格不合法
    if (c.strength === STRENGTH.WEAK) {
      throw new MianError(errFmt(ME.E401.msg, {}), node.line, node.col, ME.E401.kind, ME.E401.level || "error", "E401");
    }
    let r = null;
    if (isTruthy(c.value)) {
      for (const s of node.statements) {
        const v = await this.execute(s);
        if (v instanceof MianReturnSignal) return v;
        r = v;
      }
    }
    // 不成立：不是无事发生——跳过本身记入账本
    this.ledger.record("done_skip", { cond: summarize(c), strength: c.strength });
    return r;
  }

  // if = 或许态：条件成立走 then，不成立走 else。两个可能世界都摆在明面上，
  // 走了哪支记入账本（与 done 的定性态相对——if 是试探分叉）。
  async execIf(node) {
    const c = await this.evaluate(node.condition);
    const chosen = isTruthy(c.value) ? "then" : "else";
    this.ledger.record("if_branch", { chosen, cond: summarize(c), strength: c.strength });
    this._trace(`if 条件 ${summarize(c)} → 走 ${chosen} 分支`);
    const branch = isTruthy(c.value) ? node.thenBranch : node.elseBranch;
    if (!branch) return null;
    let r = null;
    for (const s of branch) {
      const v = await this.execute(s);
      if (v instanceof MianReturnSignal) return v;
      r = v;
    }
    return r;
  }

  // import "路径.mi"：加载并执行外部文件，共享当前环境。
  // 宿主注入 loadSource + parseSource，循环依赖/重复加载的防护在宿主（语言只下命令）。
  async execImport(node) {
    if (!this.importLoader || !this.parseSource) {
      throw new MianError(errFmt(ME.E908.msg, {}), node.line, node.col, ME.E908.kind, ME.E908.level || "error", "E908");
    }
    const source = this.importLoader(node.path);
    const statements = this.parseSource(source);
    this.ledger.record("import", { path: node.path });
    for (const s of statements) {
      const v = await this.execute(s);
      if (v instanceof MianReturnSignal) return v;   // 被导入文件里的 return 穿透
    }
    return null;
  }

  // ── 循环：语言拥有"重复"的指挥权；机器执行，语言管每一步 ──
  async execWhile(node) {
    let last = null;
    let steps = 0;
    while (true) {
      const c = await this.evaluate(node.condition);
      if (!isTruthy(c.value)) {
        this.ledger.record("while_exit", { cond: summarize(c) });
        break;
      }
      for (const s of node.body) {
        const v = await this.execute(s);
        if (v instanceof MianReturnSignal) return v;
        if (v instanceof MianBreakSignal) { this.ledger.record("while_break"); return last; }   // break：跳出整个循环
        if (v instanceof MianContinueSignal) { this.ledger.record("while_continue"); break; }    // continue：跳出本次循环体，重查条件
        last = v;
      }
      if (++steps > this.loopLimit) {
        throw new MianError(errFmt(ME.E402.msg, { limit: this.loopLimit }), node.line, node.col, ME.E402.kind, ME.E402.level || "error", "E402");
      }
    }
    return last;
  }

  async execFor(node) {
    let last = null;
    if (node.init) await this.evaluate(node.init);
    let steps = 0;
    while (true) {
      if (node.condition) {
        const c = await this.evaluate(node.condition);
        if (!isTruthy(c.value)) {
          this.ledger.record("for_exit", { cond: summarize(c) });
          break;
        }
      }
      let cont = false;   // continue 是否触发（跳过 increment 后的重查）
      for (const s of node.body) {
        const v = await this.execute(s);
        if (v instanceof MianReturnSignal) return v;
        if (v instanceof MianBreakSignal) { this.ledger.record("for_break"); return last; }   // break：跳出整个循环
        if (v instanceof MianContinueSignal) { this.ledger.record("for_continue"); cont = true; break; }  // continue：跑 increment 后重查
        last = v;
      }
      if (node.increment) await this.evaluate(node.increment);
      if (++steps > this.loopLimit) {
        throw new MianError(errFmt(ME.E403.msg, { limit: this.loopLimit }), node.line, node.col, ME.E403.kind, ME.E403.level || "error", "E403");
      }
    }
    return last;
  }

  async evaluate(node) {
    switch (node.kind) {
      case "literal":
        // 字面量 = 无时效事实（强度由"出生它的语法"决定——静态 pass 已写，运行时不重算）
        { const mv = new MianValue(node.value, staticOf(node), "literal"); this._trace(`字面量 ${JSON.stringify(node.value)} → 值 ${summarize(mv)} (${mv.strength})`); return mv; }
      case "variable": {
        const slot = this.env.get(node.name);
        if (slot === undefined && this.globalEnv && this.globalEnv !== this.env && this.globalEnv.has(node.name)) {
          // 懒查找：快照里缺失的顶层名字，回退到全局注册表（函数互引的关键）
          this._trace(`变量 ${node.name} → 懒查到全局 ${summarize(this.globalEnv.get(node.name))}`);
          return this.globalEnv.get(node.name);
        }
        if (slot === undefined) throw new MianError(errFmt(ME.E081.msg, { name: node.name }), node.line, node.col, ME.E081.kind, ME.E081.level || "error", "E081");
        this._trace(`变量 ${node.name} → ${summarize(slot)} (${slot.strength})`);
        return slot;   // 变量携带它自己出生时的强度
      }
      case "grouping": return this.evaluate(node.expr);
      case "ref": {
        // ref x：创建指向变量槽位的引用。记入账本（出生）。
        const slot = this.env.get(node.name);
        if (slot === undefined) throw new MianError(errFmt(ME.E081.msg, { name: node.name }), node.line, node.col, ME.E081.kind, ME.E081.level || "error", "E081");
        const ref = new Ref("var", this.env, node.name, null, null);
        this.ledger.birth(ref, `ref ${node.name}`);
        return new MianValue(ref, STRENGTH.STRONG, `ref ${node.name}`);
      }
      case "refElem": {
        // ref a[0] / ref d["k"] / ref a[0][1]：沿索引链走到目标容器元素，创建指向它的引用。
        // 中间层必须存在（要穿过它才能到达目标）；最后一层可创建（write 建 / read 悬垂，由操作决定）。
        const root = this.env.get(node.name);
        if (root === undefined) throw new MianError(errFmt(ME.E081.msg, { name: node.name }), node.line, node.col, ME.E081.kind, ME.E081.level || "error", "E081");
        // 求每条索引的值
        const path = [];
        for (const idxNode of node.indices) {
          const idxMv = await this.evaluate(idxNode);
          path.push(idxMv.value);
        }
        // 目标容器 = 走完前 n-1 层后的容器（它持有最后一个键）。
        // 例如 ref a[0][1]：目标容器 = a[0]（一个数组），目标键 = 1。
        let target = root;
        for (let i = 0; i < path.length - 1; i++) {
          const v = target.value;
          if (!Array.isArray(v) && !(v && typeof v === "object")) {
            throw new MianError(errFmt(ME.E901.msg, {}), node.line, node.col, ME.E901.kind, ME.E901.level || "error", "E901");
          }
          const key = path[i];
          if (Array.isArray(v)) {
            if (typeof key !== "number") throw new MianError(errFmt(ME.E204.msg, {}), node.line, node.col, ME.E204.kind, ME.E204.level || "error", "E204");
            // 中间层数组索引越界 → 结构错误（不能穿过不存在的元素）
            if (key < 0 || key >= v.length) throw new MianError(errFmt(ME.E701.msg, { len: v.length, idx: key }), node.line, node.col, ME.E701.kind, ME.E701.level || "error", "E701");
          } else {
            if (typeof key !== "string") throw new MianError(errFmt(ME.E205.msg, {}), node.line, node.col, ME.E205.kind, ME.E205.level || "error", "E205");
            // 中间层字典键必须存在（前提检查：要穿过它到达目标）
            if (!(key in v)) throw new MianError(errFmt(ME.E206.msg, { key }), node.line, node.col, ME.E206.kind, ME.E206.level || "error", "E206");
          }
          target = new MianValue(v[key], STRENGTH.MEDIUM, `refElem ${i}`);
        }
        const lastKey = path[path.length - 1];
        // 校验最后一层容器可写（是数组或字典）——不校验键存在（最后一层可创建）
        const lv = target.value;
        if (!Array.isArray(lv) && !(lv && typeof lv === "object")) {
          throw new MianError(errFmt(ME.E901.msg, {}), node.line, node.col, ME.E901.kind, ME.E901.level || "error", "E901");
        }
        const refElem = new Ref("elem", null, null, target, lastKey);
        this.ledger.birth(refElem, `ref ${node.name}${path.map(k => "[" + k + "]").join("")}`);
        return new MianValue(refElem, STRENGTH.STRONG, `refElem ${node.name}`);
      }
      case "unary": {
        const right = await this.evaluate(node.right);
        const op = node.operator.lexeme;
        const v = op === "-" ? -right.value : !isTruthy(right.value);
        if (typeof v !== "number" && typeof v !== "boolean") {
          throw new MianError(errFmt(ME.E910.msg, {}), node.line, node.col, ME.E910.kind, ME.E910.level || "error", "E910");
        }
        return new MianValue(v, staticOf(node), "unary");
      }
      case "binary": return this.evalBinary(node);
      case "logical": {
        // 短路：&& 左边假就不看右边；|| 左边真就不看右边（五段账本要记"右边没被消费"）
        const left = await this.evaluate(node.left);
        if (node.operator === "&&" && !isTruthy(left.value)) {
          this.ledger.record("short_circuit_skip", { op: "&&", reason: "左为假" });
          return new MianValue(false, staticOf(node), "logical");
        }
        if (node.operator === "||" && isTruthy(left.value)) {
          this.ledger.record("short_circuit_skip", { op: "||", reason: "左为真" });
          return new MianValue(true, staticOf(node), "logical");
        }
        const right = await this.evaluate(node.right);
        return new MianValue(node.operator === "&&" ? isTruthy(left.value) && isTruthy(right.value) : isTruthy(left.value) || isTruthy(right.value), staticOf(node), "logical");
      }
      case "ternary": {
        // 三元 = 或许态：条件成立走真分支，否则走假分支（跟 if 一样记账）
        const c = await this.evaluate(node.condition);
        const chosen = isTruthy(c.value) ? "then" : "else";
        this.ledger.record("ternary_branch", { chosen, cond: summarize(c), strength: c.strength });
        const branch = isTruthy(c.value) ? node.thenBranch : node.elseBranch;
        return await this.evaluate(branch);
      }
      case "array": {
        const items = await Promise.all(node.items.map(i => this.evaluate(i)));
        const arr = items.map(m => m.value);
        this._trace(`数组 [${arr.join(", ")}] → len ${arr.length}`);
        return new MianValue(arr, staticOf(node), "array");
      }
      case "dict": {
        const obj = {};
        for (const e of node.entries) {
          const v = await this.evaluate(e.value);
          obj[e.key] = v.value;
        }
        this._trace(`字典 {${Object.keys(obj).map(k => k + ":" + summarize(obj[k])).join(", ")}} → ${Object.keys(obj).length} 键`);
        return new MianValue(obj, staticOf(node), "dict");
      }
      case "index": {
        const target = await this.evaluate(node.callee);
        const idx = await this.evaluate(node.index);
        // 字典访问：d["key"]
        if (target.value && typeof target.value === "object" && !Array.isArray(target.value)) {
          if (typeof idx.value !== "string") throw new MianError(errFmt(ME.E205.msg, {}), node.line, node.col, ME.E205.kind, ME.E205.level || "error", "E205");
          if (!(idx.value in target.value)) throw new MianError(errFmt(ME.E206.msg, { key: idx.value }), node.line, node.col, ME.E206.kind, ME.E206.level || "error", "E206");
          this._trace(`索引 d["${idx.value}"] → ${summarize(target.value[idx.value])}`);
          return new MianValue(target.value[idx.value], staticOf(node), `dict ${idx.value}`);
        }
        // 字符串索引：s[i] 返回单字符字符串（自举需要）
        if (typeof target.value === "string") {
          if (typeof idx.value !== "number") throw new MianError(errFmt(ME.E902.msg, {}), node.line, node.col, ME.E902.kind, ME.E902.level || "error", "E902");
          const i = Math.trunc(idx.value);
          if (i < 0 || i >= target.value.length) throw new MianError(errFmt(ME.E702.msg, { len: target.value.length, idx: i }), node.line, node.col, ME.E702.kind, ME.E702.level || "error", "E702");
          return new MianValue(target.value[i], staticOf(node), `str index ${i}`);
        }
        // 数组索引：只认数字
        if (Array.isArray(target.value)) {
          if (typeof idx.value !== "number") throw new MianError(errFmt(ME.E204.msg, {}), node.line, node.col, ME.E204.kind, ME.E204.level || "error", "E204");
          const i = Math.trunc(idx.value);
          if (i < 0 || i >= target.value.length) throw new MianError(errFmt(ME.E701.msg, { len: target.value.length, idx: i }), node.line, node.col, ME.E701.kind, ME.E701.level || "error", "E701");
          return new MianValue(target.value[i], staticOf(node), `index ${i}`);
        }
        // 非容器类型（数字/布尔/函数）不能索引用——把 A 当 B 用
        const tname = Array.isArray(target.value) ? "数组" : (typeof target.value === "number" ? "数字" : typeof target.value === "boolean" ? "布尔" : "函数");
        throw new MianError(errFmt(ME.E901.msg, {}), node.line, node.col, ME.E901.kind, ME.E901.level || "error", "E901");
      }
      case "getattr": {
        const target = await this.evaluate(node.callee);
        const v = target.value;
        // 字符串属性：.len
        if (typeof v === "string" && node.name === "len")
          return new MianValue(v.length, staticOf(node), "str.len");
        // 数组属性：.len
        if (Array.isArray(v) && node.name === "len")
          return new MianValue(v.length, staticOf(node), "arr.len");
        throw new MianError(errFmt(ME.E911.msg, { prop: node.name }), node.line, node.col, ME.E911.kind, ME.E911.level || "error", "E911");
      }
      case "call": return this.evalCall(node);
      case "assign": {
        // 赋值=有时效承诺：旧承诺作废，新值入簿
        const mv = await this.evaluate(node.value);
        // 支持索引赋值：d["k"] = v / a[0] = v
        if (node.name.kind === "index") {
          const target = await this.evaluate(node.name.callee);
          const idx = await this.evaluate(node.name.index);
          const key = idx.value;
          const v = target.value;
          if (Array.isArray(v)) {
            if (typeof key !== "number") throw new MianError(errFmt(ME.E204.msg, {}), node.line, node.col, ME.E204.kind, ME.E204.level || "error", "E204");
            if (key < 0 || key >= v.length) throw new MianError(errFmt(ME.E701.msg, { len: v.length, idx: key }), node.line, node.col, ME.E701.kind, ME.E701.level || "error", "E701");
            v[key] = mv.value;
          } else if (v && typeof v === "object") {
            if (typeof key !== "string") throw new MianError(errFmt(ME.E205.msg, {}), node.line, node.col, ME.E205.kind, ME.E205.level || "error", "E205");
            v[key] = mv.value;  // 动态加键（Python 同款写感）
          } else {
            throw new MianError(errFmt(ME.E901.msg, {}), node.line, node.col, ME.E901.kind, ME.E901.level || "error", "E901");
          }
          this.ledger.birth(mv, `assign index`);
          this._trace(`索引赋值 ${summarize(target.value)}[${summarize(idx)}] = ${summarize(mv)} → 已写入`);
          return mv;
        }
        const name = node.name.kind === "variable" ? node.name.name : null;
        if (!name) throw new MianError(errFmt(ME.E912.msg, {}), node.line, node.col, ME.E912.kind, ME.E912.level || "error", "E912");
        const rebound = new MianValue(mv.value, staticOf(node), `assign ${name}`);
        this.env.set(name, rebound);
        this.ledger.birth(rebound, `assign ${name}`);
        this._trace(`赋值 ${name} = ${summarize(mv)} → 写入环境 (${rebound.strength})`);
        return rebound;
      }
      default: throw new MianError(errFmt(ME.E909.msg, { kind: node.kind }), node.line, node.col, ME.E909.kind, ME.E909.level || "error", "E909");
    }
  }

  async evalBinary(node) {
    const left = await this.evaluate(node.left);
    const right = await this.evaluate(node.right);
    const op = node.operator.lexeme;

    // 比较类 = 强值裁决（无时效）
    if (["==", "!=", "===", "!==", "<", "<=", ">", ">="].includes(op)) {
      if (["<", "<=", ">", ">="].includes(op) && typeof left.value !== typeof right.value) {
        throw new MianError(errFmt(ME.E202.msg, { ltype: typeof left.value, rtype: typeof right.value }), node.line, node.col, ME.E202.kind, ME.E202.level || "error", "E202");
      }
      let ans;
      switch (op) {
        case "==": ans = left.value === right.value; break;         // 动态对等（或许态）
        case "!=": ans = left.value !== right.value; break;
        case "===":                                                    // 静态比较（定性态）
          if (typeof left.value !== typeof right.value) { ans = false; break; }
          ans = left.value === right.value;
          break;
        case "!==":
          if (typeof left.value !== typeof right.value) { ans = true; break; }
          ans = left.value !== right.value;
          break;
        case "<": ans = left.value < right.value; break;
        case "<=": ans = left.value <= right.value; break;
        case ">": ans = left.value > right.value; break;
        case ">=": ans = left.value >= right.value; break;
      }
      const mv = new MianValue(ans, staticOf(node), "comparison");
      this.ledger.birth(mv, "comparison");
      this._trace(`比较 ${summarize(left)} ${op} ${summarize(right)} → ${summarize(mv)} (${mv.strength})`);
      return mv;
    }

    // 算术类 = 中值承诺
    if (op === "+") {
      if (typeof left.value === "number" && typeof right.value === "number") {
        const mv = new MianValue(left.value + right.value, STRENGTH.MEDIUM, "arithmetic");
        this.ledger.birth(mv, `arithmetic +`);
        this._trace(`算术 ${left.value} + ${right.value} → ${mv.value} (${mv.strength})`);
        return mv;
      }
      if (typeof left.value === "string" && typeof right.value === "string") {
        const mv = new MianValue(left.value + right.value, STRENGTH.MEDIUM, "concat");
        this.ledger.birth(mv, "concat");
        this._trace(`拼接 "${left.value}" + "${right.value}" → "${mv.value}" (${mv.strength})`);
        return mv;
      }
      // 数组拼接：arr + [item] 或 [a] + [b]（自举/工具函数需要）
      if (Array.isArray(left.value) && Array.isArray(right.value)) {
        const mv = new MianValue(left.value.concat(right.value), STRENGTH.MEDIUM, "arr concat");
        this.ledger.birth(mv, "arr concat");
        this._trace(`数组拼接 len ${left.value.length} + len ${right.value.length} → len ${mv.value.length}`);
        return mv;
      }
      throw new MianError(errFmt(ME.E914.msg, { ltype: typeof left.value, rtype: typeof right.value }), node.line, node.col, ME.E914.kind, ME.E914.level || "error", "E914");
    }

    for (const v of [left.value, right.value]) {
      if (typeof v !== "number") throw new MianError(errFmt(ME.E913.msg, { op }), node.line, node.col, ME.E913.kind, ME.E913.level || "error", "E913");
    }
    let ans;
    switch (op) {
      case "-": ans = left.value - right.value; break;
      case "*": ans = left.value * right.value; break;
      case "/":
        if (right.value === 0) throw new MianError(errFmt(ME.E207.msg, {}), node.line, node.col, ME.E207.kind, ME.E207.level || "error", "E207");
        ans = left.value / right.value; break;
    }
    const mv = new MianValue(ans, STRENGTH.MEDIUM, "arithmetic");
    this.ledger.birth(mv, `arithmetic ${op}`);
    this._trace(`算术 ${left.value} ${op} ${right.value} → ${mv.value} (${mv.strength})`);
    return mv;
  }

  async evalCall(node) {
    const callee = await this.evaluate(node.callee);
    const callable = callee.value;

    // 原生函数：宿主递来的手
    if (typeof callable === "function") {
      const argVals = await Promise.all(node.args.map(a => this.evaluate(a)));
      const r = await callable(...argVals.map(m => m.value));
      const mv = new MianValue(r, STRENGTH.STRONG, "native call"); // 原生返回=裁决
      this.ledger.birth(mv, `native call`);
      this.ledger.consume(mv, "native call");
      this._trace(`原生调用 ${node.callee && node.callee.name || "?"} → ${summarize(mv)}`);
      return mv;
    }

    if (!(callable instanceof MianFunction)) {
      throw new MianError(errFmt(ME.E501.msg, { val: summarize(callee) }), node.line, node.col, ME.E501.kind, ME.E501.level || "error", "E501");
    }
    const fn = callable;

    // D10：arity 严格
    if (node.args.length !== fn.arity) {
      throw new MianError(errFmt(ME.E203.msg, { name: fn.name, expect: fn.arity, actual: node.args.length }), node.line, node.col, ME.E203.kind, ME.E203.level || "error", "E203");
    }

    // 递归深度护栏（可配置）
    if (this.callDepth > this.depthLimit) {
      throw new MianError(errFmt(ME.E404.msg, { limit: this.depthLimit }), node.line, node.col, ME.E404.kind, ME.E404.level || "error", "E404");
    }

    const argValues = await Promise.all(node.args.map(a => this.evaluate(a)));

    const childEnv = new Map(fn.closureEnv || this.env);   // 闭包快照：定义时刻的冻结世界，不是调用者活环境
    const bindings = [];
    for (let i = 0; i < fn.params.length; i++) {
      childEnv.set(fn.params[i], new MianValue(argValues[i].value, STRENGTH.MEDIUM, `param ${fn.params[i]}`));
      bindings.push(`${fn.params[i]}=${summarize(argValues[i])}`);
    }
    this.ledger.birth(null, `call ${fn.name}(${bindings.join(", ")})`);

    this.traceDepth++;
    this._trace(`调用 ${fn.name}(${bindings.join(", ")})`);

    const child = new Evaluator({
      ledger: this.ledgerEnabled,
      ledgerInstance: this.ledger,
      env: childEnv,
      globalEnv: fn.globalEnv || this.globalEnv,
      trace: this.trace,
      traceDepth: this.traceDepth,
      out: this.out,
      builtins: this.builtins,
      stdlib: false,   // 标准库只在顶层注册，子环境继承 env 已有
      loopLimit: this.loopLimit,     // 护栏随深度链向下传递
      depthLimit: this.depthLimit,   // 这才是深度护栏能进递归的关键
    });
    child.callDepth = this.callDepth + 1;
    const r = await child.interpret(fn.body);
    this.traceDepth--;
    const retMv = new MianValue(r, STRENGTH.MEDIUM, `call ${fn.name}`);
    this.ledger.consume(retMv, `call ${fn.name}`);
    this._trace(`← ${fn.name} 返回 ${summarize(retMv)}`);
    return retMv;
  }
}

function isTruthy(v) {
  // ⚠️ 悬而未决：按"无 nil + 值强度"哲学，0/null 不应默认为假
  // 当前用 C 系惯例（false 假其余真），颠覆需走测试+免免拍板
  return !(v === false);
}

// 静态裁决的读取器：运行时不要自己现算强度——接近处理器的真义=编译期定死。
// 若节点上已有静态 pass 写好的强度，直接用；没有（如求值器被单独依赖时的兜底），
// 按节点的"出生语法"给最小兜底——但绝不假装是运行时推导。全部真实推导都在 StrengthResolver。
function staticOf(node) {
  if (node && node.staticStrength) return node.staticStrength;
  // 兜底：最低可信度，逼上层补静态 pass，而不是在这里猜
  return STRENGTH.WEAK;
}

// 环境冻结快照：闭包语义的地基（第11章研案搬来的）
// Map 浅拷贝+MianValue 是"冻结"（MianValue 的 value 字段之后不再被原地改；
// 需要改变量值时用 env.set 换新的 MianValue 而旧快照还指向旧对象）。
function freezeEnv(env) {
  const snap = new Map();
  for (const [k, v] of env) snap.set(k, v);
  return snap;
}

module.exports = { Evaluator, MianError, MianReturnSignal, MianFunction, MianValue, Ledger, STRENGTH, isTruthy, summarize, callMianFunction };