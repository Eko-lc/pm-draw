#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadManifest, loadRaw, screens, live, assert, sha, planHash, requireApproval, saveJSON, saveManifest, readImage, validateReport, feedbackFingerprint, screenHash, prdStatus, validateGroupFragment, validateRequirementFragment } from './model.mjs';
import { render } from './render.mjs';
import { extractPrdDiagrams } from './diagrams.mjs';
import { connectBrowser, inspectTarget } from './browser.mjs';

const usage = `pm-draw · Node.js 22+，无 npm 运行依赖
  init <flow.json> --prd <PRD.md> --project <id> --title <名称> [--mode prototype|review] [--kind none|manual|url|runtime] [--url <地址>]
  add-requirements <flow.json> --file <需求数组.json>      增量追加 PRD 需求（校验原文引用）
  add-group <flow.json> --file <流程分组.json>             增量追加一个流程分组（写入 groups/<id>.json，flow.json 只留索引）
  split <flow.json>                                       把内联分组拆分为 groups/<id>.json 独立文件，便于按组局部修改
  validate <flow.json>
  plan <flow.json> --out <plan.md>                    只读 PRD / 清单，不连接浏览器
  approve <flow.json> --hash <计划摘要> --quote <用户确认原话> [--screens <逗号分隔的已确认页面编号>]
  build <flow.json> --out <输出目录>                     生成 index.html 总索引 + 每个流程分组一个子页面
  view <网页目录或HTML>                                  用专用 CDP Chrome 打开反馈页面
  import-shot <flow.json> --screen <id> --file <image> --observed <实际状态>
  open <flow.json> --screen <id> [--proxy http://127.0.0.1:3456 | --browser chrome | --cdp http://127.0.0.1:9223]
  inspect <flow.json> --screen <id> --target <targetId> [浏览器选项]
  act <flow.json> --screen <id> --target <targetId> --action <click|fill> --selector <已观察选择器> [--value <内容>] [浏览器选项]
  capture <flow.json> --screen <id> --target <targetId> --observed <实际状态> [浏览器选项]
  next-round <flow.json> --feedback <feedback.json> --out <next-flow.json>
大 PRD 用 init → add-requirements → 多次 add-group 分块组装（每组一个独立文件），最后 validate 做全局校验（覆盖 / 跳转）。
修改某组功能时只需读写对应 groups/<id>.json 与 flow.json 索引，不必加载整个清单。
approve 仅用于收到用户确认后记录证据。不能由 Agent 自己模拟用户确认。`;

function args(argv) {
  const [command, file, ...rest] = argv, options = {};
  for (let i = 0; i < rest.length; i += 2) {
    assert(rest[i].startsWith('--') && rest[i + 1] !== undefined && !rest[i + 1].startsWith('--'), `参数格式错误：${rest[i]}`);
    const key = rest[i].slice(2); assert(!Object.hasOwn(options, key), `重复参数：${key}`); options[key] = rest[i + 1];
  }
  return { command, file, options };
}
function required(options, key) { assert(options[key]?.trim(), `缺少 --${key}`); return options[key]; }
async function writeText(file, content) { await fs.mkdir(path.dirname(path.resolve(file)), { recursive: true }); await fs.writeFile(file, content); }
async function exists(file) { try { await fs.access(file); return true; } catch { return false; } }
// 增量命令只解析 JSON 与读取 PRD，不跑全量 validate（中间态允许需求暂未覆盖、跳转暂未闭合）。
async function loadLoose(file) {
  const { m, dir, file: absolute, groupFiles } = await loadRaw(file);
  assert(m.prd && typeof m.prd.path === 'string', '缺少 prd.path');
  const prdText = await fs.readFile(path.resolve(dir, m.prd.path), 'utf8');
  m.requirements ||= [];
  return { m, dir, file: absolute, prdText, groupFiles };
}
function renderPlan({ m, prdHash }) {
  const lines = [`# ${m.project.title} · 第 ${m.round} 轮走查计划`, '', `目标：${m.target.kind}${m.target.url ? ' · ' + m.target.url : ''}`, `PRD SHA256：${prdHash}`, `计划 SHA256：${planHash(m, prdHash)}`, '', '请确认以下流程、页面状态及复现步骤。确认前不运行产品、不连接浏览器、不截图。', ''];
  for (const g of m.groups) {
    lines.push(`## ${g.title}`, '', g.description || '', '');
    for (const [i, s] of g.screens.entries()) {
      lines.push(`### ${i + 1}. ${s.page} · ${s.state} (${s.id})`, '', ...(s.summary ? [`页面说明：${s.summary}`, ''] : []), `PRD 来源：${s.requirements.join('、')}`, `执行条件：${s.captureMode || '按复现方式执行'}`,  `页面地址：${s.url || m.target.url || '手动截图 / 无实际页面'}`, '', '**复现方式**', ...s.reproduce.map((x, j) => `${j + 1}. ${x}`), '', '**操作与跳转**', ...s.actions.map(a => `- ${a.label} → ${a.to || '流程终点 / 当前状态'}：${a.outcome}`), '', '**自动状态流转**', ...(s.transitions || []).map(t => `- ${t.condition} → ${t.to}`), '', '**状态验证**', s.capture ? JSON.stringify(s.capture, null, 2) : '手动核对实际状态；自动截图前需在清单中补充 capture 验证条件。', '', '**待确认**', ...(s.pending.length ? s.pending.map(p => `- ${p}`) : ['- 无']), '');
    }
  }
  lines.push('## PRD 覆盖清单', '', ...m.requirements.map(r => `- ${r.id}：${r.text}\n  原文：${r.quote}`), '', '计划 SHA256 用于绑定本次确认；修改 PRD、页面、状态、操作或验证条件后需重新确认。', '');
  return lines.join('\n');
}

