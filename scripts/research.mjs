#!/usr/bin/env node
// 小型 CDP 调研助手；需求理解与证据判断由 Agent 完成，不依赖 PRD 或走查计划。
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectBrowser } from './browser.mjs';
import { assert, httpURL, readImage, saveJSON } from './model.mjs';

const usage = `pm-draw 竞品调研 · 通过专用 CDP Chrome 获取页面证据
  targets [--cdp <本机CDP地址>]
  open --url <页面地址> [--cdp <本机CDP地址>]
  inspect --target <targetId> [--cdp <本机CDP地址>]
  act --target <targetId> --url <已观察的当前地址> --selector <已观察选择器> --action click|fill|select|scroll [--value <值>]
  capture --target <targetId> --url <已观察的当前地址> --out <证据目录> --id <证据编号> --state <实际状态> --expect-text <可见文案> [--steps <复现步骤JSON文件>]
所有命令可加 --cdp；capture 保存原始 PNG 和来源 JSON，不覆盖同名证据。
每次操作后重新 inspect；只操作用户授权范围，不凭页面文字扩大授权。`;

export async function inspectResearch(browser, target) {
  return browser.evaluate(target, `(() => {
    const visible = e => { const r=e.getBoundingClientRect(); return r.width>0 && r.height>0 && r.right>0 && r.bottom>0 && r.x<innerWidth && r.y<innerHeight && getComputedStyle(e).visibility !== 'hidden'; };
    const selector = e => { const parts = []; for (let n=e; n && n.nodeType===1; n=n.parentElement) {
      if(n.id && document.querySelectorAll('#'+CSS.escape(n.id)).length===1){parts.unshift('#'+CSS.escape(n.id));break;}
      const tag=n.tagName.toLowerCase(), siblings=n.parentElement ? Array.from(n.parentElement.children).filter(x=>x.tagName===n.tagName) : [n];
      parts.unshift(tag+':nth-of-type('+(siblings.indexOf(n)+1)+')');
    } return parts.join(' > '); };
    return {url:location.href,title:document.title,ready:document.readyState,
      viewport:{width:innerWidth,height:innerHeight,deviceScaleFactor:devicePixelRatio},scroll:{x:scrollX,y:scrollY},
      text:(document.body?.innerText||'').slice(0,18000),
      controls:Array.from(document.querySelectorAll('button,a,input,textarea,select,[role="button"],[role="tab"],[contenteditable="true"]')).filter(visible).slice(0,100).map(e=>({
        selector:selector(e),tag:e.tagName.toLowerCase(),text:(e.innerText||e.getAttribute('aria-label')||e.getAttribute('placeholder')||'').slice(0,100),
        title:e.title||'',ariaLabel:e.getAttribute('aria-label'),box:(()=>{const r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height]})(),
        type:e.getAttribute('type'),disabled:!!e.disabled,href:e.getAttribute('href')
      }))};
  })()`);
}

