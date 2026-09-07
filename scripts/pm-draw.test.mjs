import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validate, readImage, prdStatus, loadManifest, feedbackFingerprint } from './model.mjs';
import { main } from './pm-draw.mjs';
import { saveFeedbackPayload } from './feedback-server.mjs';

const prdText = ['# 测试产品 PRD', '', '列表页显示资料列表。', '', '用户可以点击新建进入新建页。', '', '新建页含标题输入框。', ''].join('\n');

function makeFlow() {
  return {
    schemaVersion: 1,
    project: { id: 'demo', title: '演示产品' },
    round: 1,
    mode: 'prototype',
    prd: { path: 'PRD.md' },
    target: { kind: 'none' },
    requirements: [
      { id: 'r-list', text: '列表页显示资料列表', quote: '列表页显示资料列表。' },
      { id: 'r-create', text: '点击新建进入新建页', quote: '用户可以点击新建进入新建页。' },
      { id: 'r-form', text: '新建页含标题输入框', quote: '新建页含标题输入框。' },
    ],
    groups: [{
      id: 'main', title: '资料管理', screens: [
        {
          id: 'list', page: '资料列表', state: '有数据',
          requirements: ['r-list', 'r-create'], reproduce: ['打开列表页'], pending: [],
          actions: [{ id: 'act-create', label: '新建资料', to: 'create-form', outcome: '进入新建页', requirement: 'r-create', role: 'primary' }],
          blocks: [
            { id: 'title', type: 'heading', text: '资料', requirement: 'r-list' },
            { id: 'hint', type: 'text', text: '共 3 条资料', requirement: 'r-list' },
            { id: 'btn-create', type: 'action', action: 'act-create', requirement: 'r-create' },
          ],
        },
        {
          id: 'create-form', page: '新建资料', state: '默认',
          requirements: ['r-form'], reproduce: ['列表页点击「新建资料」'], pending: [],
          actions: [{ id: 'act-save', label: '保存', to: null, outcome: '保存成功返回列表', requirement: 'r-form' }],
          blocks: [
            { id: 'title', type: 'heading', text: '新建资料', requirement: 'r-form', level: 2 },
            { id: 'f-title', type: 'field', text: '标题', placeholder: '请输入标题', requirement: 'r-form' },
            { id: 'btn-save', type: 'action', action: 'act-save', requirement: 'r-form' },
          ],
        },
      ],
    }],
  };
}

test('validate 接受新字段：heading level、role、pin/arrow', () => {
  const flow = makeFlow();
  flow.groups[0].screens[0].annotations = [{ component: 'title', requirement: 'r-list', original: '原逻辑', change: '修改点', pin: [10, 10], arrow: [50, 50] }];
  assert.doesNotThrow(() => validate(flow, prdText));
});

test('validate 拒绝非法 level / role / 多主操作 / 无起点箭头', () => {
  const bad1 = makeFlow(); bad1.groups[0].screens[0].blocks[0].level = 4;
  assert.throws(() => validate(bad1, prdText), /level/);
  const bad2 = makeFlow(); bad2.groups[0].screens[0].blocks[1].level = 2;
  assert.throws(() => validate(bad2, prdText), /level/);
  const bad3 = makeFlow(); bad3.groups[0].screens[1].actions[0].role = 'ghost';
  assert.throws(() => validate(bad3, prdText), /role/);
  const bad4 = makeFlow();
  bad4.groups[0].screens[0].actions.push({ id: 'act-x', label: '导出', to: null, outcome: '导出列表', requirement: 'r-list', role: 'primary' });
  bad4.groups[0].screens[0].blocks.push({ id: 'btn-x', type: 'action', action: 'act-x', requirement: 'r-list' });
  assert.throws(() => validate(bad4, prdText), /主操作/);
  const bad5 = makeFlow(); bad5.groups[0].screens[0].annotations = [{ component: 'title', requirement: 'r-list', original: 'o', change: 'c', arrow: [50, 50] }];
  assert.throws(() => validate(bad5, prdText), /箭头/);
  const bad6 = makeFlow(); bad6.groups[0].screens[0].annotations = [{ component: 'title', requirement: 'r-list', original: 'o', change: 'c', pin: [10, 120] }];
  assert.throws(() => validate(bad6, prdText), /pin/);
});

async function buildToFiles(flow, prd = prdText) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-draw-'));
  await fs.writeFile(path.join(dir, 'PRD.md'), prd);
  await fs.writeFile(path.join(dir, 'flow.json'), JSON.stringify(flow, null, 2));
  const out = path.join(dir, 'site');
  await main(['build', path.join(dir, 'flow.json'), '--out', out]);
  const files = {};
  for (const name of await fs.readdir(out)) files[name] = await fs.readFile(path.join(out, name), 'utf8');
  return files;
}

