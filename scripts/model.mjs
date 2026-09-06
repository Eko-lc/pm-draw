import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const sha = value => createHash('sha256').update(value).digest('hex');
export const stable = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
export const screens = m => m.groups.flatMap(g => g.screens);
export const live = m => ['url', 'runtime'].includes(m.target.kind);
export const assert = (ok, message) => { if (!ok) throw new Error(message); };

// PRD 文首状态行约定：「状态：草稿 ｜ 待决策 ｜ 已审查通过（日期）」（可写在 > 引用块中）。
// 只有「已审查通过」是定稿；未标记按未知处理，只提示不阻断，保持流程灵活。
export function prdStatus(prdText) {
  const hints = {
    pending: 'PRD 仍有待决策问题：本方案用于辅助讨论与决策，PRD 定稿（文首标记「状态：已审查通过」）后再作为评审依据。',
    draft: 'PRD 仍是草稿，尚未审查通过：本方案仅供讨论，不作为评审依据。',
    unknown: 'PRD 未标记审查状态：按约定在 PRD 文首写「状态：已审查通过（日期）」后本提示消失。',
  };
  const match = prdText.split('\n').slice(0, 40).join('\n').match(/状态\s*[：:]\s*(已审查通过|待决策|草稿)/);
  if (!match) return { key: 'unknown', label: '未标记', hint: hints.unknown };
  const key = { 已审查通过: 'approved', 待决策: 'pending', 草稿: 'draft' }[match[1]];
  return { key, label: match[1], hint: hints[key] || '' };
}
const string = (v, label) => assert(typeof v === 'string' && v.trim(), `${label} 必须是非空字符串（不明确请写「待确认」）`);
const array = (v, label) => assert(Array.isArray(v), `${label} 必须是数组`);
const id = (v, label) => assert(typeof v === 'string' && /^[a-z][a-z0-9-]*$/.test(v), `${label} 必须是小写字母开头的 kebab-case 编号`);
export const httpURL = value => { const u = new URL(value); assert(['http:', 'https:'].includes(u.protocol), '产品地址只支持 HTTP(S)'); return u; };
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value));

export async function loadManifest(file) {
  const absolute = path.resolve(file);
  const m = JSON.parse(await fs.readFile(absolute, 'utf8'));
  assert(m.prd && typeof m.prd.path === 'string', '缺少 prd.path');
  const prdText = await fs.readFile(path.resolve(path.dirname(absolute), m.prd.path), 'utf8');
  validate(m, prdText);
  return { m, dir: path.dirname(absolute), file: absolute, prdText, prdHash: sha(prdText) };
}

export function validate(m, prdText) {
  assert(m.schemaVersion === 1, '不支持的 schemaVersion');
  id(m.project?.id, 'project.id'); string(m.project?.title, 'project.title');
  assert(Number.isSafeInteger(m.round) && m.round > 0, 'round 必须是正整数');
  assert(['prototype', 'review'].includes(m.mode), 'mode 必须是 prototype 或 review');
  assert(['none', 'manual', 'url', 'runtime'].includes(m.target?.kind), 'target.kind 无效');
  assert(m.mode !== 'prototype' || m.target.kind === 'none', '有真实页面时请选择 review 模式，先生成走查计划');
  assert(m.mode !== 'review' || m.target.kind !== 'none', 'review 需要 manual、url 或 runtime 目标');
  if (live(m)) httpURL(m.target.url);
  array(m.requirements, 'requirements'); assert(m.requirements.length, '至少提取一条 PRD 需求');
  const reqIds = new Set();
  for (const r of m.requirements) {
    validateRequirementFragment(r, prdText); assert(!reqIds.has(r.id), `需求编号重复：${r.id}`); reqIds.add(r.id);
  }
  const requirement = (v, label) => assert(reqIds.has(v) || v === '待确认', `${label} 必须引用需求编号或「待确认」`);
  array(m.groups, 'groups'); assert(m.groups.length, '至少需要一个流程分组');
  const groupIds = new Set(), screenIds = new Set(), covered = new Set();
  for (const g of m.groups) {
    id(g.id, 'group.id'); assert(!groupIds.has(g.id), `流程编号重复：${g.id}`); groupIds.add(g.id);
    string(g.title, `${g.id}.title`); array(g.screens, `${g.id}.screens`); assert(g.screens.length, '流程分组不能没有页面');
    for (const s of g.screens) for (const r of validateScreen(s, { requirement, screenIds, mode: m.mode })) covered.add(r);
  }
  for (const s of screens(m)) for (const a of s.actions) assert(a.to === null || a.to === '待确认' || screenIds.has(a.to), `${s.id} 跳转目标不存在：${a.to}`);
  for (const s of screens(m)) for (const t of s.transitions || []) assert(t.to === '待确认' || screenIds.has(t.to), `${s.id} 自动流转目标不存在：${t.to}`);
  for (const r of reqIds) assert(covered.has(r), `需求 ${r} 没有对应页面状态；请补齐或明确待确认`);
  if (m.history !== undefined) { array(m.history, 'history'); m.history.forEach(h => validateReport(h, m.project.id, m.round)); }
}

