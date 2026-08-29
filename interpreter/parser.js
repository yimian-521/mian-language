// 免语言——语法分析器（手写递归下降）
// 原则：
// 1. 优先级瀑布——歧义在结构里生不出来
// 2. kind 查表——AST 节点身份就是路由，不要 Visitor 转发层
// 3. panic mode——报错代码照样有产出，在语句边界同步
// 4. 错误收集与呈现分身份（parser 只收集，reporter 才呈现）

const { TOKEN } = require("./lexer");

class ParseError extends Error {}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.current = 0;
    this.errors = [];   // 只收集
  }

  // ── 主入口：程序 = 声明序列 ──
  parseProgram() {
    const statements = [];
    while (!this.isAtEnd()) {
      const start = this.current;
      try {
        statements.push(this.declaration());
      } catch (e) {
        if (!(e instanceof ParseError)) throw e;
        this.synchronize();   // panic mode：跳到下一个语句边界继续
      }
    }
    return { statements, errors: this.errors };
  }

  // ── 前瞻四件套 ──
  peek() { return this.tokens[this.current]; }
  previous() { return this.tokens[this.current - 1]; }
  isAtEnd() { return this.peek().type === TOKEN.EOF; }
  check(type) { return this.isAtEnd() ? false : this.peek().type === type; }

  advance() {
    if (!this.isAtEnd()) this.current++;
    return this.previous();
  }

  match(...types) {
    for (const t of types) {
      if (this.check(t)) { this.advance(); return true; }
    }
    return false;
  }

  consume(type, message) {
    if (this.check(type)) return this.advance();
    throw this.error(this.peek(), message);
  }

  error(token, message) {
    // 只收集，交给 reporter 呈现
    this.errors.push({ message, line: token.line, col: token.col, at: token.lexeme });
    return new ParseError(message);
  }

  // panic mode 同步：丢 token 直到语句边界（分号后 / 关键字前）
  synchronize() {
    this.advance();
    while (!this.isAtEnd()) {
      if (this.previous().type === TOKEN.SEMI) return;
      const t = this.peek().type;
      if ([TOKEN.LET, TOKEN.PRINT, TOKEN.DONE, TOKEN.IF].includes(t)) return;
      this.advance();
    }
  }

  // ── 声明层 ──
  declaration() {
    if (this.match(TOKEN.IMPORT)) return this.importStatement();
    if (this.match(TOKEN.LET)) return this.letDeclaration();
    if (this.match(TOKEN.RETURN)) return this.returnStatement();
    if (this.match(TOKEN.FUN)) return this.funDeclaration();
    return this.statement();
  }

  importStatement() {
    // import "路径.mi"; —— 加载外部文件，共享同一环境
    const path = this.consume(TOKEN.STRING, "import 后面要跟字符串路径");
    this.consume(TOKEN.SEMI, "import 语句结尾要写 ;");
    return { kind: "import", path: path.literal, line: path.line };
  }

  // fun add(a, b) { return a + b; }
  funDeclaration() {
    const name = this.consume(TOKEN.IDENT, "fun 后面要跟函数名");
    this.consume(TOKEN.LPAREN, "函数名后要跟 (");
    const params = [];
    if (!this.check(TOKEN.RPAREN)) {
      do {
        params.push(this.consume(TOKEN.IDENT, "参数要是名字").lexeme);
      } while (this.match(TOKEN.COMMA));
    }
    this.consume(TOKEN.RPAREN, "参数列表要 ) 收尾");
    this.consume(TOKEN.LBRACE, "函数体要 { 开头");
    const body = this.block();
    return { kind: "fun", name: name.lexeme, params, body, line: name.line };
  }

  letDeclaration() {
    // 支持解构：let (x, y) = f(); 或多个变量
    if (this.match(TOKEN.LPAREN)) {
      const names = [this.consume(TOKEN.IDENT, "解构里要是变量名").lexeme];
      while (this.match(TOKEN.COMMA)) {
        names.push(this.consume(TOKEN.IDENT, "解构里要是变量名").lexeme);
      }
      this.consume(TOKEN.RPAREN, "解构要 ) 收尾");
      this.consume(TOKEN.EQ, "变量声明要写 =");
      const initializer = this.expression();
      this.consume(TOKEN.SEMI, "语句结尾要写 ;");
      return { kind: "letDestructure", names, initializer, line: this.previous().line };
    }
    const name = this.consume(TOKEN.IDENT, "let 后面要跟变量名");
    // 严格：变量声明必须有初始值，let a; 是静默错误的温床（undefined 会静默传播）
    if (!this.match(TOKEN.EQ)) {
      throw this.error(this.peek(), `变量 '${name.lexeme}' 声明必须带初始值，let ${name.lexeme} = ...`);
    }
    const initializer = this.expression();
    this.consume(TOKEN.SEMI, "语句结尾要写 ;");
    return { kind: "let", name, initializer, line: name.line, col: name.col };
  }

  returnStatement() {
    // return 支持多值：return a, b; —— 逗号分隔打包成数组
    const values = [this.expression()];
    while (this.match(TOKEN.COMMA)) {
      values.push(this.expression());
    }
    this.consume(TOKEN.SEMI, "return 语句结尾要写 ;");
    return { kind: "return", values };
  }

  // ── 语句层 ──
  statement() {
    if (this.match(TOKEN.PRINT)) return this.printStatement();
    if (this.match(TOKEN.IF)) return this.ifStatement();
    if (this.match(TOKEN.DONE)) return this.doneStatement();
    if (this.match(TOKEN.WHILE)) return this.whileStatement();
    if (this.match(TOKEN.FOR)) return this.forStatement();
    if (this.match(TOKEN.LBRACE)) return { kind: "block", statements: this.block() };
    return this.expressionStatement();
  }

  // if 条件 { 走这支 } else { 走另一支 } —— 或许态：两个可能世界都摆在明面上
  ifStatement() {
    const condition = this.expression();
    this.consume(TOKEN.LBRACE, "if 后面要跟 { 块");
    const thenBranch = this.block();
    let elseBranch = null;
    if (this.match(TOKEN.ELSE)) {
      if (this.match(TOKEN.IF)) {
        // else if：链式或许态
        const nested = this.ifStatement();
        elseBranch = [nested];
      } else {
        this.consume(TOKEN.LBRACE, "else 后面要跟 { 块");
        elseBranch = this.block();
      }
    }
    return { kind: "if", condition, thenBranch, elseBranch, line: this.previous().line };
  }

  whileStatement() {
    this.consume(TOKEN.LPAREN, "while 后面要 ()");
    const condition = this.expression();
    this.consume(TOKEN.RPAREN, "while 条件要 ) 收尾");
    this.consume(TOKEN.LBRACE, "while 体要 { 开头");
    const body = this.block();
    return { kind: "while", condition, body, line: this.previous().line };
  }

  // for 经典三件套；init 和 increment 都允许赋值表达式
  forStatement() {
    this.consume(TOKEN.LPAREN, "for 后面要 ()");
    let init = null;
    if (!this.check(TOKEN.SEMI)) init = this.expression();
    this.consume(TOKEN.SEMI, "for 第一部分后要 ;");
    let condition = null;
    if (!this.check(TOKEN.SEMI)) condition = this.expression();
    this.consume(TOKEN.SEMI, "for 第二部分后要 ;");
    let increment = null;
    if (!this.check(TOKEN.RPAREN)) increment = this.expression();
    this.consume(TOKEN.RPAREN, "for 第三部分后要 )");
    this.consume(TOKEN.LBRACE, "for 体要 { 开头");
    const body = this.block();
    return { kind: "for", init, condition, increment, body, line: this.previous().line };
  }

  printStatement() {
    const value = this.expression();
    this.consume(TOKEN.SEMI, "print 语句结尾要写 ;");
    return { kind: "print", value };
  }

  // done a == 3 { ... } —— 定性态：事实不成立不是 else，是下一个事实
  doneStatement() {
    const condition = this.expression();
    this.consume(TOKEN.LBRACE, "done 后面要跟 { 块");
    const statements = this.block();
    return { kind: "done", condition, statements, force: true };
  }

  block() {
    const statements = [];
    while (!this.check(TOKEN.RBRACE) && !this.isAtEnd()) {
      statements.push(this.declaration());
    }
    this.consume(TOKEN.RBRACE, "块要 } 收尾");
    return statements;
  }

  expressionStatement() {
    const expr = this.expression();
    this.consume(TOKEN.SEMI, "表达式语句结尾要写 ;");
    return { kind: "exprStmt", expr };
  }

  expression() { return this.or(); }

  // || 与 &&：短路逻辑（优先级低于赋值，最低层）
  or() {
    let expr = this.and();
    while (this.match(TOKEN.PIPES)) {
      const op = this.previous();
      const right = this.and();
      expr = { kind: "logical", operator: op.lexeme, left: expr, right, line: op.line };
    }
    return expr;
  }

  and() {
    let expr = this.assignment();
    while (this.match(TOKEN.AMPS)) {
      const op = this.previous();
      const right = this.assignment();
      expr = { kind: "logical", operator: op.lexeme, left: expr, right, line: op.line };
    }
    return expr;
  }

  // 赋值 = 右结合、优先级最低（for 的 increment 和 while 里的计数都要它）
  assignment() {
    const expr = this.equality();
    if (this.match(TOKEN.EQ)) {
      const eq = this.previous();
      const value = this.assignment();   // 右结合：a = b = c
      if (expr.kind !== "variable" && expr.kind !== "call") {
        throw this.error(eq, "赋值目标必须是个变量");
      }
      return { kind: "assign", name: expr, value, line: eq.line };
    }
    return expr;
  }

  // ── 优先级瀑布（每层只认自己的运算符 + 更高层） ──
  equality() {
    let expr = this.comparison();
    while (this.match(TOKEN.BANG_EQ, TOKEN.BANG_EQ_EQ, TOKEN.EQ_EQ, TOKEN.EQ_EQ_EQ)) {
      const operator = this.previous();
      const right = this.comparison();
      expr = { kind: "binary", operator, left: expr, right, line: operator.line };
    }
    return expr;
  }

  comparison() {
    let expr = this.term();
    while (this.match(TOKEN.GT, TOKEN.GT_EQ, TOKEN.LT, TOKEN.LT_EQ)) {
      const operator = this.previous();
      const right = this.term();
      expr = { kind: "binary", operator, left: expr, right, line: operator.line };
    }
    return expr;
  }

  term() {
    let expr = this.factor();
    while (this.match(TOKEN.MINUS, TOKEN.PLUS)) {
      const operator = this.previous();
      const right = this.factor();
      expr = { kind: "binary", operator, left: expr, right, line: operator.line };
    }
    return expr;
  }

  factor() {
    let expr = this.unary();
    while (this.match(TOKEN.SLASH, TOKEN.STAR)) {
      const operator = this.previous();
      const right = this.unary();
      expr = { kind: "binary", operator, left: expr, right, line: operator.line };
    }
    return expr;
  }

  unary() {
    if (this.match(TOKEN.REF)) {
      const kw = this.previous();
      // ref 目标：ref x（变量）或 ref a[0] / ref d["k"]（容器元素），也支持 ref a[0][1] 链
      // 解析成"可寻址路径"节点（容器 + 索引链），不求值
      if (this.check(TOKEN.IDENT)) {
        const nameTok = this.advance();
        // 检查是否有后续索引链 [0] / ["k"]
        const indices = [];
        while (this.match(TOKEN.LBRACKET)) {
          const idx = this.expression();
          this.consume(TOKEN.RBRACKET, "索引要 ] 收尾");
          indices.push(idx);
        }
        if (indices.length === 0) {
          return { kind: "ref", name: nameTok.lexeme, line: kw.line };
        }
        // 有索引链：ref a[0] 或 ref a[0][1] —— 目标是容器元素
        return { kind: "refElem", name: nameTok.lexeme, indices, line: kw.line };
      }
      throw this.error(this.peek(), "ref 后面要跟一个可引用的目标（变量名或 容器[索引]）");
    }
    if (this.match(TOKEN.BANG, TOKEN.MINUS)) {
      const operator = this.previous();
      const right = this.unary();
      return { kind: "unary", operator, right, line: operator.line };
    }
    return this.call();
  }

  // 后缀 = 调用或索引，可链式：a[0](x) 也认
  call() {
    let expr = this.primary();
    while (true) {
      if (this.match(TOKEN.LPAREN)) {
        expr = this.finishCall(expr);
      } else if (this.match(TOKEN.LBRACKET)) {
        const index = this.expression();
        this.consume(TOKEN.RBRACKET, "索引要 ] 收尾");
        expr = { kind: "index", callee: expr, index, line: this.previous().line };
      } else if (this.match(TOKEN.DOT)) {
        // 属性访问：字符串方法 .len 等
        const name = this.consume(TOKEN.IDENT, "属性访问 . 后面要跟名字");
        expr = { kind: "getattr", callee: expr, name: name.lexeme, line: name.line };
      } else {
        break;
      }
    }
    return expr;
  }

  finishCall(callee) {
    const args = [];
    if (!this.check(TOKEN.RPAREN)) {
      do {
        args.push(this.expression());
      } while (this.match(TOKEN.COMMA));
    }
    const paren = this.consume(TOKEN.RPAREN, "调用参数要 ) 收尾");
    return { kind: "call", callee, args, line: paren.line };
  }

  primary() {
    if (this.match(TOKEN.NUMBER, TOKEN.STRING)) {
      return { kind: "literal", value: this.previous().literal, line: this.previous().line };
    }
    if (this.match(TOKEN.TRUE)) return { kind: "literal", value: true, line: this.previous().line };
    if (this.match(TOKEN.FALSE)) return { kind: "literal", value: false, line: this.previous().line };
    if (this.match(TOKEN.LBRACKET)) {
      const items = [];
      if (!this.check(TOKEN.RBRACKET)) {
        do {
          items.push(this.expression());
        } while (this.match(TOKEN.COMMA));
      }
      this.consume(TOKEN.RBRACKET, "数组要 ] 收尾");
      return { kind: "array", items, line: this.previous().line };
    }
    // 字典字面量：{"name": "望安", "age": 3} —— 键须是字符串，值任意
    if (this.match(TOKEN.LBRACE)) {
      const entries = [];
      if (!this.check(TOKEN.RBRACE)) {
        do {
          const key = this.consume(TOKEN.STRING, "字典键要是字符串");
          this.consume(TOKEN.COLON, "键后面要写 :");
          const value = this.expression();
          entries.push({ key: key.literal, value });
        } while (this.match(TOKEN.COMMA));
      }
      this.consume(TOKEN.RBRACE, "字典要 } 收尾");
      return { kind: "dict", entries, line: this.previous().line };
    }
    if (this.match(TOKEN.IDENT)) {
      return { kind: "variable", name: this.previous().lexeme, line: this.previous().line };
    }
    if (this.match(TOKEN.LPAREN)) {
      const expr = this.expression();
      this.consume(TOKEN.RPAREN, "右括号 ) 去哪了");
      return { kind: "grouping", expr };
    }
    // 走投无路才报错，同时把它吃掉避免死循环
    const t = this.advance();
    throw this.error(t, "这个位置需要一个表达式");
  }
}

