// 몸 변화 (三 메뉴): 체중·체지방·골격근·허리를 날짜별로, 지표별 그래프, 눈바디 사진 전·후 비교.
// 몸 사진은 "안 쓰는 사진 정리"에 지워지면 안 되고, 기기끼리 합칠 때 둘 다 남아야 한다.
import { tab, text, wait, ago, openWeight } from './lib.mjs';

export default async function (t) {
  const page = await t.open({ dialog: (d) => d.accept() });
  const makePhoto = (color) => page.evaluate((color) => {
    const c = document.createElement('canvas'); c.width = 60; c.height = 80;
    const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, 60, 80);
    return c.toDataURL('image/png').split(',')[1];
  }, color).then((b64) => ({ name: 'body.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') }));

  await page.click('#menuBtn');
  t.ok((await text(page, '#weightOpen')).startsWith('몸 변화'), '메뉴 항목 이름: 몸 변화');
  await page.click('#weightOpen');
  await wait(page, 80);
  t.eq(await text(page, '#weightTitle'), '몸 변화', '창 제목');
  t.eq(await page.locator('#bodyInputs input').count(), 4, '칸 4개 (체중·체지방·골격근·허리)');
  t.ok((await text(page, '#weightChart')).includes('아직 적은 체중 기록이 없어요'), '기록이 없으면 그렇다고');
  const fontSizes = await page.$$eval('#bodyInputs input', (els) => els.map((e) => parseFloat(getComputedStyle(e).fontSize)));
  t.ok(fontSizes.every((s) => s >= 16), '입력칸 글자 16px 이상 (아이폰 확대 방지)');

  // ── 칸에 적으면 그 날 기록 ──
  await page.fill('[data-body-key="fat"]', '18.5');
  await page.fill('[data-body-key="muscle"]', '35.2');
  await page.fill('[data-body-key="waist"]', '82');
  await page.fill('[data-body-key="weight"]', '78.4');
  await page.locator('[data-body-key="weight"]').blur();
  await wait(page, 100);
  t.eq(await page.evaluate(() => [day().weight, day().fat, day().muscle, day().waist, state.profile.weight]), [78.4, 18.5, 35.2, 82, 78.4], '그 날 기록으로 저장 (체중은 기본값 캐시도)');
  t.eq(await page.inputValue('#bodyWeight'), '78.4', '운동 탭 체중 칸에도 같은 값');
  t.ok(await page.locator('[data-body-metric="weight"]').evaluate((b) => b.classList.contains('on')), '고친 지표의 그래프로 바뀜');

  // ── 지표별 그래프 ──
  await page.evaluate(() => {
    [[6, 80.2, 21, 34.1, 86], [4, 79.5, 20.1, 34.5, 85], [2, 79, 19.4, 34.8, 84]].forEach(([i, w, f, m, wa]) => {
      const d = shiftDate(todayStr(), -i);
      state.days[d] = { meals: [], workouts: [], note: '', weight: w, fat: f, muscle: m, waist: wa };
    });
    save(); render();
  });
  await page.click('[data-body-metric="fat"]');
  t.eq(await page.locator('#weightChart circle').count(), 4, '체지방 그래프 (4번)');
  t.ok((await text(page, '#weightChart')).includes('-2.5 %'), `체지방 변화 ${await text(page, '#weightChart p')}`);
  await page.click('[data-body-metric="waist"]');
  t.ok((await text(page, '#weightChart')).includes('cm'), '허리는 cm');
  t.eq(await page.evaluate(() => document.querySelectorAll('#weightChart svg').length), 1, '한 번에 그래프 하나 (축 하나)');
  await page.evaluate(() => { currentDate = shiftDate(todayStr(), 1); render(); });
  t.eq(await page.getAttribute('[data-body-key="fat"]', 'placeholder'), '18.5', '비어 있는 날은 지난 값을 흐리게 (placeholder)');
  await page.evaluate(() => { currentDate = todayStr(); render(); });

  // ── 눈바디 사진 ──
  t.eq(await page.locator('#bodyPhotos img').count(), 0, '사진이 없으면 비교 칸 없음');
  await page.evaluate(() => { currentDate = shiftDate(todayStr(), -6); render(); });
  await page.setInputFiles('#bodyPhotoFile', await makePhoto('#c33'));
  await page.waitForFunction(() => (state.days[shiftDate(todayStr(), -6)].bodyPhotos || []).length === 1);
  await page.evaluate(() => { currentDate = todayStr(); render(); });
  await page.setInputFiles('#bodyPhotoFile', await makePhoto('#33c'));
  await page.waitForFunction(() => (day().bodyPhotos || []).length === 1);
  await wait(page, 200);
  const ids = await page.evaluate(() => [state.days[shiftDate(todayStr(), -6)].bodyPhotos[0].id, day().bodyPhotos[0].id]);
  t.eq(await page.$$eval('.body-cmp img', (els) => els.map((e) => e.dataset.bodyPhoto)), ids, '전 = 처음 사진, 후 = 최근 사진');
  t.ok(await page.$$eval('.body-cmp img', (els) => els.every((e) => e.src.startsWith('blob:'))), '사진이 실제로 보임');
  t.ok((await text(page, '.body-cmp')).includes('78.4kg'), '그 날 체중을 같이');
  t.eq(await page.locator('.body-thumb').count(), 2, '사진 줄 (최근부터)');
  await page.setViewportSize({ width: 375, height: 800 });
  t.ok(await page.evaluate(() => { const b = document.querySelector('#weightSheet .sheet-body'); return b.scrollWidth <= b.clientWidth; }), '375px에서 가로로 안 넘침 (칸 2×2가 밀려나던 것)');

  // 식단 사진과 URL을 따로 관리 (fillPhotos가 몸 사진 URL을 지우면 안 된다, 반대도)
  await page.evaluate(() => fillPhotos());
  await wait(page, 100);
  const alive = await page.$$eval('.body-cmp img', async (els) => (await Promise.all(els.map((e) => fetch(e.src).then(() => true, () => false)))).every(Boolean));
  t.ok(alive, '식단 사진을 다시 채워도 몸 사진 URL은 살아 있음');

  // 안 쓰는 사진 정리에서 몸 사진은 남는다
  t.ok(await page.evaluate((ids) => ids.every((id) => usedPhotoIds().includes(id)), ids), '몸 사진은 "쓰는 사진"');
  const removed = await page.evaluate(() => prunePhotos());
  t.eq(removed, 0, '안 쓰는 사진 정리가 몸 사진을 안 지움');
  const exported = await page.evaluate(() => collectPhotos());
  t.ok(ids.every((id) => id in exported), '사진까지 내보내기에 몸 사진도');

  // 전 사진 바꾸기
  await page.selectOption('[data-body-cmp="0"]', ids[1]);
  t.eq(await page.$$eval('.body-cmp img', (els) => els.map((e) => e.dataset.bodyPhoto)), [ids[1], ids[1]], '전·후를 골라 볼 수 있음');

  // 지우기 → 되돌리기
  await page.click(`[data-body-del$="${ids[0]}"]`);
  await wait(page, 100);
  t.eq(await page.evaluate(() => (state.days[shiftDate(todayStr(), -6)].bodyPhotos || []).length), 0, '사진 지우기');
  t.ok(await page.evaluate((id) => state.days[shiftDate(todayStr(), -6)].deleted.includes(id), ids[0]), '지운 id를 남김 (다른 기기에서도 지워지게)');
  t.ok(await page.locator('#undoBtn').isVisible(), '창 위에서도 되돌리기 바');
  await page.click('#undoBtn');
  await wait(page, 150);
  t.eq(await page.locator('.body-thumb').count(), 2, '되돌리면 사진이 돌아옴');

  // ── 기기끼리 합치기 · 망가진 값 ──
  const merged = await page.evaluate(() => {
    const d = shiftDate(todayStr(), -6);
    const remote = { days: { [d]: { ...state.days[d], bodyPhotos: [{ id: 'other-device' }], updatedAt: Date.now() + 1000 } } };
    mergeState(remote);
    const bad = safeDay({ meals: [], workouts: [], bodyPhotos: 'oops' });
    return { ids: state.days[d].bodyPhotos.map((p) => p.id), bad: bad.bodyPhotos };
  });
  t.ok(merged.ids.includes(ids[0]) && merged.ids.includes('other-device'), '두 기기의 눈바디 사진이 둘 다 남음');
  t.eq(merged.bad, [], '망가진 bodyPhotos는 빈 목록으로');

  // ── 달력 · 정리 글 · 메뉴 ──
  await page.keyboard.press('Escape');
  await tab(page, 'history');
  await page.evaluate(() => { calPick = todayStr(); renderCalendar(); });
  t.ok((await text(page, '#calDetail')).includes('체지방 18.5%') && (await text(page, '#calDetail')).includes('눈바디 사진 1장'), '달력 그 날 보기에 몸 기록');
  const report = await page.evaluate(() => recordText());
  t.ok(report.includes('- 체중 78.4kg · 체지방 18.5% · 골격근 35.2kg · 허리 82cm'), '정리 글 날짜별에 몸 기록 (Claude가 읽게)');
  t.ok(/- 체지방: 18\.5% \(\d\d\/\d\d 기록, 처음 21%/.test(report), '정리 글 요약에 처음과 마지막');
  await page.click('#menuBtn');
  t.ok((await text(page, '#weightOpen')).includes('78.4kg · 체지방 18.5%'), '메뉴에 마지막 체중·체지방');
  t.noErrors(page);
}