// 单条 PRD 需求的结构与原文校验；add-requirements 与 validate 共用同一套规则。
export function validateRequirementFragment(r, prdText) {
  id(r.id, 'requirement.id');
  string(r.text, `${r.id}.text`); string(r.quote, `${r.id}.quote`);
  if (prdText !== undefined) assert(prdText.includes(r.quote), `PRD 中找不到需求 ${r.id} 的原文 quote`);
}

// 单个页面状态的结构校验，返回本屏覆盖的需求编号。validate 与 add-group 共用同一套规则。
// ctx = { requirement, screenIds, mode }；screenIds 用于查重并会被本屏占用。
export function validateScreen(s, ctx) {
  const { requirement, screenIds, mode } = ctx;
  id(s.id, 'screen.id'); assert(!screenIds.has(s.id), `页面状态编号重复：${s.id}`); screenIds.add(s.id);
  for (const key of ['page', 'state']) string(s[key], `${s.id}.${key}`);
  array(s.requirements, `${s.id}.requirements`); assert(s.requirements.length, `${s.id} 需要 PRD 来源`);
  const covered = new Set();
  s.requirements.forEach(r => { requirement(r, s.id); covered.add(r); });
  array(s.reproduce, `${s.id}.reproduce`); assert(s.reproduce.length, `${s.id} 需要复现方式`); s.reproduce.forEach(v => string(v, '复现步骤'));
  array(s.pending, `${s.id}.pending`); s.pending.forEach(v => string(v, '待确认项'));
  if (s.summary !== undefined) string(s.summary, `${s.id}.summary`);
  if (s.layout !== undefined) { array(s.layout, `${s.id}.layout`); s.layout.forEach(v => string(v, '布局说明')); }
  if (s.logic !== undefined) { array(s.logic, `${s.id}.logic`); s.logic.forEach(v => string(v, '逻辑规则')); }
  array(s.actions, `${s.id}.actions`); const actionIds = new Set();
  if (s.transitions) { array(s.transitions, 'transitions'); for (const t of s.transitions) { string(t.condition, '自动流转条件'); string(t.to, '自动流转目标'); requirement(t.requirement, '自动流转来源'); } }
  for (const a of s.actions) {
    id(a.id, 'action.id'); assert(!actionIds.has(a.id), `操作编号重复：${s.id}/${a.id}`); actionIds.add(a.id);
    string(a.label, '操作文案'); string(a.outcome, '操作结果'); requirement(a.requirement, '操作来源');
    assert(a.to === null || a.to === '待确认' || typeof a.to === 'string', '操作跳转需要 screen id、null（流程终点）或「待确认」');
    if (a.role !== undefined) assert(['primary', 'secondary'].includes(a.role), '操作 role 只能是 primary / secondary');
  }
  assert(s.actions.filter(a => a.role === 'primary').length <= 1, `${s.id} 每屏最多一个主操作（role: primary），其余用 secondary 或不标`);
  array(s.blocks, `${s.id}.blocks`); assert(s.blocks.length, `${s.id} 缺少低保真原型`);
  const blockIds = new Set(), drawnActions = new Set();
  function blocks(items) {
    for (const b of items) {
      id(b.id, 'block.id'); assert(!blockIds.has(b.id), `组件编号重复：${s.id}/${b.id}`); blockIds.add(b.id);
      requirement(b.requirement, `组件 ${b.id} 来源`);
      if (b.align !== undefined) assert(['left', 'center', 'right'].includes(b.align), '组件 align 只能是 left / center / right');
      if (b.weight !== undefined) assert(Number.isInteger(b.weight) && b.weight >= 1 && b.weight <= 4, '列 weight 只能是 1–4 的整数');
      if (b.level !== undefined) assert(b.type === 'heading' && Number.isInteger(b.level) && b.level >= 1 && b.level <= 3, 'level 只用于 heading，取 1–3 的整数（1 页面主标题 / 2 区块标题 / 3 小节标题）');
      assert(['heading', 'text', 'field', 'image', 'list', 'table', 'notice', 'section', 'columns', 'action'].includes(b.type), `不支持的线框组件：${b.type}`);
      if (['section', 'columns'].includes(b.type)) { array(b.children, 'children'); blocks(b.children); }
      else if (b.type === 'action') { assert(actionIds.has(b.action), `组件引用了不存在的操作：${b.action}`); drawnActions.add(b.action); }
      else if (b.type === 'list') { array(b.items, 'items'); b.items.forEach(v => string(v, '列表文案')); }
      else if (b.type === 'table') { array(b.columns, 'columns'); array(b.rows, 'rows'); b.columns.forEach(v => string(v, '表头')); b.rows.forEach(row => { array(row, 'row'); assert(row.length === b.columns.length, '表格列数不一致'); row.forEach(v => string(v, '表格单元格')); }); }
      else string(b.text, `组件 ${b.id}.text`);
      if (b.value !== undefined) assert(typeof b.value === 'string', 'field.value 必须是字符串');
      if (b.note !== undefined) string(b.note, `组件 ${b.id}.note`);
    }
  }
  blocks(s.blocks);
  assert([...actionIds].every(a => drawnActions.has(a)), `${s.id} 的每个操作都必须在原型中用 action 组件标出位置`);
  if (s.annotations !== undefined) array(s.annotations, 'annotations');
  for (const a of s.annotations || []) {
    assert(blockIds.has(a.component), `标注组件不存在：${a.component}`); requirement(a.requirement, '标注来源');
    string(a.original, '原逻辑'); string(a.change, '修改点');
    if (a.rect) { assert(Array.isArray(a.rect) && a.rect.length === 4 && a.rect.every(n => Number.isFinite(n) && n >= 0 && n <= 100), '截图标注 rect 应为四个 0–100 的百分比'); assert(a.rect[2] > 0 && a.rect[3] > 0 && a.rect[0] + a.rect[2] <= 100 && a.rect[1] + a.rect[3] <= 100, '截图标注超出画面'); }
    for (const k of ['pin', 'arrow']) if (a[k]) assert(Array.isArray(a[k]) && a[k].length === 2 && a[k].every(n => Number.isFinite(n) && n >= 0 && n <= 100), `截图标注 ${k} 应为两个 0–100 的百分比坐标`);
    if (a.arrow) assert(a.rect || a.pin, '箭头需要从 rect 或 pin 出发，指向 arrow 坐标');
  }
  if (s.url) httpURL(s.url);
  if (s.screenshot) {
    assert(mode === 'review', 'prototype 模式不能包含真实截图');
    string(s.screenshot.path, '截图路径'); string(s.screenshot.actualState, '截图实际状态');
    assert(['manual', 'browser-tool', 'web-access', 'cdp'].includes(s.screenshot.source), '截图来源无效');
    assert(date(s.screenshot.capturedAt), '截图时间无效');
    assert(/^[a-f0-9]{64}$/.test(s.screenshot.sha256), '截图缺少 sha256');
  }
  if (s.capture) {
    assert(s.capture.expectText || s.capture.expectSelector, 'capture 需要 expectText 或 expectSelector 验证实际状态');
    for (const k of ['expectText', 'expectSelector']) if (s.capture[k]) string(s.capture[k], k);
  }
  return covered;
}