test('prdStatus 解析文首状态行，超出文首不识别', () => {
  assert.equal(prdStatus('# T\n\n> 状态：已审查通过（2026-09-06）\n').key, 'approved');
  assert.equal(prdStatus('# T\n状态：待决策\n').key, 'pending');
  assert.equal(prdStatus('# T\n状态：草稿\n').key, 'draft');
  assert.equal(prdStatus('# T\n\n正文。\n').key, 'unknown');
  const deep = `# T\n${Array(50).fill('正文。').join('\n')}\n状态：已审查通过\n`;
  assert.equal(prdStatus(deep).key, 'unknown', '状态行只认文首，正文提及不算定稿');
});

test('PRD 状态呈现在 HTML：定稿徽章；未定稿提示仅供讨论', async () => {
  const approved = await buildToFiles(makeFlow(), prdText.replace('# 测试产品 PRD', '# 测试产品 PRD\n\n> 状态：已审查通过（2026-09-06）'));
  assert.match(approved['index.html'], /PRD：已审查通过/, '索引定稿徽章');
  assert.match(approved['main.html'], /PRD：已审查通过/, '分组页定稿徽章');
  assert.doesNotMatch(approved['index.html'], /仅供讨论|未标记审查状态/, '定稿后无未定稿提示');
  const draft = await buildToFiles(makeFlow(), prdText.replace('# 测试产品 PRD', '# 测试产品 PRD\n\n状态：草稿'));
  assert.match(draft['index.html'], /PRD：草稿/, '索引草稿徽章');
  assert.match(draft['main.html'], /仅供讨论/, '分组页提示方案仅供讨论');
  const unmarked = await buildToFiles(makeFlow());
  assert.match(unmarked['index.html'], /PRD：未标记/, '无状态行徽章');
  assert.match(unmarked['main.html'], /未标记审查状态/, '分组页提示补标');
});

