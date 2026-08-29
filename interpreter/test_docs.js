// 手册新章实测：数组/赋值/while/for/str，每个都必须真跑通
const { run } = require("./test_runner");

(async () => {
  // 手册§二 数组
  let r = await run("let a = [10, 20, 30]; return a[1];");
  console.log("§二 数组索引:", r.result === 20 ? "✓" : "✗ " + r.result);

  r = await run("let a = [1, 2]; print len(a);");
  console.log("§二 len数组:", r.out.join("|") === "2" ? "✓" : "✗ " + r.out.join("|"));

  r = await run("let a = [1, 2]; return a[5];");
  console.log("§二 越界报错:", r.runtimeError ? "✓ " + r.runtimeError.message.slice(0, 30) : "✗ 没报错");

  // 手册§五 赋值
  r = await run("let x = 0; x = 7; return x;");
  console.log("§五 赋值:", r.result === 7 ? "✓" : "✗ " + r.result);

  // 手册§五 while
  r = await run("let i = 0; let s = 0; while (i < 5) { s = s + i; i = i + 1; } return s;");
  console.log("§五 while求和:", r.result === 10 ? "✓" : "✗ " + r.result);

  // 手册§五 for
  r = await run("let s = 0; for (i = 0; i < 6; i = i + 1) { s = s + i; } return s;");
  console.log("§五 for求和:", r.result === 15 ? "✓" : "✗ " + r.result);

  // 手册§九 str
  r = await run('print "共" + str(3) + "条";');
  console.log("§九 str拼接:", r.out.join("|") === "共3条" ? "✓" : "✗ " + r.out.join("|"));

  // 手册完整示例
  r = await run('fun classify(n) { done n >= 90 { return "优"; } done n >= 60 { return "及格"; } return "待提高"; } let score = 85; let grade = classify(score); print grade;');
  console.log("完整示例:", r.out.join("|") === "及格" ? "✓" : "✗ " + r.out.join("|"));
})();