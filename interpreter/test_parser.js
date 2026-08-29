// lexer + parser 串联测试：同一句免语言，从字符到 AST
const { Lexer, LexerReporter } = require("./lexer");
const { Parser, ParserReporter, printAst } = require("./parser");

const source = 'let a = 1 + 2 * 3; print a; done a == 7 { print "对，就是事实"; }';

// ① 词法
const { tokens, errors: lexErrors } = new Lexer(source).scanTokens();
console.log("=== ① 词法：", tokens.length, "个 token ===");
if (lexErrors.length) LexerReporter.reportFlex(lexErrors);

// ② 语法
const { statements, errors: parseErrors } = new Parser(tokens).parseProgram();
console.log("\n=== ② 语法：", statements.length, "条语句 ===");
if (parseErrors.length) ParserReporter.reportFlex(parseErrors);

console.log("\n=== ③ AST（嵌套结构，验证优先级：1+2*3 应该 (+ 1 (* 2 3))）===");
for (const s of statements) {
  console.log(printAst(s));
}