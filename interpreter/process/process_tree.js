// ── 免语言进程树（四层指挥骨架）──
// 复刻 kotlin-head 的进程树骨架，用免语言哲学重写：
//   kotlin-head 四层：MainProcess 只下命令 → Commander 只调度 →
//                      SubProcess 只拆解+分派+合并 → ProcessBody 只执行
//   外加 WatchProcess 侦查旁路（与子进程平级，不拦截结果）
// 免语言落地原则：
//   1. 角色不塌缩——每层只做一件事
//   2. 身份烙印——ProcessId 创建时烙上，报告路径写死在身份里，越级汇报不可能
//   3. 复制性引用——层间传递走快照副本，不共享内存
//   4. 问-答契约——执行体回禀 [成功?, 数据|原因]，不抛不吞
//   5. 五段账本——任务的一生：birth(下令)→transit(派发)→consume(执行)→report(回禀)→destroy(回收)

// ── 分工分组注册表：写一遍标准，全组复刻 ──
// 标准由用户自己注册（语言不内置任何组），每个实例身份仍唯一。
// defineGroup("侦查", { claims, can, fn 或 make }) → 之后 spawn { $group:"侦查" } 即可。
const GroupRegistry = new Map();

function defineGroup(name, spec = {}) {
  GroupRegistry.set(name, spec);
  return GroupRegistry;
}

// 实例化某组标准：overrides 只覆盖不想继承的部分
function instantiateGroup(name, id, overrides = {}) {
  const spec = GroupRegistry.get(name);
  if (!spec) return null;
  const fn = overrides.fn || spec.fn || (typeof spec.make === "function" ? spec.make(overrides) : (() => "组无执行函数"));
  const declare = {
    name: overrides.name || spec.name || name,
    claims: overrides.claims != null ? overrides.claims : (spec.claims != null ? spec.claims : []),
    can: overrides.can != null ? overrides.can : (spec.can || []),
  };
  const body = new ProcessBody(id, fn, declare);
  body.groupName = name; // 组名随身份走，账本可见
  return body;
}
class ProcessId {
  constructor(commanderId, subProcessId, bodyId) {
    this.commanderId = commanderId;
    this.subProcessId = subProcessId;
    this.bodyId = bodyId;
  }
  get reportPath() {
    return `body:${this.bodyId} → sub:${this.subProcessId} → cmd:${this.commanderId} → main`;
  }
}

// ── 复制性引用：数据载体，传递走快照 ──
class ProcessData {
  constructor(content, sourceBodyId, timestamp = Date.now()) {
    this.content = content;
    this.sourceBodyId = sourceBodyId;
    this.timestamp = timestamp;
  }
  snapshot() { return new ProcessData(this.content, this.sourceBodyId, this.timestamp); }
}

// ── 执行结果：问-答契约的两种形状 + 半成功 ──
class ProcessSuccess {
  constructor(data, metrics = {}) { this.data = data; this.metrics = metrics; this.ok = true; }
}
class ProcessPartial {
  constructor(data, errors, completedFraction) {
    this.data = data; this.errors = errors; this.completedFraction = completedFraction; this.ok = false; this.partial = true;
  }
}
class ProcessFailure {
  constructor(error, recoverable = true) { this.error = error; this.recoverable = recoverable; this.ok = false; }
}

// ── 侦查进程：旁路观察，不拦截、不阻塞数据通道 ──
// kotlin-head 有 8 种风格；免语言骨架先落 2 种基线（哨兵守门 + 标准全程），
// 风格是可扩展维度，骨架不锁死。
class WatchProcess {
  constructor(id, targetSubProcessId, style = "standard") {
    this.id = id;
    this.targetSubProcessId = targetSubProcessId;
    this.style = style; // "sentinel" | "standard"
    this.gateActions = new Set(["dispatch_start", "execute_done", "merge_done"]);
    this.anomalies = [];
    this.steps = 0;
  }
  observe(step) {
    this.steps++;
    const abnormal = step.abnormal === true;
    if (this.style === "sentinel" && !this.gateActions.has(step.action)) return null;
    if (abnormal) {
      this.anomalies.push(`[${this.style}] ${step.action} 异常: body=${step.bodyId}`);
      return { anomalies: [this.anomalies[this.anomalies.length - 1]], suspicion: this.style === "sentinel" ? 0.9 : 0.5 };
    }
    return null;
  }
  finalReport() {
    return {
      anomalies: this.anomalies.slice(),
      suspicion: this.steps === 0 ? 0 : Math.min(0.9, this.anomalies.length / this.steps),
      recommendation: this.anomalies.length === 0 ? "全程无异常" : `${this.anomalies.length} 处异常，建议复查`,
    };
  }
}

