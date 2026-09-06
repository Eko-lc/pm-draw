/* 本地反馈运行时。项目 + 轮次隔离；历史只读；文本原样保存。 */
(() => {
  'use strict';
  const model = JSON.parse(document.getElementById('pm-data').textContent);
  const key = `pm-draw:v1:${model.projectId}:round-${model.round}`;
  const status = document.getElementById('save-status');
  let storageConflict = false;
  const current = { schemaVersion: 1, kind: 'pm-draw-feedback', projectId: model.projectId, projectTitle: model.projectTitle, round: model.round, fingerprint: model.fingerprint, exportedAt: null, screens: model.screens.map(s => ({ ...s, mark: '', problem: '', suggestion: '' })), groups: model.groups.map(g => ({ ...g, problem: '', suggestion: '' })) };
  const notice = (text, error = false) => { status.textContent = text; status.dataset.error = String(error); };
  function valid(value) {
    return value?.kind === current.kind && value.schemaVersion === 1 && value.projectId === current.projectId && value.round === current.round && value.fingerprint === current.fingerprint &&
      Array.isArray(value.screens) && value.screens.length === current.screens.length && new Set(value.screens.map(s => s.id)).size === current.screens.length && value.screens.every(s => current.screens.some(x => x.id === s.id) && ['', '符合预期', '需要调整', '严重问题'].includes(s.mark) && typeof s.problem === 'string' && typeof s.suggestion === 'string') &&
      Array.isArray(value.groups) && value.groups.length === current.groups.length && new Set(value.groups.map(g => g.id)).size === current.groups.length && value.groups.every(g => current.groups.some(x => x.id === g.id) && typeof g.problem === 'string' && typeof g.suggestion === 'string');
  }
  function apply(value) {
    for (const type of ['screens', 'groups']) for (const record of current[type]) {
      const incoming = value[type].find(x => x.id === record.id);
      record.problem = incoming.problem; record.suggestion = incoming.suggestion;
      if (type === 'screens') record.mark = incoming.mark;
    }
  }
  function exportData() { return { ...current, exportedAt: new Date().toISOString(), history: model.history }; }
  function save() {
    if (storageConflict) return notice('检测到同轮其他版本的反馈，已保留原数据。请导出当前 JSON，再用新轮次继续。', true);
    try { localStorage.setItem(key, JSON.stringify(exportData())); notice('反馈已自动保存在此浏览器 · ' + new Date().toLocaleTimeString()); }
    catch { notice('本地保存失败（可能空间不足或浏览器禁用存储）。请立即导出 JSON 备份。', true); }
  }
  function sync() {
    for (const area of document.querySelectorAll('[data-feedback]')) {
      const records = area.dataset.kind === 'group' ? current.groups : current.screens;
      const record = records.find(x => x.id === area.dataset.feedback);
      for (const input of area.querySelectorAll('textarea[data-field]')) input.value = record[input.dataset.field];
      for (const button of area.querySelectorAll('[data-mark]')) button.setAttribute('aria-pressed', String(record.mark === button.dataset.mark));
    }
    const marked = current.screens.filter(s => s.mark).length, inGroup = model.page && model.page !== 'index' ? current.screens.filter(s => s.groupId === model.page) : null;
    document.getElementById('progress').textContent = inGroup ? `本组已标记 ${inGroup.filter(s => s.mark).length} / ${inGroup.length} 屏 · 全部 ${marked} / ${current.screens.length} 屏` : `已标记 ${marked} / ${current.screens.length} 屏`;
  }
  try {
    const raw = localStorage.getItem(key);
    if (raw) { const stored = JSON.parse(raw); if (!valid(stored)) { storageConflict = true; notice('本地存在其他版本的同轮反馈，已保留且暂停覆盖。请从旧 HTML 导出反馈，再创建下一轮。', true); } else { apply(stored); notice('已恢复本轮本地反馈'); } }
    else { localStorage.setItem(key, JSON.stringify(exportData())); notice('自动保存已就绪 · 仅保存在此浏览器，请及时导出备份'); }
  } catch { storageConflict = true; notice('本地存储不可用或数据损坏，未覆盖原数据。当前反馈请使用 JSON 导出保存。', true); }
  sync();
  for (const area of document.querySelectorAll('[data-feedback]')) {
    const record = (area.dataset.kind === 'group' ? current.groups : current.screens).find(x => x.id === area.dataset.feedback);
    area.addEventListener('input', event => { if (!event.target.matches('textarea[data-field]')) return; record[event.target.dataset.field] = event.target.value; save(); });
    area.addEventListener('click', event => { const button = event.target.closest('[data-mark]'); if (!button) return; record.mark = record.mark === button.dataset.mark ? '' : button.dataset.mark; sync(); save(); });
  }
  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a'); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  function verbatim(text) { const runs = text.match(/`+/g) || []; const fence = '`'.repeat(Math.max(3, ...runs.map(x => x.length + 1))); return `${fence}text\n${text}\n${fence}`; }
  function markdownReport(report) {
    const lines = [`## 第 ${report.round} 轮`, ''];
    for (const g of report.groups) {
      lines.push(`### 流程：${g.title}`, '');
      for (const s of report.screens.filter(x => x.groupId === g.id)) {
        lines.push(`#### 页面：${s.page}`, `状态：${s.state} ｜ 标记：${s.mark || '未标记'} ｜ ${s.changeLabel || '无改动标记'}`, '', `页面编号：${s.id}`, '', '问题：', verbatim(s.problem), '', '建议：', verbatim(s.suggestion), '');
      }
      lines.push('流程问题：', verbatim(g.problem), '', '流程建议：', verbatim(g.suggestion), '');
    }
    return lines.join('\n');
  }
  document.getElementById('export-json').addEventListener('click', () => download(`${model.projectId}-round-${model.round}-feedback.json`, JSON.stringify(exportData(), null, 2), 'application/json;charset=utf-8'));
  document.getElementById('export-md').addEventListener('click', () => download(`${model.projectId}-round-${model.round}-feedback.md`, [`# ${model.projectTitle} · 走查反馈`, '', markdownReport(current), ...(model.history.length ? ['# 历史反馈原话（只读）', ...model.history.map(markdownReport)] : [])].join('\n\n'), 'text/markdown;charset=utf-8'));
  document.getElementById('import-json').addEventListener('click', () => document.getElementById('import-file').click());
  document.getElementById('import-file').addEventListener('change', async event => {
    try {
      const file = event.target.files[0]; if (!file) return;
      const imported = JSON.parse(await file.text());
      if (!valid(imported)) throw new Error('项目、轮次或页面版本不匹配。上一轮反馈请用 next-round 命令接入。');
      const hasInput = [...current.screens, ...current.groups].some(x => x.problem || x.suggestion || x.mark);
      if (hasInput && !confirm('导入将替换本轮输入，历史原话保持不变。请先导出备份。继续导入？')) return;
      apply(imported); sync(); save();
    } catch (error) { notice(`导入失败：${error.message}`, true); }
    finally { event.target.value = ''; }
  });
  // 多窗口同时走查时，不让旧窗口静默覆盖新输入。
  window.addEventListener('storage', event => { if (event.key === key) { storageConflict = true; notice('另一窗口修改了本轮反馈，已暂停覆盖。请导出当前输入后重新打开。', true); } });
  const observer = new IntersectionObserver(entries => { for (const entry of entries) if (entry.isIntersecting) { document.querySelectorAll('.toc-item').forEach(a => a.classList.toggle('active', a.hash === '#' + entry.target.id)); } }, { rootMargin: '-10% 0px -70% 0px' });
  document.querySelectorAll('.screen').forEach(s => observer.observe(s));
})();
