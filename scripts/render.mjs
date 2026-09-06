import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { screens, requireApproval, readImage, assert, screenHash, feedbackFingerprint, prdStatus } from './model.mjs';

export const assetsDir = fileURLToPath(new URL('../assets/', import.meta.url));
export const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const e = escape;
const json = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

export async function injectAssets(html) {
  const blocks = { theme: ['theme.css', 'style'], shared: ['shared.css', 'style'], highlight: ['prd-highlight.js', 'script'], review: ['review.js', 'script'] };
  for (const [name, [file, tag]] of Object.entries(blocks)) {
    const start = `<!-- @pm-draw:${name}:start -->`, end = `<!-- @pm-draw:${name}:end -->`;
    const starts = html.split(start).length - 1, ends = html.split(end).length - 1;
    if (!starts && !ends) continue;
    assert(starts === 1 && ends === 1 && html.indexOf(start) < html.indexOf(end), `资产标记 ${name} 必须成对且唯一`);
    const content = await fs.readFile(path.join(assetsDir, file), 'utf8');
    html = html.slice(0, html.indexOf(start) + start.length) + `\n<${tag}>\n${content}\n</${tag}>\n` + html.slice(html.indexOf(end));
  }
  return html;
}
const marker = name => `<!-- @pm-draw:${name}:start --><!-- @pm-draw:${name}:end -->`;

