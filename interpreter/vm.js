// 免语言——第二具身体：栈式字节码 VM
// 与一号树游解释器同栈同语义，cross-mode 对拍的基础。
// 支持：算术/比较/类型纪律/全局变量/print/done/while/数组/索引/函数调用/递归/RET，
//       原生函数调用（含 async 机器手）。
// 注：CALL 原生手若返回 Promise 需要 await——故 run 是 async。

const { OP } = require("./compiler");

class BytecodeVM {
  constructor(program) {
    this.programCode = program.code;
    this.code = program.code;
    this.constants = program.constants;
    this.stack = [];
    this.globals = new Map();
    this.out = [];
    this.ip = 0;
    this.frames = [];        // 调用帧栈：{ retIp, retCode, locals:Map }
    this.depth = 0;
    this.depthLimit = 500;
    this.mode = "compiled";
  }

  peek() { return this.stack[this.stack.length - 1]; }
  pop() { return this.stack.pop(); }

  async run() {
    let last = null;
    while (this.ip < this.code.length) {
      const [op, operand] = this.code[this.ip];
      this.ip++;
      switch (op) {
        case OP.CONST: this.stack.push(this.constants[operand]); break;
        case OP.DUP: this.stack.push(this.peek()); break;
        case OP.POP: this.pop(); break;
        case OP.LAND: { const b = this.pop(), a = this.pop(); this.stack.push(Boolean(a) && Boolean(b)); break; }
        case OP.LOR: { const b = this.pop(), a = this.pop(); this.stack.push(Boolean(a) || Boolean(b)); break; }
        case OP.ADD: {
          const b = this.pop(), a = this.pop();
          if (typeof a === "number" && typeof b === "number") this.stack.push(a + b);
          else if (typeof a === "string" && typeof b === "string") this.stack.push(a + b);
          else this.throwMian(`不能用 + 连接 ${typeof a} 和 ${typeof b}`);
          break;
        }
        case OP.SUB: { const b = this.pop(), a = this.pop(); this.checkNum(a, b, "-"); this.stack.push(a - b); break; }
        case OP.MUL: { const b = this.pop(), a = this.pop(); this.checkNum(a, b, "*"); this.stack.push(a * b); break; }
        case OP.DIV: {
          const b = this.pop(), a = this.pop(); this.checkNum(a, b, "/");
          if (b === 0) this.throwMian("除数为零");
          this.stack.push(a / b);
          break;
        }
        case OP.NEG: this.stack.push(-this.pop()); break;
        case OP.NOT: this.stack.push(!this.pop()); break;
        case OP.EQ: { const b = this.pop(), a = this.pop(); this.stack.push(a === b); break; }
        case OP.NEQ: { const b = this.pop(), a = this.pop(); this.stack.push(a !== b); break; }
        case OP.EQEQEQ: { const b = this.pop(), a = this.pop(); this.stack.push(typeof a === typeof b && a === b); break; }
        case OP.NEQEQ: { const b = this.pop(), a = this.pop(); this.stack.push(typeof a !== typeof b || a !== b); break; }
        case OP.LT: { const b = this.pop(), a = this.pop(); this.stack.push(a < b); break; }
        case OP.LTE: { const b = this.pop(), a = this.pop(); this.stack.push(a <= b); break; }
        case OP.GT: { const b = this.pop(), a = this.pop(); this.stack.push(a > b); break; }
        case OP.GTE: { const b = this.pop(), a = this.pop(); this.stack.push(a >= b); break; }
        case OP.ARRAY: {
          const items = [];
          for (let i = 0; i < operand; i++) items.unshift(this.pop());
          this.stack.push(items);
          break;
        }
        case OP.DICT: {
          // 键值对在栈上：key1,val1,key2,val2...（键先压）
          const obj = {};
          const pairs = [];
          for (let i = 0; i < operand * 2; i++) pairs.unshift(this.pop());
          for (let i = 0; i < pairs.length; i += 2) {
            obj[pairs[i]] = pairs[i + 1];
          }
          this.stack.push(obj);
          break;
        }
        case OP.IDX: {
          const idx = this.pop(), arr = this.pop();
          // 字典索引：d["key"]
          if (arr && typeof arr === "object" && !Array.isArray(arr)) {
            if (typeof idx !== "string") this.throwMian("字典索引要是字符串");
            if (!(idx in arr)) this.throwMian(`字典没有键 '${idx}'`);
            this.stack.push(arr[idx]);
            break;
          }
          // 字符串索引：s[i] 或 s["len"]（getattr 脱糖）
          if (typeof arr === "string") {
            if (idx === "len") { this.stack.push(arr.length); break; }
            if (typeof idx !== "number") this.throwMian("字符串索引要是数字");
            const i = Math.trunc(idx);
            if (i < 0 || i >= arr.length) this.throwMian(`字符串索引越界：长度 ${arr.length}，索引 ${i}`);
            this.stack.push(arr[i]);
            break;
          }
          if (!Array.isArray(arr)) this.throwMian("只能对数组用索引");
          if (typeof idx !== "number") this.throwMian("索引要是数字");
          const i = Math.trunc(idx);
          if (i < 0 || i >= arr.length) this.throwMian(`索引越界：长度 ${arr.length}，索引 ${i}`);
          this.stack.push(arr[i]);
          break;
        }
        case OP.LOAD: {
          const frame = this.frames[this.frames.length - 1];
          if (frame && frame.locals.has(operand)) { this.stack.push(frame.locals.get(operand)); break; }
          if (!this.globals.has(operand)) this.throwMian(`变量 '${operand}' 未声明`);
          this.stack.push(this.globals.get(operand));
          break;
        }
        case OP.REF: {
          // ref x → 压入指向变量槽位的引用（globals 或当前帧 locals）
          const frame = this.frames[this.frames.length - 1];
          let target;
          if (frame && frame.locals.has(operand)) {
            target = { map: frame.locals, name: operand };
          } else {
            if (!this.globals.has(operand)) this.throwMian(`变量 '${operand}' 未声明`);
            target = { map: this.globals, name: operand };
          }
          this.stack.push({ kind: "ref", target });
          break;
        }
        case OP.STORE: {
          const frame = this.frames[this.frames.length - 1];
          const v = this.pop();
          if (frame && frame.locals.has(operand)) { frame.locals.set(operand, v); }
          else { this.globals.set(operand, v); }
          break;
        }
        case OP.PRINT: this.out.push(String(this.pop())); break;
        case OP.CALL: {
          const n = operand;
          const args = [];
          for (let i = 0; i < n; i++) args.unshift(this.pop());
          const callee = this.pop();
          // 原生函数/机器手：可能是同步也可能是 async——都 await 掉
          if (typeof callee === "function") {
            const r = await callee(...args);
            this.stack.push(r);
            break;
          }
          if (!callee || typeof callee !== "object" || callee.kind !== "mfun") {
            this.throwMian("不是函数，不能调用：" + String(callee));
          }
          this.checkArity(callee, n);
          if (this.depth >= this.depthLimit) this.throwMian(`递归太深（>${this.depthLimit} 层）`);
          const locals = new Map();
          callee.params.forEach((p, i) => locals.set(p, args[i]));
          this.frames.push({ retIp: this.ip, retCode: this.code, retConstants: this.constants, locals });
          this.depth++;
          this.code = callee.body;
          this.constants = callee.constants || [];
          this.ip = 0;
          break;
        }
        case OP.RET: {
          const frame = this.frames.pop();
          const retVal = this.stack.length ? this.pop() : null;   // 空栈=print 类语句
          if (!frame) { last = retVal; return { result: last, out: this.out, globals: this.globals }; }
          this.depth--;
          this.code = frame.retCode;
          this.constants = frame.retConstants;
          this.ip = frame.retIp;
          this.stack.push(retVal);   // 返回值留给调用方
          break;
        }
        case OP.JMP: this.ip = operand; break;
        case OP.JMPF: {
          const cond = this.pop();
          if (!cond) this.ip = operand;
          break;
        }
        default: this.throwMian(`未知字节码 ${op}`);
      }
    }
    return { result: last, out: this.out, globals: this.globals };
  }

  checkNum(a, b, op) {
    if (typeof a !== "number" || typeof b !== "number") this.throwMian(`${op} 只吃数字`);
  }
  checkArity(fn, n) {
    if (n !== fn.params.length) this.throwMian(`函数 ${fn.name} 需要 ${fn.params.length} 个参数，但传了 ${n} 个`);
  }
  throwMian(msg) {
    throw Object.assign(new Error(msg), { name: "MianError" });
  }
}

module.exports = { BytecodeVM };