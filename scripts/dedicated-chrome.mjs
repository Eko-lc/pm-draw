// pm-draw 默认使用的持久化 CDP Chrome。与日常 Chrome 配置隔离，多个任务共享同一登录态。
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { checkPort } from './browser-discovery.mjs';
import { ensureFeedbackServer } from './feedback-server.mjs';

export const DEDICATED_CDP_PORT = 9223;
export const DEDICATED_CDP_URL = `http://127.0.0.1:${DEDICATED_CDP_PORT}`;

export function dedicatedChromeProfile() {
  const home = os.homedir();
  if (os.platform() === 'darwin') return path.join(home, 'Library/Application Support/Chrome-CDP');
  if (os.platform() === 'win32') return path.join(process.env.LOCALAPPDATA || home, 'Chrome-CDP');
  return path.join(home, '.config/chrome-cdp');
}

function chromeExecutable() {
  const candidates = os.platform() === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
    : os.platform() === 'win32'
      ? [
          path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'),
          path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google/Chrome/Application/chrome.exe'),
          path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
        ]
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return candidates.find(candidate => candidate && fsSync.existsSync(candidate)) || null;
}

async function isCdpEndpoint() {
  try {
    const response = await fetch(`${DEDICATED_CDP_URL}/json/version`, { signal: AbortSignal.timeout(1000) });
    if (!response.ok) return false;
    const value = await response.json();
    return typeof value.webSocketDebuggerUrl === 'string' && value.webSocketDebuggerUrl.startsWith('ws://');
  } catch {
    return false;
  }
}

export async function ensureDedicatedChrome() {
  await ensureFeedbackServer();
  if (await isCdpEndpoint()) return DEDICATED_CDP_URL;
  if (await checkPort(DEDICATED_CDP_PORT, '127.0.0.1', 500)) {
    throw new Error(`端口 ${DEDICATED_CDP_PORT} 已被非 CDP 服务占用；未连接未知进程`);
  }
  const executable = chromeExecutable();
  if (!executable) throw new Error('未找到 Google Chrome；请安装 Chrome，或用 --cdp 指定已有的本机 CDP 地址');
  const profile = dedicatedChromeProfile();
  await fs.mkdir(profile, { recursive: true });
  if (os.platform() !== 'win32') await fs.chmod(profile, 0o700);
  const child = spawn(executable, [
    `--user-data-dir=${profile}`,
    '--profile-directory=Default',
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${DEDICATED_CDP_PORT}`,
    '--no-first-run',
    '--no-default-browser-check',
  ], { detached: true, stdio: 'ignore' });
  child.unref();
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await isCdpEndpoint()) return DEDICATED_CDP_URL;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`专用 CDP Chrome 已启动，但 ${DEDICATED_CDP_URL} 未就绪`);
}