// 增量添加单个流程分组的结构校验：结构与需求引用；不做跨组页面跳转与覆盖检查（由 validate 全局负责）。
// takenGroupIds / takenScreenIds 为已存在编号，用于检测重复；本组页面编号会被占用（加入 takenScreenIds）。
export function validateGroupFragment(g, reqIds, takenGroupIds, takenScreenIds, mode) {
  id(g.id, 'group.id'); assert(!takenGroupIds.has(g.id), `流程编号重复：${g.id}`);
  string(g.title, `${g.id}.title`); array(g.screens, `${g.id}.screens`); assert(g.screens.length, '流程分组不能没有页面');
  const requirement = (v, label) => assert(reqIds.has(v) || v === '待确认', `${label} 必须引用需求编号或「待确认」`);
  const ctx = { requirement, screenIds: takenScreenIds, mode };
  for (const s of g.screens) validateScreen(s, ctx);
}

// 审批绑定 PRD 内容和所有计划语义；产物、反馈、历史不改变本轮截图范围。
export function planHash(m, prdHash) {
  const omit = new Set(['approval', 'history', 'baseline', 'screenshot', 'blockedReason', 'changeSummary']);
  function clean(v) { return Array.isArray(v) ? v.map(clean) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => !omit.has(k)).map(([k, value]) => [k, clean(value)])) : v; }
  return sha(stable({ manifest: clean(m), prdHash }));
}
export function requireApproval(m, prdHash, screenId) {
  if (!live(m)) return;
  assert(m.approval?.planHash === planHash(m, prdHash) && date(m.approval.confirmedAt) && typeof m.approval.quote === 'string' && m.approval.quote.trim(), '走查计划未经用户确认或已变更。先运行 plan，展示流程、页面、状态，收到确认原话后再 approve。');
  if (screenId && m.approval.screenIds) assert(m.approval.screenIds.includes(screenId), `页面 ${screenId} 不在本次已确认的截图范围内`);
}

