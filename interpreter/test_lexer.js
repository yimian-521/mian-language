// 免语言第一个可运行的小测试：lexer 解读第一句 .mi
const { Lexer } = require("./lexer");

// 第一句免语言候选（A 语法切片的试验台）：
// let a = 1 + 2; print a; done a == 3 { print "ok" }
const source = 'let a = 1 + 2; print a; done a == 3 { print "ok" }';

const { tokens, errors } = new Lexer(source).scanTokens();

console.log("=== 词法分析结果 ===");
for (const t of tokens) {
  console.log(t.toString());
}
console.log("=== 错误数:", errors.length, "===");
if (errors.length) {
  for (const e of errors) console.error(`[词法错误] 第${e.line}行:${e.col} '${e.lexeme}' ${e.message}`);
}