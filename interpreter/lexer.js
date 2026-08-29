// 免语言——词法分析器（手写，零正则）
// 职责只有一件：把字符流切成 token 流，并记录每个 token 的出生位置。
// 错误不在这里"说"——只收集（第4条：检测与报告分身份）。

const TOKEN = {
  // 字面量
  NUMBER: "NUMBER",
  STRING: "STRING",
  IDENT: "IDENT",
  // 关键字
  LET: "LET", PRINT: "PRINT", IF: "IF", THEN: "THEN", ELSE: "ELSE", DONE: "DONE", RETURN: "RETURN", FUN: "FUN",
  TRUE: "TRUE", FALSE: "FALSE", WHILE: "WHILE", FOR: "FOR", IMPORT: "IMPORT", REF: "REF",
  // 数组
  LBRACKET: "[", RBRACKET: "]",
  // 标点（边界符必须发声）
  LPAREN: "(", RPAREN: ")", LBRACE: "{", RBRACE: "}", SEMI: ";", COMMA: ",",
  DOT: ".",  // 属性访问（字符串方法 .len 等）
  COLON: ":",  // 字典键值分隔
  // 运算符
  PLUS: "+", MINUS: "-", STAR: "*", SLASH: "/",
  EQ: "=",        // 赋值（中值：有时效承诺）
  EQ_EQ: "==",    // 对等（动态/或许态——运行时看当前值，弱值）
  EQ_EQ_EQ: "===", // 比较（静态/定性态——类型严格一致才相等，强值）
  BANG: "!", BANG_EQ: "!=", BANG_EQ_EQ: "!==",
  AMPS: "&&", PIPES: "||",   // 逻辑与/或（短路）
  LT: "<", LT_EQ: "<=", GT: ">", GT_EQ: ">=",
  EOF: "EOF"
};

const KEYWORDS = new Map([
  ["let", "LET"], ["print", "PRINT"], ["if", "IF"], ["then", "THEN"], ["else", "ELSE"], ["done", "DONE"], ["return", "RETURN"], ["fun", "FUN"],
  ["true", "TRUE"], ["false", "FALSE"], ["while", "WHILE"], ["for", "FOR"], ["import", "IMPORT"], ["ref", "REF"]
]);

class Token {
  constructor(type, lexeme, literal, line, col) {
    this.type = type;       // 类型（身份，不是名字）
    this.lexeme = lexeme;   // 原文
    this.literal = literal; // 字面值的运行时形态
    this.line = line;       // 出生位置：行
    this.col = col;         // 出生位置：列
  }
  toString() { return `${this.type} '${this.lexeme}' @${this.line}:${this.col}`; }
}

class Lexer {
  constructor(source) {
    this.source = source;
    this.tokens = [];
    this.errors = [];   // 只收集，不呈现（报告是别人的身份）
    this.start = 0;
    this.current = 0;
    this.line = 1;
    this.col = 1;
  }

  scanTokens() {
    while (!this.isAtEnd()) {
      this.start = this.current;
      this.scanToken();
    }
    const here = this.pos();
    this.tokens.push(new Token(TOKEN.EOF, "", null, here.line, here.col));
    return { tokens: this.tokens, errors: this.errors };
  }

  isAtEnd() { return this.current >= this.source.length; }

  // advance 吃一个字符，并维护位置
  advance() {
    const c = this.source[this.current++];
    if (c === "\n") { this.line++; this.col = 1; } else { this.col++; }
    return c;
  }

  // peek 只看不吃（一个字符前瞻）
  peek() { return this.isAtEnd() ? "\0" : this.source[this.current]; }
  peekNext() { return this.current + 1 >= this.source.length ? "\0" : this.source[this.current + 1]; }

  pos() { return { line: this.line, col: this.col }; }

  // match：下一个字符是 expected 就吃掉（用于 != <= >= 这种双字符运算符）
  match(expected) {
    if (this.isAtEnd() || this.source[this.current] !== expected) return false;
    this.advance();
    return true;
  }

  // 添加 token（携带出生位置）
  addToken(type, literal) {
    const text = this.source.substring(this.start, this.current);
    this.tokens.push(new Token(type, text, literal === undefined ? null : literal, this.line, this.col));
  }

  recordError(message) {
    // 只记录，不声张
    this.errors.push({ message, line: this.line, col: this.col, lexeme: this.source.substring(this.start, this.current) });
  }

