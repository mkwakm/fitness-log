// 운동별 메모와 운동 상세 화면
import { tab, text, wait, ago } from './lib.mjs';

export default async function (t) {
  const page = await t.open();
  await page.evaluate(() => {
    const mk = (name, w, reps, note) => ({ id: crypto.randomUUID(), name, note: note ?? null,
      sets: [0, 1, 2].map(() => ({ weight: w, reps, done: true, doneAt: Date.now() })) });
    for (let i = 1; i < 40; i++) {
      const d = shiftDate(todayStr(), -i);
      const ws = [];
      if (i % 2 === 0) ws.push(mk('벤치프레스', 60 + Math.floor((40 - i) / 4), 10, i === 2 ? '와이드그립' : null));
      if (i % 3 === 0) ws.push(mk('턱걸이', null, 8 + (i % 3)));
      state.days[d] = { meals: [], workouts: ws, note: '' };
    }
    save(); render();
  });
  await tab(page, 'workouts');

  // ── 운동별 메모 ──
  await page.fill('#exName', '벤치프레스');
  await wait(page, 80);
  t.ok((await text(page, '#exHint')).includes('📝 와이드그립'), '폼 안내에 지난번 메모가 따라옴');
  await page.click('#workoutForm button[type=submit]');
  t.ok((await text(page, '#workoutList')).includes('📝 와이드그립'), '카드의 지난번 줄에도');
  await page.fill('.ex-note', '  발 고정  ');
  await page.locator('.ex-note').blur();
  t.eq(await page.evaluate(() => day().workouts[0].note), '발 고정', '메모 저장 (앞뒤 공백 정리)');
  await page.fill('.ex-note', '   ');
  await page.locator('.ex-note').blur();
  t.eq(await page.evaluate(() => day().workouts[0].note), null, '비우면 null');
  await page.fill('.ex-note', '발 고정');
  await page.locator('.ex-note').blur();

  // ── 상세 열기 ──
  await page.click('[data-ex-detail]');
  t.ok(await page.locator('#exSheet').isVisible(), '이름을 누르면 상세가 열림');
  t.eq(await text(page, '#exSheetTitle'), '벤치프레스', '제목');
  const stats = await page.evaluate(() => {
    const log = exerciseLog('벤치프레스');
    return { days: new Set(log.map((x) => x.date)).size, sets: log.reduce((n, x) => n + countedSets(x.w).length, 0) };
  });
  t.ok((await text(page, '#exSheetBody')).includes(`${stats.days}번 함`), `한 날 수 (${stats.days})`);
  t.ok((await text(page, '.sheet-body .tiles')).includes(String(stats.sets)), `총 세트 (${stats.sets})`);
  t.ok((await text(page, '#exSheetBody')).includes('발 고정') && (await text(page, '#exSheetBody')).includes('와이드그립'), '메모 모음');
  t.ok(await page.locator('#exSheetBody .chart').count() === 1, '1RM 추이 그래프');
  t.ok(await page.evaluate(() => document.body.classList.contains('sheet-open')), '뒤 화면 스크롤 잠금');

  // ── 닫기: ESC / ✕ / 뒤로가기, history가 쌓이지 않음 ──
  await page.keyboard.press('Escape');
  t.ok(await page.locator('#exSheet').isHidden(), 'ESC로 닫힘');
  const len0 = await page.evaluate(() => history.length);
  await page.click('[data-ex-detail]');
  await page.click('#exSheetClose');
  await wait(page, 150);
  await page.click('[data-ex-detail]');
  await page.click('#exSheetClose');
  await wait(page, 150);
  t.eq(await page.evaluate(() => history.length), len0, '✕로 여러 번 여닫아도 history가 쌓이지 않음');
  await page.click('[data-ex-detail]');
  await page.goBack();
  await wait(page, 200);
  t.ok(await page.locator('#exSheet').isHidden(), '뒤로가기로 닫힘');
  t.ok(await page.evaluate(() => typeof state === 'object'), '뒤로가기에 앱이 안 꺼짐');

  // ── 열어 둔 채 기록이 바뀌면 갱신 ──
  await page.click('[data-ex-detail]');
  const rows0 = await page.locator('#exSheetBody .log-row').count();
  await page.evaluate(() => { day().workouts.push({ id: 'x', name: '벤치프레스', sets: [{ weight: 100, reps: 5, done: true }] }); save(); render(); });
  t.eq(await page.locator('#exSheetBody .log-row').count(), rows0 + 1, '열어 둔 상세가 같이 갱신됨');

  // ── 시트 안에서 좌우로 쓸어도 날짜가 안 넘어감 ──
  const d0 = await page.evaluate(() => currentDate);
  await page.locator('#exSheetBody').hover();
  await page.mouse.down(); await page.mouse.move(40, 300); await page.mouse.move(340, 300); await page.mouse.up();
  await wait(page, 200);
  t.eq(await page.evaluate(() => currentDate), d0, '시트 안 스와이프는 날짜를 안 바꿈');

  // ── 날짜를 누르면 그 날로 ──
  const target = await page.locator('#exSheetBody .log-row .link-btn').nth(2).getAttribute('data-goto');
  await page.locator('#exSheetBody .log-row .link-btn').nth(2).click();
  await wait(page, 200);
  t.eq(await page.evaluate(() => [currentDate, $('#exSheet').hidden]), [target, true], '기록 날짜를 누르면 그 날로 가고 상세는 닫힘');

  // ── 맨몸 운동 ──
  await page.evaluate(() => openExSheet('턱걸이'));
  t.ok((await text(page, '.sheet-body .tiles')).includes('총 횟수'), '맨몸 운동은 볼륨 대신 총 횟수');
  t.ok((await text(page, '#exSheetBody')).includes('중량 기록이 없어요'), '1RM 그래프 대신 안내');
  await page.keyboard.press('Escape');

  // ── 기록 탭 "자세히" ──
  await tab(page, 'history');
  await page.click('#liftDetail');
  t.eq(await text(page, '#exSheetTitle'), await page.evaluate(() => liftPick), '1RM 카드에서도 열림');
  await page.keyboard.press('Escape');

  // ── 많아도 30개까지만 ──
  await page.evaluate(() => {
    for (let i = 0; i < 80; i++) state.days[shiftDate(todayStr(), -(100 + i))] = { meals: [], note: '',
      workouts: [{ id: 'o' + i, name: '벤치프레스', sets: [{ weight: 50, reps: 10, done: true }] }] };
    save(); openExSheet('벤치프레스');
  });
  t.ok(await page.evaluate(() => exerciseLog('벤치프레스').length) > 90, '기록 90개 넘음');
  t.ok((await text(page, '#exSheetBody')).includes('최근 30개'), '30개까지만 그리고 그렇다고 알려줌');
  await page.keyboard.press('Escape');

  // ── 메모로 검색 ──
  await tab(page, 'history');
  await page.click('[data-cal-search]');
  await page.fill('#historySearch', '와이드그립');
  await wait(page, 150);
  t.eq(await page.locator('#historyList .history-day').count(), 1, '운동 메모로도 검색됨');
  t.noErrors(page);
}
