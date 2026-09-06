// 本机反馈保存服务：接收生成页面的“保存反馈”请求，只写入该 HTML 所在目录。
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assert, saveJSON, validateReport } from './model.mjs';
import { checkPort } from './browser-discovery.mjs';

export const FEEDBACK_SERVER_PORT = 9224;
export const FEEDBACK_SERVER_URL = `http://127.0.0.1:${FEEDBACK_SERVER_PORT}`;
const SERVER_KIND = 'pm-draw-feedback-server';
const MAX_BODY_BYTES = 5 * 1024 * 1024;

function allowedOrigin(origin) {
  return !origin || origin === 'null' || /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(origin);
}

function sendJSON(response, status, value, origin = null) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json;charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  if (origin && allowedOrigin(origin)) response.setHeader('Access-Control-Allow-Origin', origin);
  response.end(JSON.stringify(value));
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    assert(size <= MAX_BODY_BYTES, '反馈 JSON 超过 5 MB');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function sameIds(actual, expected) {
  return actual.length === expected.length && new Set(actual).size === actual.length && expected.every(id => actual.includes(id));
}

export async function saveFeedbackPayload(payload) {
  assert(payload && typeof payload === 'object', '缺少反馈对象');
  const pageURL = new URL(payload.pageUrl);
  assert(pageURL.protocol === 'file:', '反馈页面必须从本地 HTML 文件打开');
  pageURL.hash = ''; pageURL.search = '';
  const pageFile = path.resolve(fileURLToPath(pageURL));
  assert(path.extname(pageFile).toLowerCase() === '.html', '反馈来源不是 HTML 文件');
  const html = await fs.readFile(pageFile, 'utf8');
  const match = html.match(/<script id="pm-data" type="application\/json">(.*?)<\/script>/s);
  assert(match, '反馈来源不是 pm-draw 生成页面');
  const model = JSON.parse(match[1]), report = payload.feedback;
  assert(typeof model.projectId === 'string' && /^[a-z][a-z0-9-]*$/.test(model.projectId), '页面项目编号无效');
  validateReport(report, model.projectId);
  assert(report.round === model.round && report.fingerprint === model.fingerprint, '反馈与当前页面版本不一致');
  assert(sameIds(report.screens.map(item => item.id), model.screens.map(item => item.id)), '反馈页面清单不完整');
  assert(sameIds(report.groups.map(item => item.id), model.groups.map(item => item.id)), '反馈流程清单不完整');
  const output = path.join(path.dirname(pageFile), `${report.projectId}-round-${report.round}-feedback.json`);
  await saveJSON(output, report);
  return { output, fileName: path.basename(output) };
}

export function createFeedbackServer() {
  return http.createServer(async (request, response) => {
    const origin = request.headers.origin || null;
    try {
      assert(allowedOrigin(origin), '不允许该网页调用反馈保存服务');
      const url = new URL(request.url || '/', FEEDBACK_SERVER_URL);
      if (request.method === 'OPTIONS') {
        response.statusCode = 204;
        if (origin) response.setHeader('Access-Control-Allow-Origin', origin);
        response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        response.end(); return;
      }
      if (request.method === 'GET' && url.pathname === '/health') {
        sendJSON(response, 200, { kind: SERVER_KIND }, origin); return;
      }
      assert(request.method === 'POST' && url.pathname === '/feedback', '接口不存在');
      const saved = await saveFeedbackPayload(JSON.parse(await readBody(request)));
      sendJSON(response, 200, { ok: true, fileName: saved.fileName }, origin);
    } catch (error) {
      sendJSON(response, 400, { ok: false, error: error.message }, origin);
    }
  });
}

async function isFeedbackServer() {
  try {
    const response = await fetch(`${FEEDBACK_SERVER_URL}/health`, { signal: AbortSignal.timeout(800) });
    return response.ok && (await response.json()).kind === SERVER_KIND;
  } catch { return false; }
}

export async function ensureFeedbackServer() {
  if (await isFeedbackServer()) return FEEDBACK_SERVER_URL;
  if (await checkPort(FEEDBACK_SERVER_PORT, '127.0.0.1', 500)) throw new Error(`端口 ${FEEDBACK_SERVER_PORT} 已被其他服务占用，页面反馈无法保存`);
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url)], { detached: true, stdio: 'ignore' });
  child.unref();
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await isFeedbackServer()) return FEEDBACK_SERVER_URL;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('页面反馈保存服务启动失败');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createFeedbackServer();
  server.on('error', error => { console.error(`pm-draw feedback server: ${error.message}`); process.exitCode = 1; });
  server.listen(FEEDBACK_SERVER_PORT, '127.0.0.1');
}
