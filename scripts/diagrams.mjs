// Mermaid 源码保留在 PRD 或 flow；这里只校验结构，语法由浏览器中的 Mermaid 校验。
const check = (ok, message) => { if (!ok) throw new Error(message); };
const nonempty = value => typeof value === 'string' && value.trim();
const validId = value => typeof value === 'string' && /^[a-z][a-z0-9-]*$/.test(value);

export function validateDiagramSource(source, label) {
  check(nonempty(source), `${label} 的 Mermaid source 必须是非空字符串`);
  check(source.length <= 50000, `${label} 的 Mermaid source 过长，请按任务拆图（最多 50000 字符）`);
  const body = source.replace(/^\s*%%[^\n]*$/gm, '').trim();
  check(/^(?:flowchart\s+(?:TB|TD|BT|RL|LR)\b|graph\s+(?:TB|TD|BT|RL|LR)\b|sequenceDiagram\b|stateDiagram-v2\b)/.test(body), `${label} 使用 flowchart / graph、sequenceDiagram 或 stateDiagram-v2`);
  check(!/%%\s*\{/.test(source), `${label} 不支持 Mermaid 配置指令，请使用统一的离线主题`);
}

// 只识别顶层围栏，跳过其他语言的代码块，避免把示例中的 Mermaid 再当成真实图。
// 标准 mermaid 围栏前可加 <!-- pm-draw:diagram save-flow -->，供 flow 稳定引用。
export function extractPrdDiagrams(prdText) {
  const lines = prdText.split(/\r?\n/), diagrams = [], ids = new Set();
  let heading = '', anchor;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const marker = line.match(/^ {0,3}<!--\s*pm-draw:diagram\s+([^\s]+)\s*-->\s*$/);
    if (marker) { anchor = marker[1]; continue; }
    const fence = line.match(/^ {0,3}(`{3,}|~{3,})([^\r\n]*)$/);
    if (fence) {
      const start = i, code = [];
      const close = new RegExp(`^ {0,3}${fence[1][0]}{${fence[1].length},}\\s*$`);
      while (++i < lines.length && !close.test(lines[i])) code.push(lines[i]);
      if (fence[2].trim() === 'mermaid') {
        const id = anchor || `prd-diagram-${diagrams.length + 1}`;
        check(validId(id), `PRD 图示编号 ${id} 必须是 kebab-case`);
        check(!ids.has(id), `PRD 图示编号重复：${id}`); ids.add(id);
        check(i < lines.length, `PRD 第 ${start + 1} 行 Mermaid 围栏未闭合`);
        const source = code.join('\n');
        validateDiagramSource(source, `PRD 图示 ${id}`);
        diagrams.push({ id, title: heading || `PRD 图示 ${diagrams.length + 1}`, source, line: start + 1 });
      }
      anchor = undefined;
      continue;
    }
    if (line.trim()) anchor = undefined;
    const title = line.match(/^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (title) heading = title[1];
  }
  return diagrams;
}

export function resolveDiagrams(items, label, prdDiagrams = []) {
  if (items === undefined) return [];
  check(Array.isArray(items), `${label}.diagrams 必须是数组`);
  const ids = new Set();
  return items.map(item => {
    check(item && typeof item === 'object' && !Array.isArray(item), `${label}.diagrams 条目必须是对象`);
    let diagram;
    if (Object.hasOwn(item, 'prd')) {
      check(Object.keys(item).every(k => k === 'prd'), `${label} 的 PRD 图示引用只填写 prd，不复制 title / source`);
      check(validId(item.prd), `${label}.diagrams.prd 必须是 PRD 图示编号`);
      diagram = prdDiagrams.find(d => d.id === item.prd);
      check(diagram, `${label} 引用了不存在的 PRD 图示：${item.prd}`);
    } else {
      check(Object.keys(item).every(k => ['id', 'title', 'source', 'description'].includes(k)), `${label} 的图示只支持 id / title / source / description`);
      check(validId(item.id), `${label} 的图示 id 必须是 kebab-case`);
      check(nonempty(item.title), `${label} 的图示 title 必须是非空字符串`);
      if (item.description !== undefined) check(nonempty(item.description), `${label} 的图示 description 必须是非空字符串`);
      validateDiagramSource(item.source, `${label} 图示 ${item.id}`);
      diagram = item;
    }
    check(!ids.has(diagram.id), `${label} 的图示编号重复：${diagram.id}`); ids.add(diagram.id);
    return diagram;
  });
}