  scanToken() {
    const c = this.advance();
    switch (c) {
      case "(": this.addToken(TOKEN.LPAREN); break;
      case ")": this.addToken(TOKEN.RPAREN); break;
      case "{": this.addToken(TOKEN.LBRACE); break;
      case "}": this.addToken(TOKEN.RBRACE); break;
      case ";": this.addToken(TOKEN.SEMI); break;
      case "[": this.addToken(TOKEN.LBRACKET); break;
      case "]": this.addToken(TOKEN.RBRACKET); break;
      case ",": this.addToken(TOKEN.COMMA); break;
      case ".": this.addToken(TOKEN.DOT); break;
      case ":": this.addToken(TOKEN.COLON); break;
      case "+": this.addToken(TOKEN.PLUS); break;
      case "-": this.addToken(TOKEN.MINUS); break;
      case "*": this.addToken(TOKEN.STAR); break;
      case "/":
        if (this.match("/")) {   // 行注释：吃到行尾，不产出 token
          while (this.peek() !== "\n" && !this.isAtEnd()) this.advance();
        } else if (this.match("*")) {  // 块注释：吃到 */
          while (!(this.peek() === "*" && this.peekNext() === "/") && !this.isAtEnd()) this.advance();
          if (this.isAtEnd()) this.recordError("块注释没有闭合 */");
          else { this.advance(); this.advance(); }
        } else {
          this.addToken(TOKEN.SLASH);
        }
        break;
      case "&":
        if (this.match("&")) this.addToken(TOKEN.AMPS);
        else this.recordError("单个 & 不是运算符，要写 &&");
        break;
      case "|":
        if (this.match("|")) this.addToken(TOKEN.PIPES);
        else this.recordError("单个 | 不是运算符，要写 ||");
        break;
      case "!": this.addToken(this.match("=") ? (this.match("=") ? TOKEN.BANG_EQ_EQ : TOKEN.BANG_EQ) : TOKEN.BANG); break;
      case "=":
        if (this.match("=")) {
          // == 或 ===：先吃第二个 =，再看有没有第三个
          this.addToken(this.match("=") ? TOKEN.EQ_EQ_EQ : TOKEN.EQ_EQ);
        } else {
          this.addToken(TOKEN.EQ);
        }
        break;
      case "<": this.addToken(this.match("=") ? TOKEN.LT_EQ : TOKEN.LT); break;
      case ">": this.addToken(this.match("=") ? TOKEN.GT_EQ : TOKEN.GT); break;
      case " ": case "\r": case "\t": break; // 无意义空白
      case "\n": break; // 换行在 advance 里已计数
      case '"': this.scanString(); break;
      default:
        if (this.isDigit(c)) this.scanNumber();
        else if (this.isAlpha(c)) this.scanIdentifier();
        else this.recordError("不认识的字符");
    }
  }

  scanString() {
    while (this.peek() !== '"' && !this.isAtEnd()) this.advance();
    if (this.isAtEnd()) { this.recordError("字符串没有闭合引号"); return; }
    this.advance(); // 吃掉右引号
    // 字面值 = 去掉两侧引号
    this.addToken(TOKEN.STRING, this.source.substring(this.start + 1, this.current - 1));
  }

  scanNumber() {
    while (this.isDigit(this.peek())) this.advance();
    if (this.peek() === "." && this.isDigit(this.peekNext())) { // 只吃有小数部分的点
      this.advance();
      while (this.isDigit(this.peek())) this.advance();
    }
    this.addToken(TOKEN.NUMBER, Number(this.source.substring(this.start, this.current)));
  }

  // 最长匹配的落地：先整个吃成标识符，再查关键字表
  scanIdentifier() {
    while (this.isAlphaNumeric(this.peek())) this.advance();
    const text = this.source.substring(this.start, this.current);
    const kw = KEYWORDS.get(text);
    this.addToken(kw || TOKEN.IDENT, kw ? null : text);
  }

  isDigit(c) { return c >= "0" && c <= "9"; }
  isAlpha(c) { return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_"; }
  isAlphaNumeric(c) { return this.isAlpha(c) || this.isDigit(c); }
}

// 错误报告是独立身份：lexer 只收集，这里才呈现
class ErrorReporter {
  static reportFlex(scanner) {
    for (const e of scanner.errors) {
      console.error(`[词法错误] 第${e.line}行第${e.col}列 '${e.lexeme}'：${e.message}`);
    }
  }
}

module.exports = { Lexer, ErrorReporter, TOKEN, Token };