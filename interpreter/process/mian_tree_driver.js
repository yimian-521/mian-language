// ── 免语言进程树驱动版执行器 ──
// 用进程树跑 .mi：主进程下令 → 指挥官调度 → 子进程拆派 → 执行体干活
// 三个执行体：lexer / parser / evaluator——各认领各的阶段，侦查旁路盯着
// 意义：进程树从骨架变成真干活的东西——语言自己走自己的指挥体系
const { buildTree, defineGroup } = require("./process_tree");
const { Lexer } = require("../lexer");
const { Parser } = require("../parser");
const { Evaluator } = require("../evaluator");
const { StrengthResolver } = require("../strength_resolver");

// ── 分工组：三个执行阶段，各自声明认领 + 能力 ──
defineGroup("词法", {
  name: "词法",
  claims: ["lex"],
  can: ["扫描", "切词"],
  fn: (task) => {
    const { tokens, errors } = new Lexer(task).scanTokens();
    if (errors.length) throw new Error(`词法错误: ${errors.map(e => e.message).join("; ")}`);
    return { tokens };
  },
});
defineGroup("语法", {
  name: "语法",
  claims: ["parse"],
  can: ["解析", "建树"],
  fn: (task) => {
    const { statements, errors } = new Parser(task.tokens).parseProgram();
    if (errors.length) throw new Error(`语法错误: ${errors.map(e => e.message).join("; ")}`);
    new StrengthResolver().resolve(statements);
    return { statements };
  },
});
defineGroup("执行", {
  name: "执行",
  claims: ["eval"],
  can: ["求值", "运行"],
  fn: async (task) => {
    const ev = new Evaluator({});
    await ev.interpret(task.statements);
    return { out: ev.out };
  },
});

// ── 组装一棵树：lexer / parser / evaluator 三个指挥域 ──
const lexTree = buildTree("lexer", [{ $group: "词法" }]);
const parseTree = buildTree("parser", [{ $group: "语法" }]);
const evalTree = buildTree("evaluator", [{ $group: "执行" }]);

// ── 指挥官入口：主进程一次下令，三阶段接力 ──
async function runWithTree(source) {
  // ① 主进程下令给词法指挥官
  const lexReport = await lexTree.main.command(source, "lexer");
  if (lexReport.completedCount !== 1) {
    return { error: lexReport.results[0] && lexReport.results[0].error || "词法失败", out: [] };
  }
  const tokens = lexReport.results[0].data.content.tokens;

  // ② 主进程下令给语法指挥官
  const parseReport = await parseTree.main.command({ tokens }, "parser");
  if (parseReport.completedCount !== 1) {
    return { error: parseReport.results[0] && parseReport.results[0].error || "语法失败", out: [] };
  }
  const statements = parseReport.results[0].data.content.statements;

  // ③ 主进程下令给执行指挥官
  const evalReport = await evalTree.main.command({ statements }, "evaluator");
  if (evalReport.completedCount !== 1) {
    return { error: evalReport.results[0] && evalReport.results[0].error || "执行失败", out: [] };
  }
  return { out: evalReport.results[0].data.content.out, error: null };
}

module.exports = { runWithTree, lexTree, parseTree, evalTree };