test('prototype 渲染：信息层级、按钮主次、每屏名称状态与跳转、流程导航', async () => {
  const files = await buildToFiles(makeFlow());
  const html = files['main.html'];
  assert.match(html, /wf-screenbar/, '线框应有页面状态条');
  assert.match(html, /状态：有数据/, '状态条包含当前状态');
  assert.match(html, /wf-h2/, 'heading level 2 分级渲染');
  assert.match(html, /button primary/, '主操作按钮强调样式');
  assert.match(html, /class="fa-to">→ <a href="#screen-create-form">新建资料 · 默认/, '操作去向在画布外呈现');
  assert.match(html, /第 1 \/ 2 屏/, '流程位置指示');
  assert.match(html, /下一屏：新建资料 · 默认/, '下一屏导航');
  assert.match(html, /最后一屏/, '阅读顺序不冒充业务流程终点');
  assert.match(html, /fa-role">主操作/, '操作列表标出主操作');
});

test('原型说明面板：页面 / 布局 / 组件 note / 逻辑规则渲染，PRD 依据折叠保留', async () => {
  const flow = makeFlow();
  const list = flow.groups[0].screens[0];
  list.summary = '用户查看全部资料，并可进入新建流程';
  list.layout = ['顶部为页面标题与统计', '中部为资料列表区', '底部为主操作区'];
  list.logic = ['无权限时隐藏新建按钮'];
  list.blocks[0].note = '页面主标题，固定文案「资料」';
  list.blocks[1].note = '统计当前资料总数，只读';
  assert.doesNotThrow(() => validate(flow, prdText), '新字段应通过校验');
  const files = await buildToFiles(flow);
  const html = files['main.html'];
  assert.match(html, /<h4>原型说明<\/h4>/, '面板标题为原型说明');
  assert.doesNotMatch(html, /PRD 对照/, '不再使用「PRD 对照」旧称');
  assert.match(html, /spec-summary">用户查看全部资料，并可进入新建流程/, '页面说明');
  assert.match(html, /<h4>页面布局<\/h4>/, '布局分区');
  assert.match(html, /中部为资料列表区/, '布局内容');
  assert.match(html, /<h4>组件说明<\/h4>/, '组件说明分区');
  assert.match(html, /统计当前资料总数，只读/, '组件 note 内容');
  assert.doesNotMatch(html, /<span class="wf-idx"/, '编号不挤占产品画布位置');
  assert.match(html, /data-target="title"[^>]*><span class="comp-num">1</, '说明编号与线框组件联动');
  assert.match(html, /<h4>逻辑规则<\/h4>/, '逻辑规则分区');
  assert.match(html, /无权限时隐藏新建按钮/, '逻辑规则内容');
  assert.match(html, /<details class="prd-ref">/, 'PRD 依据折叠保留');
  assert.match(html, /PRD 依据（2 条，可追溯原文）/, '依据条目数');
  assert.match(html, /列表页显示资料列表。/, 'PRD 原文仍可追溯');
  const other = files['main.html'];
  assert.match(other, /proto-with-spec/, '原型与说明容器');
});

test('validate 拒绝非法的原型说明字段', () => {
  const bad1 = makeFlow(); bad1.groups[0].screens[0].summary = 42;
  assert.throws(() => validate(bad1, prdText), /summary/);
  const bad2 = makeFlow(); bad2.groups[0].screens[0].layout = '不是数组';
  assert.throws(() => validate(bad2, prdText), /layout/);
  const bad3 = makeFlow(); bad3.groups[0].screens[0].logic = [''];
  assert.throws(() => validate(bad3, prdText), /逻辑规则/);
  const bad4 = makeFlow(); bad4.groups[0].screens[0].blocks[0].note = '';
  assert.throws(() => validate(bad4, prdText), /note/);
});

test('多页面拆分：index 总索引、分组子页面、跨组跳转链接', async () => {
  const flow = makeFlow();
  flow.groups[0].screens[1].actions.push({ id: 'act-next-flow', label: '去归档', to: 'archive-list', outcome: '进入归档流程', requirement: 'r-form' });
  flow.groups[0].screens[1].blocks.push({ id: 'btn-next-flow', type: 'action', action: 'act-next-flow', requirement: 'r-form' });
  flow.groups.push({
    id: 'archive', title: '归档管理', description: '归档资料的查看', screens: [
      { id: 'archive-list', page: '归档列表', state: '默认', requirements: ['r-list'], reproduce: ['新建页点击去归档'], pending: [], actions: [], blocks: [{ id: 'title', type: 'heading', text: '归档', requirement: 'r-list' }] },
    ],
  });
  const files = await buildToFiles(flow);
  assert.deepEqual(Object.keys(files).sort(), ['archive.html', 'index.html', 'main.html'], '一个分组一个子页面 + 总索引');
  const index = files['index.html'];
  assert.match(index, /href="main\.html"/, '索引链接到第一组');
  assert.match(index, /href="archive\.html"/, '索引链接到第二组');
  assert.match(index, /归档资料的查看/, '索引呈现分组说明');
  assert.match(index, /href="archive\.html#screen-archive-list"/, '索引链接到组内页面状态');
  assert.match(files['main.html'], /href="archive\.html#screen-archive-list"/, '跨组操作跳转到对应子页面锚点');
  assert.match(files['archive.html'], /id="screen-archive-list"/, '第二组子页面包含本组屏幕');
  assert.doesNotMatch(files['archive.html'], /id="screen-list"|id="screen-create-form"/, '子页面不渲染其他组的屏幕');
  assert.match(files['archive.html'], /href="index\.html"/, '子页面可返回总索引');
  const model = JSON.parse(files['archive.html'].match(/<script id="pm-data" type="application\/json">(.*?)<\/script>/s)[1]);
  assert.equal(model.screens.length, 3, '每页嵌入全量屏幕目录，保证导出完整反馈');
  assert.equal(model.page, 'archive', '页面标记所属分组');
});

test('页面“保存反馈”将问题和建议 JSON 写入网页目录', async () => {
  const files = await buildToFiles(makeFlow());
  assert.match(files['main.html'], /<script id="pm-feedback" type="application\/json">{}<\/script>/, '页面提供稳定 JSON 节点');
  assert.match(files['main.html'], /id="save-json" class="primary">保存反馈/, '页面提供保存按钮');
  assert.match(files['main.html'], /fetch\('http:\/\/127\.0\.0\.1:9224\/feedback'/, '保存按钮调用本机保存服务');

  const site = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-draw-feedback-site-'));
  const index = path.join(site, 'index.html'), group = path.join(site, 'main.html');
  await fs.writeFile(index, files['index.html']); await fs.writeFile(group, files['main.html']);
  const model = JSON.parse(files['main.html'].match(/<script id="pm-data" type="application\/json">(.*?)<\/script>/s)[1]);
  const report = {
    schemaVersion: 1, kind: 'pm-draw-feedback', projectId: model.projectId, projectTitle: model.projectTitle,
    round: model.round, fingerprint: model.fingerprint, updatedAt: '2026-09-06T02:00:00.000Z', exportedAt: '2026-09-06T02:00:00.000Z',
    screens: model.screens.map((screen, index) => ({ ...screen, mark: '', problem: index ? '' : '页面反馈原话', suggestion: index ? '' : '保留建议原话' })),
    groups: model.groups.map(group => ({ ...group, problem: '', suggestion: '' })), history: [],
  };
  const saved = await saveFeedbackPayload({ pageUrl: pathToFileURL(group).href, feedback: report });
  assert.equal(saved.output, path.join(site, 'demo-round-1-feedback.json'));
  const stored = JSON.parse(await fs.readFile(saved.output, 'utf8'));
  assert.equal(stored.screens[0].problem, '页面反馈原话');
  assert.equal(stored.screens[0].suggestion, '保留建议原话');
});

test('review 渲染：截图红色编号、圆点与箭头覆盖层，标注列表联动', async () => {
  const flow = makeFlow();
  flow.mode = 'review'; flow.target = { kind: 'manual' };
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-draw-shot-'));
  const shotFile = path.join(dir, 'shot.png');
  await fs.writeFile(shotFile, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  const { hash } = await readImage(shotFile);
  const screen = flow.groups[0].screens[0];
  screen.screenshot = { path: 'shot.png', sha256: hash, source: 'manual', capturedAt: new Date().toISOString(), actualState: '资料列表，有数据' };
  screen.annotations = [
    { component: 'title', requirement: 'r-list', original: '原逻辑A', change: '修改点A', rect: [10, 10, 30, 20], arrow: [85, 85] },
    { component: 'hint', requirement: 'r-list', original: '原逻辑B', change: '修改点B', pin: [50, 60] },
  ];
  await fs.writeFile(path.join(dir, 'PRD.md'), prdText);
  await fs.writeFile(path.join(dir, 'flow.json'), JSON.stringify(flow, null, 2));
  const out = path.join(dir, 'site');
  await fs.copyFile(shotFile, path.join(dir, 'shot.png'));
  await main(['build', path.join(dir, 'flow.json'), '--out', out]);
  const html = await fs.readFile(path.join(out, 'main.html'), 'utf8');
  assert.match(html, /class="shot-pin" data-comp="shot-list-1"/, '红色编号矩形覆盖层');
  assert.match(html, /class="shot-dot" data-comp="shot-list-2"/, '红色编号圆点');
  assert.match(html, /<svg class="shot-overlay"/, 'SVG 箭头覆盖层');
  assert.match(html, /class="shot-arrow" marker-end="url\(#arrow-list\)"/, '红色箭头连线');
  assert.match(html, /#b0524a/, '标注砖红');
  assert.match(html, /anno-num/, '标注编号与截图一一对应');
  assert.match(html, /data-target="title,shot-list-1"/, '标注联动线框组件与截图标识');
});

test('增量构建（大 PRD 分块）：init → add-requirements → add-group → validate 通过，build 产物正常', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-draw-inc-'));
  await fs.writeFile(path.join(dir, 'PRD.md'), prdText);
  const flowFile = path.join(dir, 'flow.json');
  await main(['init', flowFile, '--prd', 'PRD.md', '--project', 'demo', '--title', '演示产品']);
  await assert.rejects(() => main(['init', flowFile, '--prd', 'PRD.md', '--project', 'demo', '--title', '演示产品']), /已存在/, '骨架不允许覆盖');
  const reqFile = path.join(dir, 'req.json');
  await fs.writeFile(reqFile, JSON.stringify([
    { id: 'r-list', text: '列表页显示资料列表', quote: '列表页显示资料列表。' },
    { id: 'r-create', text: '点击新建进入新建页', quote: '用户可以点击新建进入新建页。' },
    { id: 'r-form', text: '新建页含标题输入框', quote: '新建页含标题输入框。' },
  ]));
  await main(['add-requirements', flowFile, '--file', reqFile]);
  const groupFile = path.join(dir, 'group.json');
  await fs.writeFile(groupFile, JSON.stringify(makeFlow().groups[0]));
  await main(['add-group', flowFile, '--file', groupFile]);
  await main(['validate', flowFile]);
  const saved = JSON.parse(await fs.readFile(flowFile, 'utf8'));
  assert.equal(saved.requirements.length, 3);
  assert.deepEqual(saved.groups, [{ id: 'main', title: '资料管理', file: 'groups/main.json' }], 'flow.json 只保留分组索引');
  const groupOnDisk = JSON.parse(await fs.readFile(path.join(dir, 'groups', 'main.json'), 'utf8'));
  assert.equal(groupOnDisk.screens.length, 2, '分组完整内容在独立文件中');
  const out = path.join(dir, 'site');
  await main(['build', flowFile, '--out', out]);
  assert.match(await fs.readFile(path.join(out, 'index.html'), 'utf8'), /演示产品/);
  assert.match(await fs.readFile(path.join(out, 'main.html'), 'utf8'), /状态：有数据/);
});

test('增量校验：错误 quote、重复需求、未知需求引用、重复分组编号被拒绝', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-draw-inc-bad-'));
  await fs.writeFile(path.join(dir, 'PRD.md'), prdText);
  const flowFile = path.join(dir, 'flow.json');
  await main(['init', flowFile, '--prd', 'PRD.md', '--project', 'demo', '--title', '演示产品']);
  const badQuote = path.join(dir, 'bad-quote.json');
  await fs.writeFile(badQuote, JSON.stringify([{ id: 'r-x', text: 'x', quote: 'PRD 中不存在的一句话。' }]));
  await assert.rejects(() => main(['add-requirements', flowFile, '--file', badQuote]), /找不到需求/);
  const goodReq = path.join(dir, 'good.json');
  await fs.writeFile(goodReq, JSON.stringify([{ id: 'r-list', text: 'l', quote: '列表页显示资料列表。' }]));
  await main(['add-requirements', flowFile, '--file', goodReq]);
  await assert.rejects(() => main(['add-requirements', flowFile, '--file', goodReq]), /需求编号重复/);
  const badGroup = path.join(dir, 'bad-group.json');
  await fs.writeFile(badGroup, JSON.stringify(makeFlow().groups[0]));
  await assert.rejects(() => main(['add-group', flowFile, '--file', badGroup]), /需求编号/, '引用未加入的需求应被拒绝');
  const allReq = path.join(dir, 'all.json');
  await fs.writeFile(allReq, JSON.stringify([
    { id: 'r-create', text: 'c', quote: '用户可以点击新建进入新建页。' },
    { id: 'r-form', text: 'f', quote: '新建页含标题输入框。' },
  ]));
  await main(['add-requirements', flowFile, '--file', allReq]);
  await main(['add-group', flowFile, '--file', badGroup]);
  await assert.rejects(() => main(['add-group', flowFile, '--file', badGroup]), /流程编号重复/);
});

function addArchiveGroup(flow) {
  flow.groups.push({ id: 'archive', title: '归档管理', screens: [
    { id: 'archive-list', page: '归档列表', state: '默认', requirements: ['r-list'], reproduce: ['进入归档'], pending: [], actions: [], blocks: [{ id: 'title', type: 'heading', text: '归档', requirement: 'r-list' }] },
  ] });
  return flow;
}

test('split 拆分内联分组：索引、指纹不变、按组局部修改生效', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-draw-split-'));
  await fs.writeFile(path.join(dir, 'PRD.md'), prdText);
  const flowFile = path.join(dir, 'flow.json');
  await fs.writeFile(flowFile, JSON.stringify(addArchiveGroup(makeFlow()), null, 2));
  const inline = await loadManifest(flowFile), fpInline = feedbackFingerprint(inline.m, inline.prdHash);
  await main(['split', flowFile]);
  await assert.rejects(() => main(['split', flowFile]), /无需拆分/, '重复拆分直接提示');
  const saved = JSON.parse(await fs.readFile(flowFile, 'utf8'));
  assert.deepEqual(saved.groups.map(g => g.file), ['groups/main.json', 'groups/archive.json'], 'flow.json 只留索引');
  assert.equal(JSON.parse(await fs.readFile(path.join(dir, 'groups', 'archive.json'), 'utf8')).screens[0].id, 'archive-list');
  const splitCtx = await loadManifest(flowFile);
  assert.equal(feedbackFingerprint(splitCtx.m, splitCtx.prdHash), fpInline, '拆分不改变反馈指纹');
  const out = path.join(dir, 'site');
  await main(['build', flowFile, '--out', out]);
  assert.match(await fs.readFile(path.join(out, 'archive.html'), 'utf8'), /归档列表/);
  // 模拟 AI 只修改某一组：只读写对应分组文件
  const groupFile = path.join(dir, 'groups', 'main.json');
  const mainGroup = JSON.parse(await fs.readFile(groupFile, 'utf8'));
  mainGroup.screens[0].summary = '只改这一组';
  await fs.writeFile(groupFile, JSON.stringify(mainGroup, null, 2));
  await main(['validate', flowFile]);
  await main(['build', flowFile, '--out', out]);
  assert.match(await fs.readFile(path.join(out, 'main.html'), 'utf8'), /只改这一组/);
});

test('拆分存储混用与索引一致性校验', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-draw-split-mix-'));
  await fs.writeFile(path.join(dir, 'PRD.md'), prdText);
  const flowFile = path.join(dir, 'flow.json');
  await fs.writeFile(flowFile, JSON.stringify(addArchiveGroup(makeFlow())));
  await main(['split', flowFile]);
  // 混合形式：一组内联、一组索引，仍可校验
  const saved = JSON.parse(await fs.readFile(flowFile, 'utf8'));
  saved.groups[1] = JSON.parse(await fs.readFile(path.join(dir, 'groups', 'archive.json'), 'utf8'));
  await fs.writeFile(flowFile, JSON.stringify(saved, null, 2));
  await main(['validate', flowFile]);
  // 索引与文件内容不一致被拒绝
  const badTitle = JSON.parse(await fs.readFile(flowFile, 'utf8'));
  badTitle.groups[0] = { id: 'main', title: '错误的标题', file: 'groups/main.json' };
  await fs.writeFile(flowFile, JSON.stringify(badTitle, null, 2));
  await assert.rejects(() => main(['validate', flowFile]), /标题不一致/);
  const badId = JSON.parse(await fs.readFile(flowFile, 'utf8'));
  badId.groups[0] = { id: 'other', file: 'groups/main.json' };
  await fs.writeFile(flowFile, JSON.stringify(badId, null, 2));
  await assert.rejects(() => main(['validate', flowFile]), /编号不一致/);
  // 缺失分组文件与越界路径被拒绝
  const missing = JSON.parse(await fs.readFile(flowFile, 'utf8'));
  missing.groups[0] = { id: 'main', title: '资料管理', file: 'groups/missing.json' };
  await fs.writeFile(flowFile, JSON.stringify(missing, null, 2));
  await assert.rejects(() => main(['validate', flowFile]), /找不到分组文件/);
  const escape = JSON.parse(await fs.readFile(flowFile, 'utf8'));
  escape.groups[0] = { id: 'main', title: '资料管理', file: '../outside.json' };
  await fs.writeFile(flowFile, JSON.stringify(escape, null, 2));
  await assert.rejects(() => main(['validate', flowFile]), /相对路径/);
});

test('next-round 保留分组拆分：新轮次目录自含分组文件，可直接构建', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-draw-split-round-'));
  await fs.writeFile(path.join(dir, 'PRD.md'), prdText);
  const flowFile = path.join(dir, 'flow.json');
  await fs.writeFile(flowFile, JSON.stringify(makeFlow(), null, 2));
  await main(['split', flowFile]);
  const out = path.join(dir, 'site');
  await main(['build', flowFile, '--out', out]);
  const index = await fs.readFile(path.join(out, 'index.html'), 'utf8');
  const model = JSON.parse(index.match(/<script id="pm-data" type="application\/json">(.*?)<\/script>/s)[1]);
  const report = { schemaVersion: 1, kind: 'pm-draw-feedback', projectId: model.projectId, round: model.round, fingerprint: model.fingerprint, screens: model.screens.map(s => ({ ...s, mark: '', problem: '', suggestion: '' })), groups: model.groups.map(g => ({ ...g, problem: '', suggestion: '' })), history: [] };
  const feedbackFile = path.join(dir, 'feedback.json');
  await fs.writeFile(feedbackFile, JSON.stringify(report));
  const nextFile = path.join(dir, 'round-2', 'flow.json');
  await main(['next-round', flowFile, '--feedback', feedbackFile, '--out', nextFile]);
  const next = JSON.parse(await fs.readFile(nextFile, 'utf8'));
  assert.deepEqual(next.groups, [{ id: 'main', title: '资料管理', file: 'groups/main.json' }], '新轮次仍是索引');
  const copied = JSON.parse(await fs.readFile(path.join(dir, 'round-2', 'groups', 'main.json'), 'utf8'));
  assert.equal(copied.screens.length, 2, '分组文件随轮次复制');
  await main(['build', nextFile, '--out', path.join(dir, 'round-2', 'site')]);
});

