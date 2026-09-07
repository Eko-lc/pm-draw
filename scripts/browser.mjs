// web-access 浏览器发现 + HTTP Proxy 协议；内置 CDP 路径无需安装其他 Skill。
import { selectBrowser } from './browser-discovery.mjs';
import { ensureDedicatedChrome } from './dedicated-chrome.mjs';
import { assert } from './model.mjs';

function localEndpoint(value, protocols) {
  const url = new URL(value);
  assert(protocols.includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), '浏览器控制端点必须是本机回环地址');
  return url;
}
async function fetchTimed(url, options) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`浏览器请求失败 ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return response;
}
async function proxyClient(endpoint) {
  const base = localEndpoint(endpoint, ['http:']);
  async function request(route, target, body, raw = false) {
    const url = new URL(route, base);
    if (target) url.searchParams.set('target', target);
    const res = await fetchTimed(url, body === undefined ? {} : { method: 'POST', body, headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
    if (raw) return Buffer.from(await res.arrayBuffer());
    const data = await res.json(); assert(!data.error, data.error); return data;
  }
  return {
    source: 'web-access',
    targets: () => request('/targets'),
    open: async url => (await request('/new', null, url)).targetId,
    evaluate: async (target, expression) => (await request('/eval', target, expression)).value,
    screenshot: target => request('/screenshot', target, undefined, true),
    dispose: async () => {},
  };
}

async function websocketURL(options) {
  if (options.cdp) {
    const u = localEndpoint(options.cdp, ['http:', 'ws:']);
    if (u.protocol === 'ws:') return u.href;
    const version = await (await fetchTimed(new URL('/json/version', u))).json();
    return localEndpoint(version.webSocketDebuggerUrl, ['ws:']).href;
  }
  // 默认路径固定使用独立 user-data-dir 的 CDP Chrome；只有显式 --browser 才连接日常浏览器。
  if (!options.browser) return websocketURL({ cdp: await ensureDedicatedChrome() });
  const selected = await selectBrowser(options.browser || null);
  if (selected.kind === 'ok') {
    const b = selected.browser;
    if (b.wsPath) return `ws://127.0.0.1:${b.port}${b.wsPath}`;
    return websocketURL({ cdp: `http://127.0.0.1:${b.port}` });
  }
  if (selected.kind === 'mismatch') throw new Error(`指定浏览器 ${options.browser || selected.configured} 未开启远程调试，不能切换到其他浏览器。可改用手动截图。`);
  if (selected.kind === 'ambiguous') throw new Error(`请用 --browser 指定本次浏览器：${selected.detected.map(b => b.id).join(', ')}，或提供 --cdp / --proxy。`);
  throw new Error('指定浏览器未提供可连接的远程调试端点；可省略 --browser 使用专用 CDP Chrome。');
}

export async function connectBrowser(options = {}) {
  if (options.proxy) return proxyClient(options.proxy);
  const socket = new WebSocket(await websocketURL(options));
  const pending = new Map(), sessions = new Map();
  let sequence = 0;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('连接浏览器超时')); }, 12000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('浏览器连接失败')); }, { once: true });
  });
  socket.addEventListener('message', event => {
    const msg = JSON.parse(event.data), item = pending.get(msg.id);
    if (!item) return;
    clearTimeout(item.timer); pending.delete(msg.id);
    if (msg.error) item.reject(new Error(msg.error.message)); else item.resolve(msg.result);
  });
  socket.addEventListener('close', () => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('浏览器连接已断开')); } pending.clear(); });
  function send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP 超时：${method}`)); }, 20000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  async function attach(targetId) {
    if (!sessions.has(targetId)) {
      const result = await send('Target.attachToTarget', { targetId, flatten: true });
      sessions.set(targetId, result.sessionId);
    }
    return sessions.get(targetId);
  }
  return {
    source: 'cdp',
    targets: async () => (await send('Target.getTargets')).targetInfos.filter(t => t.type === 'page'),
    open: async url => (await send('Target.createTarget', { url, background: true })).targetId,
    focus: async target => { await send('Target.activateTarget', { targetId: target }); },
    evaluate: async (target, expression) => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, await attach(target));
      assert(!result.exceptionDetails, result.exceptionDetails?.exception?.description || '页面脚本执行失败');
      return result.result.value;
    },
    screenshot: async target => {
      const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, await attach(target));
      return Buffer.from(result.data, 'base64');
    },
    setViewport: async (target, { width, height, deviceScaleFactor = 1, mobile = false }) => {
      assert(Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0 && Number.isFinite(deviceScaleFactor) && deviceScaleFactor > 0 && typeof mobile === 'boolean', '视口尺寸、像素比或 mobile 参数无效');
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile }, await attach(target));
    },
    clearViewport: async target => { await send('Emulation.clearDeviceMetricsOverride', {}, await attach(target)); },
    dispose: async () => {
      try { for (const sessionId of sessions.values()) if (socket.readyState === WebSocket.OPEN) await send('Target.detachFromTarget', { sessionId }); }
      finally { socket.close(); }
    },
  };
}

export async function inspectTarget(browser, target, s, m) {
  assert(target, '缺少 --target；先通过 open 或浏览器工具运行真实流程');
  const info = await browser.evaluate(target, `(() => {
    const selector = ${JSON.stringify(s.capture?.expectSelector || '')};
    const element = selector ? document.querySelector(selector) : null;
    const style = element ? getComputedStyle(element) : null;
    return { url: location.href, title: document.title, ready: document.readyState,
      text: document.body?.innerText || '', viewport: {width: innerWidth, height: innerHeight, deviceScaleFactor: devicePixelRatio},
      selectorFound: !!element && !!element.getClientRects().length && style.visibility !== 'hidden' && style.display !== 'none' };
  })()`);
  assert(info && info.url, '无法读取目标页面');
  const expected = new URL(s.url || m.target.url), actual = new URL(info.url);
  assert(actual.origin === expected.origin && (!s.url || (actual.pathname === expected.pathname && actual.search === expected.search && actual.hash === expected.hash)), `实际页面 ${info.url} 与计划地址不匹配；不能把登录页或错误页当作目标截图`);
  return info;
}