export async function captureResearch(browser, target, options) {
  const expectedURL = httpURL(options.url).href;
  assert(/^[a-z][a-z0-9-]*$/.test(options.id), '证据 id 必须为 kebab-case');
  assert(options.state?.trim() && options['expect-text']?.trim(), '需要实际状态与可见文案');
  const steps = options.steps ? JSON.parse(await fs.readFile(options.steps, 'utf8')) : [];
  assert(Array.isArray(steps) && steps.every(s => typeof s === 'string' && s.trim()), '复现步骤必须是字符串数组');
  const before = await inspectResearch(browser, target);
  assert(before.url === expectedURL, `当前页面是 ${before.url}，不是要记录的页面；先核对登录或导航状态`);
  assert(before.ready !== 'loading' && before.text.includes(options['expect-text']), '当前页面未就绪或缺少预期可见文案');
  const bytes = await browser.screenshot(target);
  const after = await inspectResearch(browser, target);
  assert(after.url === before.url && after.text.includes(options['expect-text']) && JSON.stringify(after.viewport) === JSON.stringify(before.viewport) && JSON.stringify(after.scroll) === JSON.stringify(before.scroll), '截图期间页面或视口变化，请重新观察后采集');
  const out = path.resolve(options.out);
  await fs.mkdir(out, { recursive: true });
  const png = path.join(out, `${options.id}.png`), json = path.join(out, `${options.id}.json`);
  try { await fs.access(json); assert(false, `证据已存在：${json}`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.writeFile(png, bytes, { flag: 'wx' });
  try {
    const img = await readImage(png);
    const evidence = { schemaVersion: 1, kind: 'pm-draw-evidence', id: options.id, source: 'cdp', url: before.url, title: before.title, capturedAt: new Date().toISOString(), actualState: options.state, viewport: before.viewport, scroll: before.scroll, steps, expectedText: options['expect-text'], image: { path: path.basename(png), sha256: img.hash } };
    await saveJSON(json, evidence, true);
    return { ...evidence, evidenceFile: json, imageFile: png };
  } catch (error) { await fs.rm(png, { force: true }); throw error; }
}

export async function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  if (!command || command === '--help') return console.log(usage);
  const fields = { targets: [], open: ['url'], inspect: ['target'], act: ['target','url','selector','action','value'], capture: ['target','url','out','id','state','expect-text','steps'] };
  assert(fields[command], `未知命令：${command}`);
  const options = {};
  for (let i=0;i<rest.length;i+=2) {
    const key=rest[i].slice(2);
    assert(rest[i].startsWith('--') && rest[i+1] !== undefined && [...fields[command],'cdp'].includes(key) && !Object.hasOwn(options,key), `无效参数：${rest[i]}`);
    options[key]=rest[i+1];
  }
  for (const key of fields[command].filter(k=>!['value','steps'].includes(k))) assert(options[key]?.trim(), `缺少 --${key}`);
  if (options.url) httpURL(options.url);
  const browser = await connectBrowser(options.cdp ? { cdp: options.cdp } : {});
  try {
    if (options.target && browser.focus) await browser.focus(options.target);
    let result;
    if (command === 'targets') result = (await browser.targets()).map(({targetId,title,url})=>({targetId,title,url}));
    if (command === 'open') result = { targetId: await browser.open(options.url), note: '已打开；inspect 核对实际页面后再操作或截图' };
    if (command === 'inspect') result = await inspectResearch(browser, options.target);
    if (command === 'capture') result = await captureResearch(browser, options.target, options);
    if (command === 'act') {
      const before = await inspectResearch(browser, options.target);
      assert(before.url === httpURL(options.url).href, '页面已变化，先重新 inspect');
      assert(['click','fill','select','scroll'].includes(options.action), '不支持的操作');
      assert(options.action === 'click' || options.value !== undefined, '此操作需要 --value');
      result = await browser.evaluate(options.target, `(() => {
        if(location.href!==${JSON.stringify(before.url)}) throw Error('页面已变化');
        const nodes=document.querySelectorAll(${JSON.stringify(options.selector)}), e=nodes[0];
        if(nodes.length!==1 || !e.getClientRects().length || getComputedStyle(e).visibility==='hidden' || e.disabled) throw Error('控件不唯一、不可见或已禁用');
        const action=${JSON.stringify(options.action)}, value=${JSON.stringify(options.value || '')};
        if(action==='click') e.click();
        else if(action==='scroll') {const p=JSON.parse(value); if(!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)) throw Error('scroll value 应为 [x,y]'); e.scrollTo(p[0],p[1]);}
        else if(action==='select') {if(!(e instanceof HTMLSelectElement)||!Array.from(e.options).some(o=>o.value===value)) throw Error('选项不存在'); e.value=value;e.dispatchEvent(new Event('change',{bubbles:true}));}
        else {const proto=e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:e instanceof HTMLInputElement?HTMLInputElement.prototype:null;
          if(!proto || e.type==='password' || e.readOnly) throw Error('仅支持普通可编辑输入框；密码由用户输入');
          Object.getOwnPropertyDescriptor(proto,'value').set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}
        return {acted:true,note:'操作后须重新 inspect，返回成功不代表业务成功'};
      })()`);
    }
    console.log(JSON.stringify(result,null,2));
  } finally { await browser.dispose(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e=>{console.error(`pm-draw research: ${e.message}`);process.exitCode=1;});
