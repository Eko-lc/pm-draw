import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validate, readImage, prdStatus } from './model.mjs';
import { main } from './pm-draw.mjs';

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
  assert.match(html, /跳转：新建资料 · 默认/, '线框操作注明跳转目标页面与状态');
  assert.match(html, /第 1 \/ 2 屏/, '流程位置指示');
  assert.match(html, /下一屏：新建资料 · 默认/, '下一屏导航');
  assert.match(html, /流程终点/, '末屏标出流程终点');
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
  assert.match(html, /class="wf-idx"[^>]*>1</, '线框组件编号徽标');
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
  assert.equal(saved.groups.length, 1);
  const files = await buildToFiles(saved);
  assert.match(files['index.html'], /演示产品/);
  assert.match(files['main.html'], /状态：有数据/);
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
