// 免语言——第二具身体：字节码编译器（AST → 扁平指令流）
// 支持：常量/算术/比较/全局变量/print/done/while/return/数组/函数定义/函数调用/索引
// 数据布局：
//   - 函数值 = 常量池内对象 { kind:"mfun", name, params, body:[ops] }
//   - CALL n：栈上依次是 callee, arg1..argN（栈顶是最后一个实参）
const OP = {
  CONST: "CONST",
  ADD: "ADD", SUB: "SUB", MUL: "MUL", DIV: "DIV",
  NEG: "NEG", NOT: "NOT",
  EQ: "EQ", NEQ: "NEQ", LT: "LT", LTE: "LTE", GT: "GT", GTE: "GTE",
  LOAD: "LOAD", STORE: "STORE", PRINT: "PRINT",
  DUP: "DUP", POP: "POP",
  LAND: "LAND", LOR: "LOR",
  ARRAY: "ARRAY", IDX: "IDX",
  CALL: "CALL",
  JMP: "JMP", JMPF: "JMPF", RET: "RET",
};

class Compiler {
  constructor() {
    this.code = [];
    this.constants = [];
  }
  emit(op, operand = null) { const i = this.code.length; this.code.push([op, operand]); return i; }
  emitConst(v) { this.constants.push(v); return this.emit(OP.CONST, this.constants.length - 1); }

  compile(statements) {
    for (const s of statements) this.stmt(s);
    this.emit(OP.RET);
    return { code: this.code, constants: this.constants };
  }

  stmt(node) {
    switch (node.kind) {
      case "let": {
        this.expr(node.initializer);
        this.emit(OP.STORE, node.name.lexeme);
        break;
      }
      case "assign": {
        this.expr(node.value);
        this.emit(OP.STORE, node.name.kind === "variable" ? node.name.name : node.name.lexeme);
        break;
      }
      case "print":
        this.expr(node.value);
        this.emit(OP.PRINT);
        break;
      case "return":
        if (node.values && node.values.length > 1) {
          // 多值返回：打包成数组
          for (const v of node.values) this.expr(v);
          this.emit(OP.ARRAY, node.values.length);
        } else {
          this.expr(node.values ? node.values[0] : node.value);
        }
        this.emit(OP.RET);
        break;
      case "fun": {
        const fn = { kind: "mfun", name: node.name, params: node.params, body: new Compiler().compile(node.body).code };
        this.emitConst(fn);
        this.emit(OP.STORE, node.name);
        break;
      }
      case "done": {
        this.expr(node.condition);
        const jmpf = this.emit(OP.JMPF, null);   // 假则跳：条件假直接到块后
        for (const s of node.statements) this.stmt(s);
        this.code[jmpf][1] = this.code.length;
        break;
      }
      case "while": {
        const loopStart = this.code.length;
        this.expr(node.condition);
        const jmpf = this.emit(OP.JMPF, null);    // 假则跳出循环
        for (const s of node.body) this.stmt(s);
        this.emit(OP.JMP, loopStart);
        this.code[jmpf][1] = this.code.length;
        break;
      }
      case "block":
        for (const s of node.statements) this.stmt(s);
        break;
      case "exprStmt":
        this.expr(node.expr);
        break;
      case "import":
        break;   // import 由宿主在 beforeRun 处理；VM 里跳过
      default:
        throw new Error(`compiler: 暂不支持语句 ${node.kind}`);
    }
  }

  expr(node) {
    switch (node.kind) {
      case "literal": this.emitConst(node.value); break;
      case "variable": this.emit(OP.LOAD, node.name); break;
      case "assign": {
        // 赋值作为表达式：先算右值，DUP（左份）后 STORE（吃一份留一份）
        this.expr(node.value);
        this.emit(OP.DUP);
        this.emit(OP.STORE, node.name.kind === "variable" ? node.name.name : node.name.lexeme);
        break;
      }
      case "grouping": this.expr(node.expr); break;
      case "array": {
        for (const item of node.items) this.expr(item);
        this.emit(OP.ARRAY, node.items.length);
        break;
      }
      case "index": {
        this.expr(node.callee);
        this.expr(node.index);
        this.emit(OP.IDX);
        break;
      }
      case "unary":
        this.expr(node.right);
        this.emit(node.operator.lexeme === "-" ? OP.NEG : OP.NOT);
        break;
      case "call": {
        this.expr(node.callee);
        for (const a of node.args) this.expr(a);
        this.emit(OP.CALL, node.args.length);
        break;
      }
      case "binary": {
        this.expr(node.left);
        this.expr(node.right);
        const map = {
          "+": OP.ADD, "-": OP.SUB, "*": OP.MUL, "/": OP.DIV,
          "==": OP.EQ, "!=": OP.NEQ, "<": OP.LT, "<=": OP.LTE, ">": OP.GT, ">=": OP.GTE,
        };
        const op = map[node.operator.lexeme];
        if (!op) throw new Error(`compiler: 暂不支持运算符 ${node.operator.lexeme}`);
        this.emit(op);
        break;
      }
      case "logical": {
        // 纯二元语义（当前语言表达式无副作用，短路与全量观察不到差异——最简=合并）
        this.expr(node.left);
        this.expr(node.right);
        this.emit(node.operator === "&&" ? OP.LAND : OP.LOR);
        break;
      }
      default:
        throw new Error(`compiler: 暂不支持表达式 ${node.kind}`);
    }
  }
}

module.exports = { Compiler, OP };