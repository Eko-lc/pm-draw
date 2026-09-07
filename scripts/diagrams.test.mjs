import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractPrdDiagrams, resolveDiagrams, validateDiagramSource } from './diagrams.mjs';

test('提取标准 Mermaid 围栏：稳定编号、中文标题、CRLF、波浪围栏和其他语言隔离', () => {
  const prd = ['# PRD', '```json', '"```mermaid"', '```', '````markdown', '```mermaid', 'flowchart LR', 'A-->B', '```', '````', '### 保存资料', '<!-- pm-draw:diagram save-flow -->', '', '```mermaid', 'flowchart LR', '  form["资料"] --> result["已保存"]', '```', '### 更新顺序', '~~~mermaid', 'sequenceDiagram', '  用户->>页面: 保存', '~~~'].join('\r\n');
  const diagrams = extractPrdDiagrams(prd);
  assert.equal(diagrams.length, 2);
  assert.equal(diagrams[0].id, 'save-flow');
  assert.equal(diagrams[0].title, '保存资料');
  assert.equal(diagrams[0].source, 'flowchart LR\n  form["资料"] --> result["已保存"]');
  assert.equal(diagrams[0].line, 14);
  assert.equal(diagrams[1].id, 'prd-diagram-2');
  assert.equal(resolveDiagrams([{ prd: 'save-flow' }], 'group', diagrams)[0], diagrams[0]);
});

test('拒绝重复编号、未闭合围栏、空图以及配置覆盖，保留普通代码与旧文档兼容', () => {
  const source = '<!-- pm-draw:diagram flow -->\n```mermaid\nflowchart TD\n A-->B\n```\n';
  assert.throws(() => extractPrdDiagrams(source + source), /重复/);
  assert.throws(() => extractPrdDiagrams('```mermaid\nflowchart TD\nA-->B'), /未闭合/);
  assert.throws(() => extractPrdDiagrams('```mermaid\n\n```'), /非空/);
  assert.throws(() => validateDiagramSource('---\nconfig: {}\n---\nflowchart LR\nA-->B', 'test'));
  assert.throws(() => validateDiagramSource('flowchart LR\n%%{init:{}}%%\nA-->B', 'test'), /配置/);
  assert.deepEqual(extractPrdDiagrams('# 旧 PRD\n一般文字\n```js\nconst a = 1;\n```'), []);
  assert.doesNotThrow(() => validateDiagramSource('%% 注释\nstateDiagram-v2\n[*] --> 待提交', 'test'));
  assert.deepEqual(resolveDiagrams(undefined, 'screen'), []);
});
