// GitHub Gist 동기화 (가짜 GitHub 서버로) + 자동 동기화 타이밍
import { tab, text, wait } from './lib.mjs';

export default async function (t) {
  const gists = {};
  let nextId = 1, calls = [], fail = false;
  const mock = (page) => page.route('https://api.github.com/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    calls.push(`${req.method()} ${url.pathname}`);
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (fail) return json({}, 401);
    const m = url.pathname.match(/^\/gists\/(.+)$/);
    if (req.method() === 'GET' && url.pathname === '/gists') return json(Object.entries(gists).map(([id, files]) => ({ id, files })));
    if (req.method() === 'POST' && url.pathname === '/gists') { const id = 'g' + nextId++; gists[id] = JSON.parse(req.postData()).files; return json({ id, files: gists[id] }); }
    if (m && req.method() === 'PATCH') { gists[m[1]] = JSON.parse(req.postData()).files; return json({ id: m[1], files: gists[m[1]] }); }
    if (m) return json({ id: m[1], files: gists[m[1]] });
    return json({}, 404);
  });
  const open = async () => {
    const p = await t.open({ dialog: (d) => (d.type() === 'prompt' ? d.accept('ghp_faketoken') : d.accept()) });
    await mock(p);
    await tab(p, 'history');
    return p;
  };
  const adv = (p) => p.evaluate(() => { advOpen = true; renderSync(); });
  const sync = async (p) => { await adv(p); await p.click('#gistSyncBtn'); await wait(p, 350); };
  const addMeal = (p, n) => p.evaluate((n) => { day().meals.push({ id: uid(), type: '점심', name: n, amount: '', kcal: 100 }); save(); render(); }, n);
  const meals = (p) => p.evaluate(() => day().meals.map((m) => m.name).sort());

  const A = await open();
  t.ok(await A.locator('.sync-adv').getAttribute('open') === null, 'Gist(토큰 방식)는 접혀 있음');
  await addMeal(A, '집PC_점심');
  await adv(A);
  await A.click('#gistOnBtn');
  await wait(A, 400);
  t.eq(Object.keys(gists).length, 1, '처음 연결하면 Gist를 하나 만듦');

  const B = await open();
  await addMeal(B, '폰_저녁');
  await adv(B);
  await B.click('#gistOnBtn');
  await wait(B, 500);
  t.eq(Object.keys(gists).length, 1, '다른 기기는 새로 안 만들고 기존 Gist를 찾아 붙음');
  t.eq(await meals(B), ['집PC_점심', '폰_저녁'], '폰에 PC 기록이 합쳐짐');
  await sync(A);
  t.eq(await meals(A), ['집PC_점심', '폰_저녁'], 'PC도 합쳐짐');

  const id = await A.evaluate(() => day().meals.find((m) => m.name === '집PC_점심').id);
  await A.evaluate((i) => { day().meals = day().meals.filter((m) => m.id !== i); markDeleted(i); save(); render(); }, id);
  await sync(A);
  await sync(B);
  t.eq(await meals(B), ['폰_저녁'], 'PC에서 지운 게 폰에서도 지워짐');
  await sync(B);
  t.eq(await meals(B), ['폰_저녁'], '되살아나지 않음');

  const dumpA = await A.evaluate(() => JSON.stringify(state));
  t.ok(!dumpA.includes('ghp_faketoken'), '토큰이 state(백업 JSON)에 없음');
  t.ok(await A.evaluate(() => localStorage.getItem('fitness-log-sync')?.includes('ghp_faketoken')), '토큰은 별도 키에만');

  fail = true;
  await sync(A);
  t.ok((await text(A, '.sync-msg')).includes('토큰'), '토큰이 틀리면 알려줌');
  t.ok(await A.locator('#gistSyncBtn').isEnabled(), '실패해도 버튼이 다시 살아남');
  fail = false;

  // ── 자동 동기화 ──
  calls = [];
  await A.evaluate(() => {
    syncAfterEdit = function () { clearTimeout(afterEditTimer); afterEditTimer = setTimeout(() => gistSync({ quiet: true }), 300); };
    day().meals.push({ id: uid(), type: '점심', name: '밥', amount: '1공기', kcal: 300 }); save(); render();
  });
  await wait(A, 150);
  t.eq(calls.length, 0, '고친 직후엔 안 올림 (잠잠해질 때까지 기다림)');
  await wait(A, 500);
  t.ok(calls.some((c) => c.startsWith('PATCH')), '잠잠해지면 올림');

  calls = [];
  await A.evaluate(async () => { calSearchOpen = true; renderCalendar(); document.querySelector('#historySearch').focus(); await gistSync({ quiet: true }); });
  t.eq(calls.length, 0, '입력 중이면 건너뜀 (화면을 갈아엎으면 입력이 끊긴다)');
  await A.evaluate(() => document.activeElement.blur());

  calls = [];
  await A.evaluate(() => { sync.lastGist = Date.now() - 10 * 60000; saveSync(); document.dispatchEvent(new Event('visibilitychange')); });
  await wait(A, 500);
  t.ok(calls.length > 0, '앱으로 돌아왔는데 오래됐으면 맞춤');
  calls = [];
  await A.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await wait(A, 300);
  t.eq(calls.length, 0, '방금 맞췄으면 또 안 부름');

  await adv(A);
  await A.click('#gistOffBtn');
  await wait(A, 200);
  t.eq(await A.locator('#gistOnBtn').count(), 1, '연결 해제');
  calls = [];
  await A.evaluate(() => { day().note = 'x'; save(); });
  await wait(A, 600);
  t.eq(calls.length, 0, '해제하면 자동 동기화도 멈춤');
  t.noErrors(A, 'PC');
  t.noErrors(B, '폰');
}