test('原型参考离线展示、来源转义、版本绑定与跨轮复用', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-draw-reference-'));
  const flow = makeFlow(), flowFile = path.join(dir, 'flow.json');
  const image = path.join(dir, 'reference.png');
  await fs.writeFile(image, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  const { hash } = await readImage(image);
  flow.references = [{ id: 'reference-form', kind: 'competitor', title: '测试参考（非真实竞品）', source: '测试夹具', url: 'https://example.com/form', capturedAt: '2026-09-06T08:00:00Z', observed: '观察文本 <script>unsafe()</script>', application: '用于验证截图参考的呈现', screens: ['create-form'], image: { path: 'reference.png', sha256: hash } }];
  flow.groups[0].screens[1].dataFlow = ['用户输入标题 → 保存资料 → 列表更新；失败时保留输入'];
  await fs.writeFile(path.join(dir, 'PRD.md'), prdText);
  await fs.writeFile(flowFile, JSON.stringify(flow));
  const out = path.join(dir, 'site');
  await main(['build', flowFile, '--out', out]);
  const index = await fs.readFile(path.join(out, 'index.html'), 'utf8');
  const group = await fs.readFile(path.join(out, 'main.html'), 'utf8');
  assert.match(index, /<img src="data:image\/png;base64,/);
  assert.match(index, /href="https:\/\/example.com\/form"/);
  assert.match(index, /观察文本 &lt;script&gt;unsafe\(\)&lt;\/script&gt;/);
  assert.match(index, /href="main.html#screen-create-form"/);
  assert.match(group, /href="index.html#reference-reference-form"/);
  assert.match(group, /<h4>数据流向<\/h4>.*用户输入标题 → 保存资料/s);
  assert.doesNotMatch(group, /产品走查|PRD → 原型 → 走查|待回归/);

  const model = JSON.parse(index.match(/<script id="pm-data" type="application\/json">(.*?)<\/script>/s)[1]);
  const report = { schemaVersion: 1, kind: 'pm-draw-feedback', projectId: model.projectId, round: model.round, fingerprint: model.fingerprint, screens: model.screens.map(s => ({ ...s, mark: '需要调整', problem: '  原话\n保留  ', suggestion: '调整布局' })), groups: model.groups.map(g => ({ ...g, problem: '', suggestion: '' })), history: [] };
  const feedbackFile = path.join(dir, 'feedback.json');
  await fs.writeFile(feedbackFile, JSON.stringify(report));
  flow.references[0].application = '参考内容已变化';
  await fs.writeFile(flowFile, JSON.stringify(flow));
  const nextFile = path.join(dir, 'round-2', 'flow.json');
  await assert.rejects(() => main(['next-round', flowFile, '--feedback', feedbackFile, '--out', nextFile]), /版本不一致/);
  flow.references[0].application = '用于验证截图参考的呈现';
  await fs.writeFile(flowFile, JSON.stringify(flow));
  await main(['next-round', flowFile, '--feedback', feedbackFile, '--out', nextFile]);
  const next = JSON.parse(await fs.readFile(nextFile, 'utf8'));
  assert.equal(next.references[0].image.path, '../reference.png');
  assert.equal(next.history[0].screens[0].problem, '  原话\n保留  ');
  assert.equal(next.round, 2);
  next.groups[0].screens[1].dataFlow.push('测试新增说明');
  await fs.writeFile(nextFile, JSON.stringify(next));
  const nextOut = path.join(dir, 'round-2', 'site');
  await main(['build', nextFile, '--out', nextOut]);
  const nextHTML = await fs.readFile(path.join(nextOut, 'main.html'), 'utf8');
  assert.match(nextHTML, /已更新/);
  assert.doesNotMatch(nextHTML, /待回归/);
  const oldImage = await fs.readFile(image);
  await fs.writeFile(image, Buffer.concat([oldImage, Buffer.from('changed')]));
  await assert.rejects(() => main(['build', nextFile, '--out', nextOut]), /参考截图已被替换/);
});

test('参考必须关联现有页面且来源可用；无数据流与操作时不输出空说明', async () => {
  const flow = makeFlow();
  const ref = { id: 'ref-form', kind: 'competitor', title: '测试', source: '测试夹具', url: 'https://example.com/form', capturedAt: '2026-09-06T08:00:00Z', observed: '测试观察', application: '测试应用', screens: ['create-form'], image: { path: 'shot.png', sha256: 'a'.repeat(64) } };
  flow.references = [ref];
  for (const change of [{ screens: ['missing'] }, { url: 'javascript:alert(1)' }, { url: undefined }, { image: { path: 'shot.png', sha256: 'invalid' } }]) {
    flow.references = [{ ...ref, ...change }];
    assert.throws(() => validate(flow, prdText));
  }
  delete flow.references;
  const s = flow.groups[0].screens[1];
  s.dataFlow = 'invalid';
  assert.throws(() => validate(flow, prdText), /dataFlow/);
  s.dataFlow = [];
  s.actions = []; s.blocks = s.blocks.filter(b => b.type !== 'action');
  const files = await buildToFiles(flow);
  const article = files['main.html'].split('<article class="screen" id="screen-create-form">')[1].split('</article>')[0];
  assert.doesNotMatch(article, /<h4>数据流向|<h4>可执行操作|本状态无可执行操作/);
  assert.doesNotMatch(files['index.html'], /<section class="design-references">/);
});

test('旧页面截图在图上标记变更点并展示更新逻辑；参考图不标变更点', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-draw-existing-'));
  const image = path.join(dir, 'old.png');
  await fs.writeFile(image, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  const { hash } = await readImage(image);
  const ref = { id: 'ref-old-list', kind: 'existing', title: '旧资料列表', source: '用户上传截图', capturedAt: '2026-09-06T08:00:00Z', observed: '旧列表逐个归档，无状态筛选', application: '在截图上标记与批量归档相关的变更', screens: ['list'], image: { path: 'old.png', sha256: hash }, changes: [{ rect: [10, 20, 30, 8], original: '旧逻辑：逐个归档（用户描述）', change: '新逻辑：支持批量归档' }, { pin: [50, 60], original: '旧逻辑：无筛选', change: '新逻辑：增加状态筛选' }] };
  const flow = makeFlow();
  flow.references = [ref];
  await fs.writeFile(path.join(dir, 'PRD.md'), prdText);
  const flowFile = path.join(dir, 'flow.json');
  await fs.writeFile(flowFile, JSON.stringify(flow));
  await main(['build', flowFile, '--out', path.join(dir, 'site')]);
  const index = await fs.readFile(path.join(dir, 'site', 'index.html'), 'utf8');
  assert.match(index, /变更点与更新逻辑/);
  assert.match(index, /class="shot-pin" data-comp="ref-ref-old-list-1"/);
  assert.match(index, /class="shot-dot" data-comp="ref-ref-old-list-2"/);
  assert.match(index, /data-target="ref-ref-old-list-1"/);
  assert.match(index, /旧逻辑：逐个归档（用户描述）/);
  const card = index.split('id="reference-ref-old-list"')[1].split('</article>')[0];
  assert.doesNotMatch(card, /<details>/, '带变更点的旧页面截图直接展示，不折叠');

  const competitor = { ...ref, id: 'ref-form', kind: 'competitor', url: 'https://example.com/form', screens: ['create-form'] };
  const bad1 = makeFlow(); bad1.references = [competitor];
  assert.throws(() => validate(bad1, prdText), /existing/);
  const bad2 = makeFlow(); bad2.references = [{ ...ref, changes: [{ pin: [10, 10], original: '', change: 'c' }] }];
  assert.throws(() => validate(bad2, prdText), /原逻辑/);
  const bad3 = makeFlow(); bad3.references = [{ ...ref, changes: [{ original: 'o', change: 'c' }] }];
  assert.throws(() => validate(bad3, prdText), /定位/);
  const bad4 = makeFlow(); bad4.references = [{ ...ref, changes: [{ rect: [90, 90, 20, 20], original: 'o', change: 'c' }] }];
  assert.throws(() => validate(bad4, prdText), /超出画面/);
});

test('PC 与移动端独立画布、区域定位；设计旁注不进入产品画面', async () => {
  const flow = makeFlow();
  const [desktop, mobile] = flow.groups[0].screens;
  desktop.device = 'desktop'; desktop.frame = { width: 1440, height: 900 };
  desktop.blocks = [
    { id: 'nav', type: 'text', text: '产品导航', region: 'header', requirement: 'r-list' },
    { id: 'body-columns', type: 'columns', children: [
      { id: 'sidebar', type: 'section', width: 240, requirement: 'r-list', children: [{ id: 'menu', type: 'text', text: '资料管理', requirement: 'r-list' }] },
      { id: 'main-body', type: 'section', requirement: 'r-list', children: desktop.blocks },
    ], requirement: 'r-list' },
  ];
  mobile.device = 'mobile';
  mobile.blocks[0].region = 'header';
  mobile.blocks[1].note = '旁注：必填后允许提交';
  mobile.blocks[2].region = 'footer';
  mobile.blocks[2].requirement = '待确认';
  mobile.pending = ['Q1：提交后的去向待确认'];
  const files = await buildToFiles(flow), html = files['main.html'];
  assert.match(html, /device-desktop" data-frame-width="1440" data-frame-height="900"/);
  assert.match(html, /device-mobile" data-frame-width="390" data-frame-height="844"/);
  assert.match(html, /data-comp="sidebar" style="width:240px;flex:0 0 240px;"/);
  const mobileArticle = html.split('<article class="screen" id="screen-create-form">')[1].split('</article>')[0];
  const canvas = mobileArticle.split('<div class="frame-host">')[1].split('</section></div><aside')[0];
  assert.match(canvas, /wf-region-header/); assert.match(canvas, /wf-region-body/); assert.match(canvas, /wf-region-footer/);
  assert.match(canvas, /data-comp="f-title"/); assert.match(canvas, /<button type="button">保存<\/button>/);
  assert.doesNotMatch(canvas, /旁注|待确认|保存成功返回列表|原型说明|data-feedback|wf-idx|wf-jump/);
  assert.match(mobileArticle, /旁注：必填后允许提交/);
  const model = JSON.parse(html.match(/<script id="pm-data" type="application\/json">(.*?)<\/script>/s)[1]);
  assert.equal(model.screens[1].device, 'mobile');
  assert.deepEqual(model.screens[1].frame, { width: 390, height: 844 });
});

test('拒绝无效终端、画布尺寸、冲突栏宽和嵌套固定区域', () => {
  for (const edit of [s => s.device = 'watch', s => s.actions[0].disabled = 'yes', s => s.frame = { width: 0, height: 844 }, s => s.blocks[0].width = 5000, s => { s.blocks[0].width = 240; s.blocks[0].weight = 1; }, s => s.blocks.push({ id: 'nested', type: 'section', requirement: 'r-list', children: [{ id: 'nested-child', type: 'text', text: '测试', requirement: 'r-list', region: 'footer' }] })]) {
    const flow = makeFlow(); edit(flow.groups[0].screens[0]); assert.throws(() => validate(flow, prdText));
  }
});

test('精确定位布局拒绝混排、嵌套坐标和非法尺寸，并保持旧流式布局兼容',async()=>{
 const f=makeFlow(),s=f.groups[0].screens[0];s.blocks.forEach((b,i)=>{b.box=[40,40+i*50,200,40];});
 assert.doesNotThrow(()=>validate(f,prdText));
 const files=await buildToFiles(f);assert.ok(files['main.html'].includes('left:40px;top:90px;width:200px;height:40px;'));
 delete s.blocks[0].box;assert.throws(()=>validate(f,prdText),/所有顶层/);
 s.blocks[0].box=[40,40,-1,40];assert.throws(()=>validate(f,prdText),/box/);
 s.blocks[0].box=[40,40,200,40];s.blocks[0].region='header';assert.throws(()=>validate(f,prdText),/box/);
 delete s.blocks[0].region;s.blocks.push({id:'nested',type:'section',requirement:'r-list',box:[300,50,200,100],children:[{id:'child',type:'text',text:'nested',requirement:'r-list',box:[0,0,30,30]}]});assert.throws(()=>validate(f,prdText),/顶层/);
 assert.doesNotThrow(()=>validate(makeFlow(),prdText));
});
