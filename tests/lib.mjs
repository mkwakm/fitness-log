// 테스트 공용 도구. 브라우저 찾기, 앱 열기, 판정(ok/eq), 오프라인 테스트용 작은 http 서버.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, extname } from 'node:path';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const APP = pathToFileURL(join(ROOT, 'index.html')).href;

// 클라우드 세션에는 /opt/pw-browsers에 크로미움이 깔려 있다.
// PC에서는 설치된 크롬(없으면 엣지)을 쓴다. 다른 걸 쓰려면 CHROME_PATH로 지정.
function findChromium() {
  if (process.env.CHROME_PATH) return { executablePath: process.env.CHROME_PATH };
  const base = '/opt/pw-browsers';
  if (existsSync(base)) {
    for (const d of readdirSync(base).filter((n) => n.startsWith('chromium-')).sort().reverse()) {
      const p = join(base, d, 'chrome-linux', 'chrome');
      if (existsSync(p)) return { executablePath: p };
    }
  }
  return null;
}

export async function launch() {
  const found = findChromium();
  if (found) return chromium.launch(found);
  for (const channel of ['chrome', 'msedge']) {
    try { return await chromium.launch({ channel }); } catch { /* 다음 후보 */ }
  }
  throw new Error('브라우저를 못 찾았어요. 크롬을 설치하거나 CHROME_PATH에 실행 파일 경로를 적어 주세요.');
}

// 한 파일(스위트)에서 쓰는 도구 모음
export function makeT(browser, name) {
  const results = [];
  const pages = [];
  const t = {
    name,
    browser,
    ok(cond, msg) {
      results.push({ ok: !!cond, msg });
      if (!cond) console.log(`    ❌ ${msg}`);
      else if (process.env.VERBOSE) console.log(`    ✅ ${msg}`);
    },
    eq(actual, expected, msg) {
      const same = JSON.stringify(actual) === JSON.stringify(expected);
      t.ok(same, same ? msg : `${msg} — 기대 ${JSON.stringify(expected)}, 실제 ${JSON.stringify(actual)}`);
    },
    // 새 컨텍스트(= 빈 localStorage)에서 앱을 연다. 기기 두 대를 흉내 낼 땐 두 번 부르면 된다.
    async open({ url = APP, viewport = { width: 375, height: 812 }, init, context = {}, dialog } = {}) {
      const ctx = await browser.newContext({ viewport, ...context });
      const page = await ctx.newPage();
      page.errors = [];
      page.on('pageerror', (e) => page.errors.push(e.message));
      page.on('console', (m) => {
        if (m.type() !== 'error') return;
        const text = m.text();
        // 가짜 서버로 일부러 401 등을 돌려주는 테스트가 있어 "Failed to load resource"는 에러로 안 본다
        if (!text.startsWith('Failed to load resource')) page.errors.push(text);
      });
      page.on('dialog', (d) => (dialog ? dialog(d) : d.accept()));
      if (init) await page.addInitScript(init.fn ?? init, init.arg);
      await page.goto(url);
      await page.waitForSelector('#mealList', { state: 'attached' });
      pages.push(page);
      return page;
    },
    noErrors(page, label = '') {
      t.ok(page.errors.length === 0, `콘솔 에러 없음${label ? ` (${label})` : ''}${page.errors.length ? ': ' + page.errors.slice(0, 3).join(' | ') : ''}`);
    },
    results,
    async closeAll() { for (const p of pages) await p.context().close().catch(() => {}); },
  };
  return t;
}

// 페이지 안에서 자주 쓰는 동작
export const tab = async (page, name) => { await page.click(`[data-tab="${name}"]`); await page.waitForTimeout(150); };
export const text = async (page, sel) => ((await page.textContent(sel)) ?? '').replace(/\s+/g, ' ').trim();
export const wait = (page, ms) => page.waitForTimeout(ms);

// 서비스워커는 file://에서 안 돈다. 저장소 폴더를 그대로 내주는 작은 서버.
// overrides로 특정 파일 내용을 바꿔 "새 버전 배포"를 흉내 낼 수 있다(저장소 파일은 건드리지 않는다).
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png' };
export async function serve() {
  const overrides = new Map();
  const server = createServer(async (req, res) => {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const rel = path.replace(/^\/+/, '');
    try {
      const body = overrides.has(rel) ? overrides.get(rel) : await readFile(join(ROOT, rel));
      res.writeHead(200, { 'Content-Type': TYPES[extname(rel)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(body);
    } catch {
      res.writeHead(404); res.end('not found');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}/`, overrides, close: () => new Promise((r) => server.close(r)) };
}

// 날짜 문자열 n일 전 (앱의 shiftDate와 같은 규칙: 로컬 날짜)
export function ago(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d - off).toISOString().slice(0, 10);
}