function renderBlocks(blocks, s, resolve, noteIdx = new Map()) {
  return blocks.map(b => {
    const attr = `data-comp="${e(b.id)}" style="${b.align ? `text-align:${e(b.align)};` : ''}${b.weight ? `flex-grow:${b.weight};` : ''}"`, pending = b.requirement === '待确认' ? '<span class="unknown">待确认</span>' : '';
    const idx = noteIdx.get(b.id), idxBadge = idx ? `<span class="wf-idx" title="组件说明 ${idx}">${idx}</span>` : '';
    switch (b.type) {
      case 'heading': return `<div class="wf-heading wf-h${b.level || 1}" ${attr}>${idxBadge}${e(b.text)} ${pending}</div>`;
      case 'text': return `<p class="wf-text" ${attr}>${idxBadge}${e(b.text)} ${pending}</p>`;
      case 'notice': return `<div class="wf-notice" ${attr}>${idxBadge}${e(b.text)} ${pending}</div>`;
      case 'field': return `<label class="wf-field" ${attr}><span>${idxBadge}${e(b.text)} ${pending}</span><input type="text" value="${e(b.value || '')}" placeholder="${e(b.placeholder || '')}" readonly aria-label="${e(b.text)}（线框示意）"></label>`;
      case 'image': return `<div class="wf-image" role="img" aria-label="图片占位：${e(b.text)}" ${attr}><span>${idxBadge}${e(b.text)} ${pending}</span></div>`;
      case 'list': return `<div ${attr}>${idxBadge}<ul>${b.items.map(x => `<li>${e(x)}</li>`).join('')}</ul>${pending}</div>`;
      case 'table': return `<div ${attr}>${idxBadge}<table><thead><tr>${b.columns.map(c => `<th>${e(c)}</th>`).join('')}</tr></thead><tbody>${b.rows.map(r => `<tr>${r.map(c => `<td>${e(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>${pending}</div>`;
      case 'section': case 'columns': return `<div class="wf-${b.type}" ${attr}>${idxBadge}${b.text ? `<h4>${e(b.text)}</h4>` : ''}${pending}${renderBlocks(b.children, s, resolve, noteIdx)}</div>`;
      case 'action': {
        const a = s.actions.find(x => x.id === b.action), primary = a.role === 'primary', target = a.to && a.to !== '待确认' ? resolve(a.to) : null;
        const jump = a.to === '待确认' ? '跳转：待确认' : a.to === null ? '流程终点 / 当前状态内操作' : `跳转：${target.page} · ${target.state}${target.external ? '（另一分组页面）' : ''}`;
        return `<div class="wf-action" ${attr}>${idxBadge}${target ? `<a class="button${primary ? ' primary' : ''}" href="${e(target.href)}">${e(a.label)} →</a>` : `<button${primary ? ' class="primary"' : ''} disabled>${e(a.label)}</button>`}<small>${e(a.outcome)} ${pending}</small><small class="wf-jump">${e(jump)}</small></div>`;
      }
    }
  }).join('');
}

function historyFor(history, type, id) {
  return history.flatMap(h => h[type].filter(r => r.id === id).map(r => `<details class="feedback-history" open><summary>第 ${h.round} 轮原话${r.mark ? ` · ${e(r.mark)}` : ''}（只读）</summary><p class="muted">${e(r.page || r.title)}${r.state ? ' · ' + e(r.state) : ''}</p><strong>问题</strong><pre class="verbatim">${e(r.problem)}</pre><strong>建议</strong><pre class="verbatim">${e(r.suggestion)}</pre></details>`)).join('');
}
function feedback(id, kind, title, history) {
  return `<section class="feedback ${kind === 'group' ? 'group-feedback' : ''}" data-feedback="${e(id)}" data-kind="${kind}" aria-label="${e(title)}反馈"><fieldset><legend>${e(title)} · ${kind === 'group' ? '流程反馈' : '页面反馈'}</legend>${kind === 'screen' ? `<div class="marks"><span>结论：</span>${['符合预期', '需要调整', '严重问题'].map(x => `<button type="button" data-mark="${x}" aria-pressed="false">${x}</button>`).join('')}<small>再次点击可取消</small></div>` : ''}<div class="feedback-fields"><label><span>问题</span><textarea data-field="problem" aria-label="${e(title)}问题" placeholder="记录实际问题，保留原话"></textarea></label><label><span>建议</span><textarea data-field="suggestion" aria-label="${e(title)}建议" placeholder="期望怎样修改；不明确处写待确认"></textarea></label></div></fieldset>${historyFor(history, kind === 'group' ? 'groups' : 'screens', id)}</section>`;
}

export async function render(context) {
  const { m, dir, prdText, prdHash } = context;
  requireApproval(m, prdHash);
  const history = m.history || [], status = prdStatus(prdText), imageMap = new Map();
  for (const s of screens(m)) if (s.screenshot) {
    const img = await readImage(path.resolve(dir, s.screenshot.path));
    assert(img.hash === s.screenshot.sha256, `${s.id} 的截图文件已被替换，请重新 import-shot 或 capture 记录来源`);
    imageMap.set(s.id, `data:${img.mime};base64,${img.bytes.toString('base64')}`);
  }
  const model = { projectId: m.project.id, projectTitle: m.project.title, round: m.round, fingerprint: feedbackFingerprint(m, prdHash), history, screens: [], groups: m.groups.map(g => ({ id: g.id, title: g.title })) };
  const reqById = new Map(m.requirements.map(r => [r.id, r]));
  const ordered = screens(m), screenById = new Map(ordered.map(x => [x.id, x]));
  const groupOf = new Map(), numberOf = new Map(), labelOf = new Map();
  for (const g of m.groups) for (const s of g.screens) groupOf.set(s.id, g.id);
  ordered.forEach((s, i) => numberOf.set(s.id, i + 1));
  const fileOf = groupId => `${groupId}.html`;
  const hrefTo = (screenId, fromGroup) => `${groupOf.get(screenId) === fromGroup ? '' : fileOf(groupOf.get(screenId))}#screen-${screenId}`;
  const resolve = fromGroup => screenId => ({ href: hrefTo(screenId, fromGroup), ...((({ page, state }) => ({ page, state }))(screenById.get(screenId))), external: groupOf.get(screenId) !== fromGroup });
  for (const g of m.groups) for (const s of g.screens) {
    const contentHash = screenHash(s, g.id, m.requirements), previousHash = m.baseline?.[s.id];
    const changeLabel = previousHash ? previousHash !== contentHash ? '已改动 · 待回归' : '与上一轮一致' : m.round > 1 ? '新增页面状态' : '';
    labelOf.set(s.id, changeLabel);
    model.screens.push({ id: s.id, page: s.page, state: s.state, groupId: g.id, contentHash, changeLabel, reproduce: s.reproduce });
  }
  const prdBadge = `<span class="badge${status.key === 'approved' ? ' approved' : ' changed'}">PRD：${e(status.label)}</span>`;
  const prdNotice = status.hint ? `<div class="notice">${e(status.hint)}</div>` : '';
  const toolbar = `<div class="toolbar"><button id="export-json">导出 JSON</button><button id="export-md">导出 Markdown</button><button id="import-json">恢复本轮反馈 JSON</button><input id="import-file" type="file" accept="application/json,.json"></div><div id="save-status" role="status" aria-live="polite"></div><div id="progress"></div>`;
  const modeLabel = m.mode === 'prototype' ? '方案对齐' : '产品走查';
  const eyebrow = m.mode === 'prototype' ? '低保真方案 / WIREFRAME' : '流程走查 / WALKTHROUGH';
  const footer = `<footer class="footer">所有反馈按「页面—状态—问题—建议」保存于此浏览器，同轮各页面共享；任意页面导出的 JSON 都包含全部分组反馈。移动文件、清理浏览器或切换浏览器可能无法恢复本地记录，请导出 JSON 备份。历史反馈随下一轮页面一起携带。</footer>`;

  function renderScreen(g, s, si) {
    const num = numberOf.get(s.id), changeLabel = labelOf.get(s.id), link = resolve(g.id);
    const noteEntries = [];
    (function collect(bs) { for (const b of bs) { if (b.note) noteEntries.push(b); if (b.children) collect(b.children); } })(s.blocks);
    const noteIdx = new Map(noteEntries.map((b, i) => [b.id, i + 1]));
    const typeLabel = b => ({ heading: '标题', text: '文本', notice: '提示', field: '字段', image: '图片', list: '列表', table: '表格', section: '区块', columns: '分栏', action: '操作' })[b.type] || b.type;
    const blockLabel = b => b.text || (b.type === 'action' ? (s.actions.find(x => x.id === b.action)?.label || b.action) : b.type === 'list' ? `列表（${b.items.length} 项）` : b.type === 'table' ? `表格（${b.columns.join(' / ')}）` : b.id);
    const specIntro = s.summary ? `<p class="spec-summary">${e(s.summary)}</p>` : '';
    const specLayout = s.layout?.length ? `<h4>页面布局</h4><ol class="layout-list">${s.layout.map(x => `<li>${e(x)}</li>`).join('')}</ol>` : '';
    const compNotesHTML = noteEntries.length ? `<h4>组件说明</h4><ol class="comp-notes">${noteEntries.map((b, i) => `<li data-target="${e(b.id)}"><span class="comp-num">${i + 1}</span><div class="comp-body"><strong>${e(blockLabel(b))}</strong><span class="comp-type">${e(typeLabel(b))}</span><p>${e(b.note)}</p></div></li>`).join('')}</ol>` : '';
    const specLogic = s.logic?.length ? `<h4>逻辑规则</h4><ul class="logic-list">${s.logic.map(x => `<li>${e(x)}</li>`).join('')}</ul>` : '';
    const requirementItems = s.requirements.map(rid => {
      const r = reqById.get(rid);
      const keys = [];
      function collect(bs) { for (const b of bs) { if (b.requirement === rid) keys.push(b.id); if (b.children) collect(b.children); } }
      collect(s.blocks);
      return `<li data-target="${e(keys.join(','))}"><strong>${r ? e(r.id) : '待确认'}</strong>：${r ? e(r.text) : 'PRD 未说明清楚，不能自行补齐'}${r ? `<blockquote>${e(r.quote)}</blockquote>` : ''}</li>`;
    }).join('');
    const annotations = s.annotations || [];
    const overlays = annotations.map((a, i) => {
      const n = i + 1, key = `shot-${s.id}-${n}`, parts = [];
      if (a.rect) parts.push(`<div class="shot-pin" data-comp="${e(key)}" style="left:${a.rect[0]}%;top:${a.rect[1]}%;width:${a.rect[2]}%;height:${a.rect[3]}%" title="${e(a.change)}"><span>${n}</span></div>`);
      if (a.pin) parts.push(`<div class="shot-dot" data-comp="${e(key)}" style="left:${a.pin[0]}%;top:${a.pin[1]}%" title="${e(a.change)}">${a.rect ? '' : `<span>${n}</span>`}</div>`);
      return parts.join('');
    }).join('');
    const arrowLines = annotations.map(a => {
      if (!a.arrow) return '';
      const from = a.rect ? [a.rect[0] + a.rect[2] / 2, a.rect[1] + a.rect[3] / 2] : a.pin;
      return `<line x1="${from[0]}" y1="${from[1]}" x2="${a.arrow[0]}" y2="${a.arrow[1]}" class="shot-arrow" marker-end="url(#arrow-${e(s.id)})"/>`;
    }).join('');
    const arrowSvg = arrowLines ? `<svg class="shot-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><defs><marker id="arrow-${e(s.id)}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="shot-arrowhead"/></marker></defs>${arrowLines}</svg>` : '';
    const shotHTML = s.screenshot ? `<div class="screenshot"><img src="${imageMap.get(s.id)}" alt="${e(s.page)} · ${e(s.screenshot.actualState)} 实际截图">${arrowSvg}${overlays}</div><p class="shot-caption">实际状态：${e(s.screenshot.actualState)}<br>来源：${e(s.screenshot.source)} · ${e(s.screenshot.capturedAt)}${s.screenshot.url ? `<br>${e(s.screenshot.url)}` : ''}</p>` : `<div class="missing-shot"><strong>${s.blockedReason ? '截图阻塞' : '尚未接入截图'}</strong><span>${e(s.blockedReason || '请按本屏复现方式运行产品，或导入手动截图。')}</span></div>`;
    const prev = ordered[num - 2], next = ordered[num];
    const nav = `<nav class="screen-nav" aria-label="流程位置">${prev ? `<a class="prev" href="${e(hrefTo(prev.id, g.id))}">◀ 上一屏：${e(prev.page)} · ${e(prev.state)}</a>` : '<span></span>'}<span class="muted">第 ${num} / ${ordered.length} 屏</span>${next ? `<a class="next" href="${e(hrefTo(next.id, g.id))}">下一屏：${e(next.page)} · ${e(next.state)} ▶</a>` : '<span class="muted">流程终点</span>'}</nav>`;
    return `<article class="screen" id="screen-${e(s.id)}"><header class="screen-header"><div><div class="eyebrow">${String(num).padStart(2, '0')} / ${e(g.title)} · 第 ${si + 1} 步，共 ${g.screens.length} 步</div><h3>${e(s.page)}</h3><span class="badge">当前状态：${e(s.state)}</span><span class="muted">${e(s.id)}</span></div><div>${changeLabel ? `<span class="badge ${changeLabel.includes('改动') || changeLabel.includes('新增') ? 'changed' : ''}">${e(changeLabel)}</span>` : ''}</div></header><div class="screen-meta"><strong>复现方式</strong><ol>${s.reproduce.map(x => `<li>${e(x)}</li>`).join('')}</ol>${s.changeSummary ? `<p><strong>本轮改动：</strong>${e(s.changeSummary)}</p>` : ''}</div><div class="proto-with-spec"><div class="comparison ${m.mode}">${m.mode === 'review' ? `<section><div class="column-heading">实际产品 · ${s.screenshot ? '已采集' : '待采集'}</div>${shotHTML}</section>` : ''}<section><div class="column-heading">低保真原型 · 设计原意</div><div class="wireframe"><div class="wf-screenbar"><strong>${e(s.page)}</strong><span>状态：${e(s.state)}</span></div>${renderBlocks(s.blocks, s, link, noteIdx)}</div></section></div><aside class="spec-panel"><h4>原型说明</h4>${specIntro}${specLayout}${compNotesHTML}${specLogic}${annotations.length ? `<h4>原逻辑与修改点</h4><ol class="anno-list">${annotations.map((a, i) => `<li class="anno" data-target="${e([a.component, ...(a.rect || a.pin ? [`shot-${s.id}-${i + 1}`] : [])].join(','))}"><div class="anno-head"><span class="anno-num">${i + 1}</span><strong>${e(a.requirement)}</strong></div><div class="anno-row"><span class="anno-label">原逻辑</span><span>${e(a.original)}</span></div><div class="anno-row"><span class="anno-label">修改点</span><span>${e(a.change)}</span></div></li>`).join('')}</ol>` : ''}<h4>可执行操作与跳转</h4><ul class="flow-actions">${s.actions.length ? s.actions.map(a => `<li class="flow-action"><div class="fa-head"><strong>${e(a.label)}</strong>${a.role === 'primary' ? '<span class="fa-role">主操作</span>' : ''}</div><div class="fa-to">→ ${a.to && a.to !== '待确认' ? `<a href="${e(hrefTo(a.to, g.id))}">${e(screenById.get(a.to).page)} · ${e(screenById.get(a.to).state)}</a>` : e(a.to === '待确认' ? '待确认' : '当前状态 / 流程结束')}</div><div class="fa-outcome">${e(a.outcome)}</div></li>`).join('') : '<li>本状态无可执行操作</li>'}</ul>${(s.transitions || []).length ? `<h4>自动状态流转</h4><ul>${s.transitions.map(t => `<li>${e(t.condition)} → ${t.to === '待确认' ? '待确认' : `<a href="${e(hrefTo(t.to, g.id))}">${e(screenById.get(t.to).page)} · ${e(screenById.get(t.to).state)}</a>`}</li>`).join('')}</ul>` : ''}${s.pending.length ? `<div class="pending-list"><h4>待确认</h4><ul>${s.pending.map(x => `<li>${e(x)}</li>`).join('')}</ul></div>` : ''}<details class="prd-ref"><summary>PRD 依据（${s.requirements.length} 条，可追溯原文）</summary><ul>${requirementItems}</ul></details></aside></div>${nav}${feedback(s.id, 'screen', `${s.page} / ${s.state}`, history)}</article>`;
  }

  function sidebar(current) {
    const groupsNav = m.groups.map((g, i) => `<nav class="toc-group" aria-label="${e(g.title)}"><a href="${g.id === current ? '#' : fileOf(g.id)}">${String(i + 1).padStart(2, '0')} ${e(g.title)}</a>${g.screens.map(s => `<a class="toc-item" href="${e(hrefTo(s.id, current))}">${e(s.page)} · ${e(s.state)}</a>`).join('')}</nav>`).join('');
    return `<aside class="toc-sidebar"><div class="brand">PM DRAW</div><div class="muted">PRD → 原型 → 走查</div><p class="muted">第 ${m.round} 轮 · ${modeLabel}</p><nav class="toc-group"><a href="${current === 'index' ? '#' : 'index.html'}">总索引</a></nav>${groupsNav}</aside>`;
  }
  const shell = (title, current, main) => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; base-uri 'none'; form-action 'none'"><title>${e(title)}</title>${marker('theme')}${marker('shared')}</head><body><div class="workspace">${sidebar(current)}<main>${main}</main></div><script id="pm-data" type="application/json">${json({ ...model, page: current })}</script>${marker('highlight')}${marker('review')}</body></html>`;

  function groupCard(g, i) {
    const shots = g.screens.filter(s => s.screenshot).length;
    const items = g.screens.map(s => {
      const changeLabel = labelOf.get(s.id);
      return `<li><a href="${e(fileOf(g.id))}#screen-${e(s.id)}">${e(s.page)} · ${e(s.state)}</a> <span class="muted">${e(s.id)}</span>${changeLabel ? ` <span class="badge ${changeLabel.includes('改动') || changeLabel.includes('新增') ? 'changed' : ''}">${e(changeLabel)}</span>` : ''}${s.pending.length ? ` <span class="badge warn">待确认 ${s.pending.length}</span>` : ''}</li>`;
    }).join('');
    return `<section class="flow-group" id="group-${e(g.id)}"><div class="group-title"><span class="group-number">${String(i + 1).padStart(2, '0')}</span><div><h2><a href="${e(fileOf(g.id))}">${e(g.title)}</a></h2>${g.description ? `<p class="muted">${e(g.description)}</p>` : ''}<p class="muted">${g.screens.length} 个页面状态${m.mode === 'review' ? ` · 截图 ${shots} / ${g.screens.length}` : ''} · <a href="${e(fileOf(g.id))}">进入本组 →</a></p></div></div><ul>${items}</ul></section>`;
  }

  const reviewNotice = m.mode === 'review' ? `<div class="notice">已接入 ${imageMap.size} / ${ordered.length} 张实际截图。${imageMap.size < ordered.length ? '走查材料尚未齐全，缺失页面保留待采集或阻塞说明。' : '分组页面左侧为实际产品，右侧为设计原意与原型说明。'}</div>` : '';
  const indexMain = `<header class="intro"><div class="eyebrow">${eyebrow} · 总索引</div><h1>${e(m.project.title)}</h1><p class="muted">${m.groups.length} 个流程 · ${ordered.length} 个页面状态 · 第 ${m.round} 轮 ${prdBadge}</p><p>方案按功能流程分组拆分：本页是总索引，每个流程分组一个独立页面，便于评审和后续修改时快速定位。线框仅表达信息层级、核心文案与操作关系；每屏右侧为原型说明（页面、布局、组件、逻辑规则与操作跳转），PRD 原文折叠在「PRD 依据」中可追溯；未明确内容标为「待确认」。</p>${prdNotice}${reviewNotice}${toolbar}</header>${m.groups.map((g, i) => groupCard(g, i)).join('')}${history.length ? `<details class="history-archive"><summary>全部历史反馈原话（含已移出本轮的页面）</summary>${history.map(h => `<h3>第 ${h.round} 轮</h3>${h.groups.map(g => `<h4>${e(g.title)}</h4><pre class="verbatim">问题：${e(g.problem)}\n建议：${e(g.suggestion)}</pre>`).join('')}${h.screens.map(s => `<h4>${e(s.page)} · ${e(s.state)} · ${e(s.mark || '未标记')}</h4><pre class="verbatim">问题：${e(s.problem)}\n建议：${e(s.suggestion)}</pre>`).join('')}`).join('')}</details>` : ''}<details class="prd-document"><summary>查看本轮 PRD 原文</summary><pre>${e(prdText)}</pre></details>${footer}`;
  const files = { 'index.html': await injectAssets(shell(`${m.project.title} · 第 ${m.round} 轮`, 'index', indexMain)) };
  for (const [gi, g] of m.groups.entries()) {
    const main = `<header class="intro"><div class="eyebrow">${eyebrow} · 流程 ${String(gi + 1).padStart(2, '0')} / ${m.groups.length}</div><h1>${e(g.title)}</h1><p class="muted"><a href="index.html">${e(m.project.title)} · 总索引</a> · 本组 ${g.screens.length} 个页面状态 · 第 ${m.round} 轮 ${prdBadge}</p>${g.description ? `<p>${e(g.description)}</p>` : ''}${prdNotice}${toolbar}</header>${g.screens.map((s, si) => renderScreen(g, s, si)).join('')}${feedback(g.id, 'group', g.title, history)}${footer}`;
    files[fileOf(g.id)] = await injectAssets(shell(`${m.project.title} · ${g.title} · 第 ${m.round} 轮`, g.id, main));
  }
  return files;
}