// 错误呈现是独立身份
class ParserReporter {
  static reportFlex(parserErrors) {
    for (const e of parserErrors) {
      console.error(`[语法错误] 第${e.line}行第${e.col}列 '${e.at}'：${e.message}`);
    }
  }
}

// AST 打印（看嵌套结构，像 lisp 括号——调试用）
function printAst(node, depth = 0) {
  if (node === null || node === undefined) return "nil";
  const pad = " ".repeat(depth * 2);
  switch (node.kind) {
    case "literal": return `${pad}(${node.value})`;
    case "variable": return `${pad}(var ${node.name})`;
    case "grouping": return `${pad}(group ${printAst(node.expr, depth + 1).trimStart()})`;
    case "unary": return `${pad}(${node.operator.lexeme} ${printAst(node.right, depth + 1).trimStart()})`;
    case "binary": return `${pad}(${node.operator.lexeme} ${printAst(node.left, depth + 1).trimStart()} ${printAst(node.right, depth + 1).trimStart()})`;
    case "let": return `${pad}(let ${node.name.lexeme} = ${printAst(node.initializer, depth + 1).trimStart()})`;
    case "print": return `${pad}(print ${printAst(node.value, depth + 1).trimStart()})`;
    case "return": return `${pad}(return ${printAst(node.value, depth + 1).trimStart()})`;
    case "fun": return `${pad}(fun ${node.name}(${node.params.join(", ")}) { ${node.body.map(s => printAst(s, depth + 1).trimStart()).join(" ")} })`;
    case "call": return `${pad}(call ${printAst(node.callee, depth + 1).trimStart()} [${node.args.map(a => printAst(a, depth + 1).trimStart()).join(", ")}])`;
    case "done": return `${pad}(done ${printAst(node.condition, depth + 1).trimStart()} { ${node.statements.map(s => printAst(s, depth + 1).trimStart()).join(" ")} })`;
    case "while": return `${pad}(while ${printAst(node.condition, depth + 1).trimStart()} { ${node.body.map(s => printAst(s, depth + 1).trimStart()).join(" ")} })`;
    case "for": return `${pad}(for [${node.init ? printAst(node.init, depth + 1).trimStart() : "_"}] [${node.condition ? printAst(node.condition, depth + 1).trimStart() : "_"}] [${node.increment ? printAst(node.increment, depth + 1).trimStart() : "_"}] { ${node.body.map(s => printAst(s, depth + 1).trimStart()).join(" ")} })`;
    case "assign": return `${pad}(assign ${printAst(node.name, depth + 1).trimStart()} = ${printAst(node.value, depth + 1).trimStart()})`;
    case "array": return `${pad}(array [${node.items.map(i => printAst(i, depth + 1).trimStart()).join(", ")}])`;
    case "index": return `${pad}(index ${printAst(node.callee, depth + 1).trimStart()} @${printAst(node.index, depth + 1).trimStart()})`;
    case "block": return `${pad}(block ${node.statements.map(s => printAst(s, depth + 1).trimStart()).join(" ")})`;
    case "exprStmt": return `${pad}(expr ${printAst(node.expr, depth + 1).trimStart()})`;
    default: return `${pad}(?${node.kind})`;
  }
}

module.exports = { Parser, ParserReporter, printAst, ParseError };