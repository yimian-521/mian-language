// 免语言报错库（免免原创句式 + 八步法映射）
// 设计：每个错误有唯一 ID / kind / 模板消息 / 对应八步法步骤。
// 使用：new MianError(MianErrors.E001, { name: "a" }) 自动填充消息。
// 分类同框架：code(用户代码) / boundary(越界) / contract(契约) / syntax(语法) / logic(逻辑冲突) / structure(结构)

const ERRORS = {
  // ── 模板 1：xx 不能直接作为 xx 存在（错位） ──
  E001: { kind: "code", msg: "数字不能直接作为数组存在，{val}[{idx}] 是数字不是数组" },
  E002: { kind: "code", msg: "数字不能直接作为字典存在，{val}[\"{key}\"] 是数字不是字典" },
  E003: { kind: "code", msg: "字符串不能直接作为字典存在，{val}[\"{key}\"] 是字符串不是字典" },
  E004: { kind: "code", msg: "布尔不能作为容器存在，{val}[{idx}] 是布尔不是数组" },
  E005: { kind: "code", msg: "函数不能直接作为数组存在，{val}[{idx}] 是函数不是数组" },
  E006: { kind: "code", msg: "代码不能直接作为值存在，需要先赋值成函数再引用" },
  E007: { kind: "code", msg: "代码不能直接作为数组元素存在，需要先赋值成函数再放进数组" },
  E008: { kind: "code", msg: "代码不能直接作为函数参数存在，需要先赋值成函数再传参" },
  E009: { kind: "code", msg: "代码块不能直接作为 return 值存在，需要先赋值成函数再返回" },

  // ── 模板 2：xx 逻辑冲突 / 错误逻辑 ──
  E020: { kind: "logic", msg: "同一作用域重复声明：'{name}' 已存在" },
  E021: { kind: "logic", msg: "同名函数和数组冲突：'{name}' 既被声明为函数又被声明为数组" },
  E022: { kind: "logic", msg: "函数参数名重复：参数 '{name}' 出现了多次" },
  E023: { kind: "logic", msg: "自引用声明：'{name}' 引用了自身，{name} = {name} 是未定义的" },
  E024: { kind: "logic", msg: "矛盾条件：条件 '{cond}' 下两个分支逻辑相同" },
  E025: { kind: "logic", msg: "跨文件循环依赖：import {path} 已在加载链中" },
  E026: { kind: "logic", msg: "闭包捕获了可变值：'{name}' 在闭包定义后被修改" },
  E027: { kind: "logic", msg: "全局变量 '{name}' 被函数内隐式修改" },

  // ── 模板 3：xx 不能具备 xx ──
  E040: { kind: "code", msg: "数字不能具备属性 '{prop}'" },
  E041: { kind: "code", msg: "布尔不能具备属性 '{prop}'" },
  E042: { kind: "code", msg: "函数不能具备数组索引，{val}[{idx}] 是函数不是数组" },
  E043: { kind: "code", msg: "数组不能具备字符串键，数组索引要是数字" },
  E044: { kind: "code", msg: "赋值目标不能是关键字/类名：'{name}' 是保留字" },

  // ── 模板 4：xx 过多 ──
  E060: { kind: "structure", msg: "嵌套过多：{type} 层级超过 {limit} 层" },
  E061: { kind: "structure", msg: "参数过多：函数 '{name}' 需要 {expect} 个参数，但传了 {actual} 个" },
  E062: { kind: "structure", msg: "数组元素过多：字面量元素超过 {limit} 个" },
  E063: { kind: "boundary", msg: "循环次数过多：{type} 跑了超过 {limit} 次，可能是死循环" },
  E064: { kind: "boundary", msg: "递归深度过多：超过 {limit} 层，函数可能是无限递归" },

  // ── 模板 5：无 xx ──
  E080: { kind: "code", msg: "变量 '{name}' 声明必须带初始值，let {name} = ..." },
  E081: { kind: "code", msg: "变量 '{name}' 未声明" },
  E082: { kind: "code", msg: "函数没有 return 语句：'{name}' 没有返回值" },
  E083: { kind: "code", msg: "import 路径不允许 .. 穿越" },
  E084: { kind: "code", msg: "import 只支持 .mi 文件" },
  E085: { kind: "code", msg: "import 打不开文件: {path}" },

  // ── 八步法映射：第 1 步 符号解析 ──
  E101: { kind: "code", msg: "变量 '{name}' 未声明" },
  E102: { kind: "code", msg: "赋值目标必须是个变量，不能是字面量或表达式" },

  // ── 八步法映射：第 2 步 前提检查 ──
  E201: { kind: "code", msg: "不能用 + 连接 {ltype} 和 {rtype}" },
  E202: { kind: "code", msg: "不同类型不能比大小：{ltype} 和 {rtype}" },
  E203: { kind: "contract", msg: "函数 '{name}' 需要 {expect} 个参数，但传了 {actual} 个" },
  E204: { kind: "code", msg: "数组索引要是数字，不能用字符串" },
  E205: { kind: "code", msg: "字典索引要是字符串，不能用数字" },
  E206: { kind: "code", msg: "字典没有键 '{key}'" },
  E207: { kind: "code", msg: "除数为零" },

  // ── 八步法映射：第 4 步 控制流 ──
  E401: { kind: "contract", msg: "done 的条件必须是定性裁决，不能是猜测（用 === 而不是 ==）" },
  E402: { kind: "boundary", msg: "while 跑了超过 {limit} 次，可能是死循环" },
  E403: { kind: "boundary", msg: "for 跑了超过 {limit} 次，可能是死循环" },
  E404: { kind: "boundary", msg: "递归太深（>{limit} 层），函数可能是无限递归" },

  // ── 八步法映射：第 5 步 身份检查 ──
  E501: { kind: "code", msg: "不是函数，不能调用：{val}" },
  E502: { kind: "code", msg: "一元运算的类型不对" },

  // ── 八步法映射：第 7 步 系统沉默 ──
  E701: { kind: "boundary", msg: "索引越界：长度 {len}，索引 {idx}" },
  E702: { kind: "boundary", msg: "字符串索引越界：长度 {len}，索引 {idx}" },
  E703: { kind: "code", msg: "解构赋值右边必须是数组" },
  E704: { kind: "contract", msg: "解构需要 {expect} 个值，但右侧只有 {actual} 个" },
  E705: { kind: "code", msg: "对象没有属性 '{prop}'" },

  // ── 错位类（模板 1 的细化） ──
  E901: { kind: "code", msg: "数字不能作为数组/字典/字符串用索引访问" },
  E902: { kind: "code", msg: "字符串索引要是数字" },
  E903: { kind: "code", msg: "len 只支持字符串、数组或字典" },
  E904: { kind: "code", msg: "chr 需要数字" },
  E905: { kind: "code", msg: "get 第一个参数要是字典" },

  // ── 运行时标准库 ──
  E906: { kind: "code", msg: "解构赋值右边必须是数组" },
  E907: { kind: "contract", msg: "解构需要 {expect} 个值，但右侧只有 {actual} 个" },
  E908: { kind: "code", msg: "import 需要宿主注入 importLoader/parseSource" },
  E909: { kind: "code", msg: "未知节点 kind: {kind}" },
  E910: { kind: "code", msg: "一元运算的类型不对" },
  E911: { kind: "code", msg: "对象没有属性 '{prop}'" },
  E912: { kind: "code", msg: "赋值目标必须是个变量" },
  E913: { kind: "code", msg: "{op} 只吃数字" },
  E914: { kind: "code", msg: "不能用 {ltype} 和 {rtype} 做运算" },
};

// 格式化：替换 {name} 等占位符
function fmt(template, params) {
  let s = template;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replaceAll(`{${k}}`, v === undefined ? "?" : String(v));
    }
  }
  return s;
}

// 注册表：按 ID 查
function lookup(id) {
  return ERRORS[id] || { kind: "code", msg: "未知错误" };
}

// 列出所有错误 ID
function listIds() {
  return Object.keys(ERRORS);
}

// 便捷构造函数：按错误码抛 MianError
// 用法：throw makeError("E001", { val: 42, idx: 0 }, line, col)
// 返回一个 MianError（带唯一码/kind/level/填充好的消息）
function makeError(id, params, line, col) {
  const def = lookup(id);
  const msg = fmt(def.msg, params);
  // 延迟 require 避免循环依赖：evaluator 已 require 本模块，这里反向 require evaluator 会成环。
  // 所以 makeError 不构造 MianError，返回一个普通结构，由调用方 new MianError 包一层。
  return { id, kind: def.kind, level: def.level || "error", message: msg, line: line || 0, col: col || 0 };
}

module.exports = { ERRORS, lookup, fmt, listIds, makeError };