// ── 第四层：执行体——唯一执行层，只干一件事：execute ──
// 分工与能力全开放——语言一个职业表都不内置：
//   declare 可以是（按需自由组合，谁想造什么分工都行）：
//     "修bug"                     → claims 认领含"修bug"的任务（旧写法兼容）
//     (task) => bool              → 认领判定函数
//     ["修bug", "搬砖"]             → 认领一组标签
//     { name:"军师", claims:[...], can:["诊断","重构"] } → 全量：分工名 + 认领 + 能力
class ProcessBody {
  constructor(id, fn, declare = null) {
    this.id = id;             // ProcessId
    this.fn = fn;             // (task) => ProcessData | throws
    this.name = (declare && typeof declare === "object" && !Array.isArray(declare) && declare.name) || "";
    this.claims = (declare && typeof declare === "object" && !Array.isArray(declare) && declare.claims != null
      ? declare.claims : declare) || null;   // string | string[] | fn | null
    this.can = (declare && typeof declare === "object" && !Array.isArray(declare) && declare.can) || [];  // 自由能力表
    this.claimList = Array.isArray(this.claims) ? this.claims : (typeof this.claims === "string" ? [this.claims] : []);
  }
  // 认领判定：claims 命中 → true；不表态 → null（交给兜底）
  canHandle(task) {
    const t = task && typeof task === "object" && "task" in task ? task.task : task;
    if (typeof this.claims === "function") { try { return !!this.claims(t); } catch (_) { return false; } }
    if (this.claimList.length > 0) return this.claimList.some(c => String(t).includes(c)) ? true : false;
    return null;
  }
  // 能力匹配：任务需要的能力本执行体有没有
  hasNeed(task) {
    const need = task && typeof task === "object" && Array.isArray(task.need) ? task.need : null;
    if (!need || need.length === 0) return false;
    return need.every(n => this.can.includes(n));
  }
  execute(task) {
    const t = task && typeof task === "object" && "task" in task ? task.task : task;
    try {
      const data = this.fn(t);
      // 支持 async 执行体（evaluator 是 async）——结果 Promise 也能如实回禀
      if (data && typeof data.then === "function") {
        return data.then(
          (d) => new ProcessSuccess(d instanceof ProcessData ? d : new ProcessData(d, this.id.bodyId)),
          (e) => new ProcessFailure(String(e && e.message || e))
        );
      }
      return new ProcessSuccess(data instanceof ProcessData ? data : new ProcessData(data, this.id.bodyId));
    } catch (e) {
      // 不吞不抛——如实回禀原因
      return new ProcessFailure(String(e && e.message || e));
    }
  }
}

// ── 第三层：子进程——拆解+分派+合并，不亲自执行 ──
class SubProcess {
  constructor(id, tag, bodies = [], strategy = null) {
    this.id = id;             // ProcessId
    this.tag = tag;
    this.bodies = bodies;     // ProcessBody[]
    this.strategy = strategy; // 分派策略（可选注入）：(task, bodies) => body|null；不注入走默认
  }
  delegate(tasks) {
    const results = [];
    let hasAsync = false;
    for (const task of tasks) {
      const body = this.pickBody(task);
      if (!body) { results.push(new ProcessFailure("没有适合这个任务的分工", true)); continue; }
      const r = body.execute(task);
      if (r && typeof r.then === "function") hasAsync = true;
      results.push(r);
    }
    if (hasAsync) return Promise.all(results);
    return results;
  }
  pickBody(task) {
    if (this.bodies.length === 0) return null;
    if (this.strategy) { const s = this.strategy(task, this.bodies); if (s) return s; }
    // 默认分派：能力需求优先 → 认领 → 轮询兜底
    let pool = this.bodies.filter(b => b.hasNeed(task));
    if (pool.length === 0) pool = this.bodies.filter(b => b.canHandle(task) === true);
    if (pool.length === 0) pool = this.bodies;
    return pool[this._rr++ % pool.length];
  }
  merge(results) {
    // 合并：不丢任何一笔失败，成功聚合
    const errors = [];
    const datas = [];
    let okCount = 0;
    for (const r of results) {
      if (r.ok) { okCount++; if (r.data) datas.push(r.data); }
      else if (r.partial) errors.push(...r.errors);
      else errors.push(r.error);
    }
    const ol = results.length;
    if (ol > 0 && okCount === ol) return new ProcessSuccess(datas[datas.length - 1]);
    if (okCount > 0) return new ProcessPartial(datas[datas.length - 1] || null, errors, okCount / ol);
    return new ProcessFailure(`全部失败：${errors.join("; ")}`, false);
  }
}
SubProcess.prototype._rr = 0;

