// 서비스워커·오프라인·업데이트. file://에선 안 돌아서 작은 서버로 띄운다.
import { serve, wait, ROOT } from './lib.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export default async function (t) {
  const srv = await serve();
  try {
    const page = await t.open({ url: srv.url });
    await wait(page, 1500);
    const reg = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return r?.active?.state ?? null; });
    t.eq(reg, 'activated', '서비스워커 활성');
    const version = readFileSync(join(ROOT, 'sw.js'), 'utf8').match(/const CACHE = '([^']+)'/)[1];
    const cached = await page.evaluate(async () => { const k = await caches.keys(); const c = await caches.open(k[0]); return { keys: k, n: (await c.keys()).length }; });
    t.eq(cached.keys, [version], `캐시 이름 = ${version}`);
    t.ok(cached.n >= 12, `앱 파일 ${cached.n}개 캐시`);

    // ── 오프라인 ──
    await page.evaluate(() => { state.days[todayStr()] = { meals: [{ id: 'x', type: '점심', name: '오프라인전', amount: '', kcal: 1 }], workouts: [], note: '' }; save(); });
    await page.context().setOffline(true);
    await page.reload();
    await page.waitForSelector('#mealList', { state: 'attached' });
    t.eq(await page.evaluate(() => day().meals[0]?.name), '오프라인전', '오프라인에서도 열리고 기록이 그대로');
    await page.click('[data-tab="workouts"]');
    await page.fill('#exName', '오프라인운동');
    await page.click('#workoutForm button[type=submit]');
    t.eq(await page.evaluate(() => day().workouts.length), 1, '오프라인에서도 기록됨');
    await page.context().setOffline(false);

    // ── 새 버전 배포 흉내: 파일을 바꾸고 캐시 버전을 올리면 ──
    srv.overrides.set('style.css', readFileSync(join(ROOT, 'style.css'), 'utf8') + '\n.__probe{}\n');
    srv.overrides.set('sw.js', readFileSync(join(ROOT, 'sw.js'), 'utf8').replace(version, 'fitness-log-test-next'));
    await page.reload();
    await wait(page, 1500);
    await page.reload();
    await wait(page, 1200);
    const after = await page.evaluate(async () => ({ keys: await caches.keys(),
      probe: [...document.styleSheets].some((s) => { try { return [...s.cssRules].some((r) => r.selectorText === '.__probe'); } catch { return false; } }) }));
    t.ok(after.probe, '다시 열면 새 파일이 적용됨');
    t.eq(after.keys, ['fitness-log-test-next'], '옛 캐시는 지워짐');

    // ── 설치 정보 ──
    const man = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
    t.eq(man.display, 'standalone', '홈 화면에서 앱처럼 (standalone)');
    t.ok(['192x192', '512x512'].every((s) => man.icons.some((i) => i.sizes === s)), '192·512 아이콘');
    t.ok(man.icons.some((i) => (i.purpose || '').includes('maskable')), '안드로이드용 maskable 아이콘');
    const meta = await page.evaluate(() => ({ lang: document.documentElement.lang, vp: document.querySelector('meta[name=viewport]')?.content,
      noName: [...document.querySelectorAll('button')].filter((b) => b.offsetParent && !b.textContent.trim() && !b.getAttribute('aria-label')).length }));
    t.eq(meta.lang, 'ko', 'lang=ko');
    t.ok(/width=device-width/.test(meta.vp), 'viewport');
    t.eq(meta.noName, 0, '보이는 버튼은 모두 이름이 있음 (화면 읽기 프로그램)');
    t.noErrors(page);
  } finally {
    await srv.close();
  }
}