export function screenHash(s, groupId, requirements = []) {
  const { screenshot, blockedReason, changeSummary, ...rest } = s;
  return sha(stable({ ...rest, groupId, requirementDefinitions: requirements.filter(r => s.requirements.includes(r.id)), screenshot: screenshot?.sha256 || null }));
}
export function feedbackFingerprint(m, prdHash) { return sha(stable({ project: m.project, round: m.round, prdHash, groups: m.groups, requirements: m.requirements, history: m.history || [] })); }
export function validateReport(r, projectId, beforeRound = Infinity) {
  assert(r?.schemaVersion === 1 && r.kind === 'pm-draw-feedback', '不是 pm-draw 反馈 JSON');
  assert(r.projectId === projectId, '反馈来自其他项目');
  assert(Number.isSafeInteger(r.round) && r.round > 0 && r.round < beforeRound, '反馈轮次无效');
  string(r.fingerprint, '反馈 fingerprint');
  array(r.screens, '反馈 screens'); array(r.groups, '反馈 groups');
  for (const s of r.screens) { id(s.id, '反馈页面编号'); string(s.page, '反馈页面'); string(s.state, '反馈状态'); string(s.contentHash, '反馈 contentHash'); assert(['', '符合预期', '需要调整', '严重问题'].includes(s.mark), '反馈标记无效'); assert(typeof s.problem === 'string' && typeof s.suggestion === 'string', '反馈问题和建议必须保留字符串原文'); }
  for (const g of r.groups) { id(g.id, '反馈流程编号'); assert(typeof g.problem === 'string' && typeof g.suggestion === 'string', '流程反馈必须保留字符串原文'); }
}

export async function readImage(file) {
  const bytes = await fs.readFile(file);
  const png = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp = bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  assert(png || jpeg || webp, '只接受 PNG、JPEG、WebP 实际图片文件');
  return { bytes, mime: png ? 'image/png' : jpeg ? 'image/jpeg' : 'image/webp', extension: png ? 'png' : jpeg ? 'jpg' : 'webp', hash: sha(bytes) };
}
export async function saveJSON(file, value, exclusive = false) {
  await fs.mkdir(path.dirname(path.resolve(file)), { recursive: true });
  if (exclusive) return fs.writeFile(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value, null, 2) + '\n');
  await fs.rename(temporary, file);
}