async function attachImage(context, s, file, observed, source, info = {}) {
  assert(observed?.trim(), '需要记录截图实际状态 --observed');
  const image = await readImage(file);
  const folder = path.join(context.dir, 'screenshots', `round-${context.m.round}`);
  await fs.mkdir(folder, { recursive: true });
  const dest = path.join(folder, `${s.id}-${image.hash.slice(0, 12)}.${image.extension}`);
  await fs.writeFile(dest, image.bytes);
  s.screenshot = { path: path.relative(context.dir, dest), sha256: image.hash, source, capturedAt: new Date().toISOString(), actualState: observed, ...info };
  delete s.blockedReason;
  await saveManifest(context.file, context.m, context.groupFiles);
  return dest;
}

export async function main(argv = process.argv.slice(2)) {
  if (!argv.length || ['--help', 'help'].includes(argv[0])) return console.log(usage);
  const { command, file, options } = args(argv);
  const allowed = {
    init: ['prd', 'project', 'title', 'mode', 'kind', 'url'], 'add-requirements': ['file'], 'add-group': ['file'], split: [],
    validate: [], plan: ['out'], approve: ['hash', 'quote', 'screens'], build: ['out'],
    view: [],
    'import-shot': ['screen', 'file', 'observed', 'source'], 'next-round': ['feedback', 'out'],
    open: ['screen', 'browser', 'proxy', 'cdp'], inspect: ['screen', 'target', 'browser', 'proxy', 'cdp'],
    act: ['screen', 'target', 'action', 'selector', 'value', 'browser', 'proxy', 'cdp'],
    capture: ['screen', 'target', 'observed', 'browser', 'proxy', 'cdp'],
  };
  assert(allowed[command], `未知命令：${command}\n${usage}`);
  assert(file, '需要 flow.json 路径');
  for (const key of Object.keys(options)) assert(allowed[command].includes(key), `未知参数：--${key}`);
  if (command === 'view') {
    const absolute = path.resolve(file), stat = await fs.stat(absolute);
    const page = stat.isDirectory() ? path.join(absolute, 'index.html') : absolute;
    assert(path.extname(page).toLowerCase() === '.html' && await exists(page), 'view 需要包含 index.html 的网页目录或 HTML 文件');
    const browser = await connectBrowser();
    try { console.log(JSON.stringify({ targetId: await browser.open(pathToFileURL(page).href), page })); }
    finally { await browser.dispose(); }
    return;
  }
  if (command === 'init') {
    const absolute = path.resolve(file);
    assert(!(await exists(absolute)), `流程清单已存在：${file}；如需重建请先删除或改路径`);
    const mode = options.mode || 'prototype', kind = options.kind || 'none';
    assert(['prototype', 'review'].includes(mode), 'mode 必须是 prototype 或 review');
    assert(['none', 'manual', 'url', 'runtime'].includes(kind), 'target.kind 无效');
    assert(mode !== 'prototype' || kind === 'none', '原型使用 target.kind: none；竞品与旧页面截图放入 references');
    assert(mode !== 'review' || kind !== 'none', 'review 需要 manual、url 或 runtime 目标');
    const project = required(options, 'project');
    assert(/^[a-z][a-z0-9-]*$/.test(project), '--project 必须是小写字母开头的 kebab-case 编号');
    const prd = required(options, 'prd');
    assert(await exists(path.resolve(path.dirname(absolute), prd)), `找不到 PRD 文件：${prd}`);
    const target = { kind }; if (options.url) target.url = options.url;
    const m = { schemaVersion: 1, project: { id: project, title: required(options, 'title') }, round: 1, mode, prd: { path: prd }, target, requirements: [], groups: [] };
    await saveJSON(absolute, m, true);
    console.log(`已创建骨架：${absolute}\n下一步：add-requirements 加入 PRD 需求，再逐个 add-group 加入流程分组，最后 validate。`); return;
  }
  if (command === 'add-requirements') {
    const { m, prdText, groupFiles } = await loadLoose(file);
    const frag = JSON.parse(await fs.readFile(required(options, 'file'), 'utf8'));
    assert(Array.isArray(frag) && frag.length, '--file 应为需求对象数组（{id,text,quote}）');
    const reqIds = new Set(m.requirements.map(r => r.id));
    for (const r of frag) {
      assert(!reqIds.has(r.id), `需求编号重复：${r.id}`);
      validateRequirementFragment(r, prdText);
      reqIds.add(r.id); m.requirements.push(r);
    }
    await saveManifest(path.resolve(file), m, groupFiles);
    console.log(`已加入 ${frag.length} 条需求（共 ${m.requirements.length} 条）`); return;
  }
  if (command === 'add-group') {
    const { m, groupFiles, prdText } = await loadLoose(file);
    const g = JSON.parse(await fs.readFile(required(options, 'file'), 'utf8'));
    const reqIds = new Set(m.requirements.map(r => r.id));
    const takenGroupIds = new Set(m.groups.map(x => x.id)), takenScreenIds = new Set(screens(m).map(s => s.id));
    validateGroupFragment(g, reqIds, takenGroupIds, takenScreenIds, m.mode, prdText);
    groupFiles.set(g.id, `groups/${g.id}.json`);
    m.groups.push(g);
    await saveManifest(path.resolve(file), m, groupFiles);
    console.log(`已加入流程分组 ${g.id}（groups/${g.id}.json；共 ${m.groups.length} 组 / ${screens(m).length} 屏）`); return;
  }
  if (command === 'split') {
    const { m, groupFiles } = await loadLoose(file);
    assert(m.groups.length, '清单还没有流程分组');
    const seen = new Set(); let converted = 0;
    for (const g of m.groups) {
      assert(g.id && typeof g.id === 'string', '分组缺少编号，无法拆分');
      assert(!seen.has(g.id), `流程编号重复：${g.id}`); seen.add(g.id);
      if (groupFiles.has(g.id)) continue;
      groupFiles.set(g.id, `groups/${g.id}.json`); converted++;
    }
    assert(converted, '所有分组已是独立文件，无需拆分');
    await saveManifest(path.resolve(file), m, groupFiles);
    console.log(`已拆分 ${converted} 个分组到 groups/ 目录，flow.json 只保留索引；后续修改某组只需读写对应文件。`); return;
  }
  const context = await loadManifest(file), { m, dir, prdHash } = context;
  if (command === 'validate') {
    const status = prdStatus(context.prdText);
    console.log(`有效：${m.groups.length} 个流程 / ${screens(m).length} 个状态 / ${m.requirements.length} 条 PRD 需求 · PRD 状态：${status.label}`);
    if (status.hint) console.log(`提醒：${status.hint}`);
    return;
  }
  if (command === 'plan') { const text = renderPlan(context); if (options.out) await writeText(options.out, text); console.log(text); return; }
  if (command === 'approve') {
    assert(live(m), '仅产品地址 / 运行环境需要截图前确认');
    assert(required(options, 'hash') === planHash(m, prdHash), '确认摘要与当前计划不一致，请重新生成并展示计划');
    m.approval = { planHash: options.hash, quote: required(options, 'quote'), confirmedAt: new Date().toISOString() };
    if (options.screens) { const ids = options.screens.split(',').map(s => s.trim()); assert(ids.length && ids.every(id => screens(m).some(s => s.id === id)), '确认范围包含不存在的页面编号'); m.approval.screenIds = [...new Set(ids)]; }
    await saveManifest(context.file, m, context.groupFiles); console.log('已记录本轮计划确认'); return;
  }
  if (command === 'build') {
    const out = path.resolve(required(options, 'out'));
    assert(out !== context.file, '不能覆盖流程清单');
    const pages = await render(context);
    await fs.mkdir(out, { recursive: true });
    for (const [name, html] of Object.entries(pages)) await fs.writeFile(path.join(out, name), html);
    const stale = (await fs.readdir(out)).filter(f => f.endsWith('.html') && !Object.hasOwn(pages, f));
    if (stale.length) console.log(`提醒：目录中存在非本次生成的 HTML：${stale.join('、')}；如为旧分组页面请手动删除。`);
    console.log(path.join(out, 'index.html')); return;
  }
  if (command === 'next-round') {
    const report = JSON.parse(await fs.readFile(required(options, 'feedback'), 'utf8'));
    validateReport(report, m.project.id);
    assert(report.round === m.round && report.fingerprint === feedbackFingerprint(m, prdHash), '反馈与当前清单版本不一致。请先从对应 HTML 导出反馈并创建下一轮，再修改清单。');
    const expected = screens(m);
    const prdDiagrams = extractPrdDiagrams(context.prdText);
    assert(report.screens.length === expected.length && new Set(report.screens.map(s => s.id)).size === expected.length && expected.every(s => report.screens.some(r => r.id === s.id && r.page === s.page && r.state === s.state && r.contentHash === screenHash(s, m.groups.find(g => g.screens.includes(s)).id, m.requirements, prdDiagrams))), '反馈页面清单或内容摘要不完整');
    assert(report.groups.length === m.groups.length && new Set(report.groups.map(g => g.id)).size === m.groups.length && m.groups.every(g => report.groups.some(r => r.id === g.id)), '流程反馈不完整');
    const out = path.resolve(required(options, 'out'));
    const { history: ignoredHistory, ...snapshot } = report;
    m.history = [...(m.history || []), snapshot];
    m.baseline = Object.fromEntries(report.screens.map(s => [s.id, s.contentHash]));
    m.round++; delete m.approval;
    m.prd.path = path.relative(path.dirname(out), path.resolve(dir, m.prd.path));
    for (const r of m.references || []) r.image.path = path.relative(path.dirname(out), path.resolve(dir, r.image.path));
    for (const s of screens(m)) { delete s.screenshot; delete s.blockedReason; delete s.changeSummary; }
    await saveManifest(out, m, context.groupFiles, true); console.log(out); return;
  }
  assert(m.mode === 'review', '截图与浏览器操作仅用于 review 模式');
  requireApproval(m, prdHash); // 在读取截图或连接任何浏览器之前检查。
  const s = screens(m).find(x => x.id === required(options, 'screen')); assert(s, '找不到指定页面状态');
  requireApproval(m, prdHash, s.id);
  if (command === 'import-shot') { const source = options.source || 'manual'; assert(['manual', 'browser-tool'].includes(source), 'import-shot 的 source 只能是 manual / browser-tool'); console.log(await attachImage(context, s, required(options, 'file'), required(options, 'observed'), source)); return; }
  assert(live(m), '浏览器操作需要 url 或 runtime 目标');
  assert(['browser', 'proxy', 'cdp'].filter(k => options[k]).length <= 1, '一次只选择一种浏览器连接方式');
  if (command === 'capture') { required(options, 'observed'); assert(s.capture, '自动截图需要计划内的 capture.expectText 或 expectSelector 验证实际状态；补充后重新确认计划'); }
  const browser = await connectBrowser(options);
  try {
    if (command === 'open') { console.log(JSON.stringify({ targetId: await browser.open(s.url || m.target.url), note: '已打开产品，请实际执行已确认流程并 inspect 核对状态后再 capture。' })); return; }
    const target = required(options, 'target');
    const info = await inspectTarget(browser, target, s, m);
    if (command === 'inspect') { console.log(JSON.stringify({ ...info, text: info.text.slice(0, 16000) }, null, 2)); return; }
    if (command === 'act') {
      const action = required(options, 'action'), selector = required(options, 'selector');
      assert(['click', 'fill'].includes(action), 'action 仅支持 click / fill');
      if (action === 'fill') required(options, 'value');
      const result = await browser.evaluate(target, `(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element || !element.getClientRects().length || element.disabled) throw new Error('目标控件不存在、不可见或已禁用');
        if (${JSON.stringify(action)} === 'click') element.click();
        else {
          const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, ${JSON.stringify(options.value || '')});
          element.dispatchEvent(new Event('input', {bubbles: true})); element.dispatchEvent(new Event('change', {bubbles: true}));
        }
        return {ok: true};
      })()`);
      console.log(JSON.stringify(result)); return;
    }
    assert(!s.capture.expectText || info.text.includes(s.capture.expectText), `实际页面未出现预期文案：${s.capture.expectText}`);
    assert(!s.capture.expectSelector || info.selectorFound, `实际页面未出现可见控件：${s.capture.expectSelector}`);
    const bytes = await browser.screenshot(target);
    // 将图片交给统一签名校验；临时文件只在本次截图目录内产生。
    const temporary = path.join(dir, `.capture-${s.id}-${process.pid}.tmp`);
    try { await fs.writeFile(temporary, bytes); console.log(await attachImage(context, s, temporary, options.observed, browser.source, { url: info.url, title: info.title, viewport: info.viewport })); }
    finally { await fs.rm(temporary, { force: true }); }
  } finally { await browser.dispose(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`pm-draw: ${error.message}`); process.exitCode = 1; });
}
