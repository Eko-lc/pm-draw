#!/usr/bin/env node
// 基于 proto-gen 的标记注入机制；校验整份文件成功后再写入。
import fs from 'node:fs/promises';
import path from 'node:path';
import { injectAssets } from '../scripts/render.mjs';
async function visit(file) {
  const stat = await fs.lstat(file);
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) { for (const name of await fs.readdir(file)) if (!name.startsWith('.')) await visit(path.join(file, name)); }
  else if (file.endsWith('.html')) {
    const old = await fs.readFile(file, 'utf8');
    const next = await injectAssets(old);
    if (old !== next) await fs.writeFile(file, next);
    console.log(file);
  }
}
try { if (!process.argv[2]) throw new Error('用法：node assets/inject-assets.mjs <HTML 或目录> [...]'); for (const f of process.argv.slice(2)) await visit(f); }
catch (error) { console.error(error.message); process.exitCode = 1; }