// ── 第二层：指挥官——只调度：拆任务、选子进程、收报告 ──
class Commander {
  constructor(id, tag, subProcesses = []) {
    this.id = id;
    this.tag = tag;
    this.subProcesses = subProcesses; // SubProcess[]
    this.watches = [];                // WatchProcess[] 旁路
    this._alerts = [];                // 观察异常汇总
  }
  attachWatch(target, style) {
    const w = new WatchProcess(new ProcessId(this.id, "watch", this.watches.length), target, style);
    this.watches.push(w);
    return w;
  }
  // 侦查旁路喂观察信号——不拦截结果，只看
  notifyWatches(step) {
    for (const w of this.watches) {
      const r = w.observe(step);
      if (r) this._alerts.push(...r.anomalies);
    }
  }
  _alerts = [];
  async dispatch(order) {
    // 拆任务：骨架版——order 要么是列表要么单任务
    const tasks = Array.isArray(order) ? order : [order];
    // 分派给第一个子进程（多子进程负载均衡是扩展点）
    const sub = this.subProcesses[0];
    if (!sub) return [];
    this.notifyWatches({ action: "dispatch_start", abnormal: false, bodyId: sub.id.subProcessId });
    const results = await sub.delegate(tasks);
    this.notifyWatches({ action: "execute_done", abnormal: results.some(r => r.partial || (!r.ok && !r.recoverable)), bodyId: sub.id.subProcessId });
    return results;
  }
  collectAndReport(results) {
    const report = {
      commanderId: this.id,
      tag: this.tag,
      summary: this.buildSummary(results),
      results,
      completedCount: results.filter(r => r.ok).length,
      totalCount: results.length,
      watchReports: this.watches.map(w => w.finalReport()),
    };
    return report;
  }
  buildSummary(results) {
    if (results.length === 0) return "∅";
    const ok = results.filter(r => r.ok).length;
    const partial = results.filter(r => r.partial).length;
    return ok === results.length ? `✓${ok}` : partial > 0 ? `◐${ok}/${results.length}` : `✖${results.length - ok}`;
  }
}

// ── 第一层：主进程——只下命令，绝不自己执行 ──
class MainProcess {
  constructor() {
    this.commanders = new Map(); // tag -> Commander
    this.ledger = [];            // 任务五段账本
    this.seq = 0;
  }
  registerCommander(commander) {
    this.commanders.set(commander.tag, commander);
  }
  async command(order, target, payload = {}) {
    const cmd = this.commanders.get(target);
    this.seq++;
    this.ledger.push({ seq: this.seq, stage: "birth", where: `main→${target}`, value: String(order).slice(0, 40) });
    if (!cmd) {
      this.ledger.push({ seq: this.seq, stage: "destroy", where: target, value: "没有该领域指挥官" });
      return new ProcessFailure(`没有领域 ${target} 的指挥官`, false);
    }
    this.ledger.push({ seq: this.seq, stage: "transit", where: `main→${target}`, value: "派发" });
    const results = await cmd.dispatch(order);
    this.ledger.push({ seq: this.seq, stage: "consume", where: target, value: `${results.length} 个结果` });
    const report = cmd.collectAndReport(results);
    this.ledger.push({ seq: this.seq, stage: "report", where: target, value: report.summary });
    this.ledger.push({ seq: this.seq, stage: "destroy", where: target, value: "任务回收" });
    return report;
  }
}

// ── 组树工厂：一条链造出 主→指挥→子→体 + 侦查旁路 ──
// executors 元素三种形状：[fn] 或 [fn, declare] 或 { $group:"组名", ...覆盖项 }
// $group = 分组实例——写一遍组标准，全组复刻，身份仍各自唯一
function buildTree(tag, executors, strategy = null) {
  const cmdId = `cmd-${tag}`;
  const subId = new ProcessId(cmdId, `sub-${tag}`, "");
  const bodies = (Array.isArray(executors) ? executors : [executors]).map((entry, i) => {
    const bid = new ProcessId(cmdId, subId.subProcessId, `body-${i}`);
    if (entry && typeof entry === "object" && !Array.isArray(entry) && entry.$group) {
      const { $group, ...overrides } = entry;
      const inst = instantiateGroup($group, bid, overrides);
      if (!inst) throw new Error(`未注册的分组：${$group}`);
      return inst;
    }
    const [fn, declare] = Array.isArray(entry) ? entry : [entry, null];
    return new ProcessBody(bid, fn, declare);
  });
  const sub = new SubProcess(subId, tag, bodies, strategy);
  const cmd = new Commander(cmdId, tag, [sub]);
  // 侦查旁路：哨兵守门 + 标准全程——挂在指挥下，只看不动
  cmd.attachWatch(sub.id.subProcessId, "sentinel");
  cmd.attachWatch(sub.id.subProcessId, "standard");
  const main = new MainProcess();
  main.registerCommander(cmd);
  return { main, commander: cmd };
}

module.exports = {
  ProcessId, ProcessData, ProcessSuccess, ProcessPartial, ProcessFailure,
  WatchProcess, ProcessBody, SubProcess, Commander, MainProcess, buildTree,
  defineGroup, instantiateGroup, GroupRegistry,
};