// 다른 날로 옮기기: 운동 카드(슈퍼세트는 묶음째)·식단 하나·달력의 하루치 운동. 새 id + 원래 날엔 지운 id.
// 그리고 ⏱ 휴식 버튼은 늘 (운동 전·다른 탭·지난 날짜).
import { tab, text, wait, openEx } from './lib.mjs';

export default async function (t) {
  const page = await t.open();
  const T = await page.evaluate(() => todayStr());
  const Y = await page.evaluate(() => shiftDate(todayStr(), -1));
  const names = (d) => page.evaluate((d) => (state.days[d]?.workouts || []).map((w) => w.name), d);

  // ── ⏱ 휴식 버튼은 늘 ──
  t.ok(await page.evaluate(() => !$('#restFab').hidden), '빈 앱(운동을 넣기 전)에도 ⏱ 휴식 버튼');
  for (const name of ['meals', 'history', 'workouts']) {
    await tab(page, name);
    t.ok(await page.evaluate(() => !$('#restFab').hidden), `${name} 탭에서도 ⏱ 버튼`);
  }

  // 어제에 오늘 운동이 잘못 들어갔다고 치자
  await page.evaluate((Y) => {
    state.days[Y] = { meals: [{ id: 'm1', type: '점심', name: '제육덮밥', amount: '1인분', kcal: 820, protein: 32 }], note: '', split: '가슴·삼두', sessionMin: 50,
      workouts: [
        { id: 'a', name: '벤치프레스', note: '그립 넓게', sets: [{ weight: 60, reps: 10, done: true, doneAt: 5 }, { weight: 70, reps: 8, drops: [{ weight: 50, reps: 8 }] }] },
        { id: 'b', name: '케이블푸시다운', ss: 'q', sets: [{ weight: 25, reps: 12 }] },
        { id: 'c', name: '트라이셉익스텐션', ss: 'q', sets: [{ weight: 15, reps: 12 }] },
        { id: 'd', name: '딥스', sets: [{ weight: 0, reps: 15 }] }] };
    state.days[todayStr()] = { meals: [], note: '', workouts: [{ id: 't', name: '스쿼트', ss: 'q', sets: [{ weight: 100, reps: 5 }] }] };
    currentDate = Y; save(); render();
  }, Y);

  // ── 운동 카드 하나 ──
  await openEx(page, 0);
  await page.click('[data-move-ex="a"]');
  t.ok(await page.evaluate(() => !$('#moveSheet').hidden), '카드의 📅 날짜 옮기기 → 옮기기 창');
  t.ok((await text(page, '#moveBody')).includes('벤치프레스 · 2세트'), '무엇을 옮기는지');
  t.eq(await page.$$eval('#moveBody [data-move-to]:not([data-move-to="pick"])', (x) => x.map((e) => e.dataset.moveTo)).then((a) => a[0]), T, '맨 위 버튼은 오늘 (어제에 잘못 들어간 걸 오늘로 — 한 번에)');
  await page.click(`#moveBody [data-move-to="${T}"]`);
  t.ok(await page.evaluate(() => $('#moveSheet').hidden), '옮기면 창이 닫힘');
  t.eq([await names(Y), await names(T)], [['케이블푸시다운', '트라이셉익스텐션', '딥스'], ['스쿼트', '벤치프레스']], '어제에서 빠지고 오늘 끝에 붙음');
  const moved = await page.evaluate((T) => state.days[T].workouts.find((w) => w.name === '벤치프레스'), T);
  t.ok(moved.id !== 'a', '새 id로 (다시 옮겨 와도 다른 기기와 합칠 때 안 사라지게)');
  t.eq([moved.note, moved.sets.length, moved.sets[0].done, moved.sets[1].drops.length], ['그립 넓게', 2, true, 1], '메모·세트·완료·드롭 그대로');
  t.ok(await page.evaluate((Y) => state.days[Y].deleted.includes('a'), Y), '어제엔 지운 id가 남음 (다른 기기에서 되살아나지 않게)');
  t.ok((await text(page, '#undoText')).includes(`벤치프레스 · 2세트을(를) ${T.slice(5).replace('-', '/')}로 옮겼어요`), '되돌리기 바');
  t.eq(await page.evaluate(() => currentDate), Y, '보던 날 그대로 (다음 카드도 옮길 수 있게)');

  // 되돌리기
  await page.click('#undoBtn');
  t.eq([await names(Y), await names(T)], [['벤치프레스', '케이블푸시다운', '트라이셉익스텐션', '딥스'], ['스쿼트']], '되돌리기로 원래대로');

  // ── 슈퍼세트는 묶음째 ──
  await openEx(page, 1);
  await page.click('[data-move-ex="b"]');
  t.ok((await text(page, '#moveBody')).includes('케이블푸시다운 · 트라이셉익스텐션 (슈퍼세트)'), '슈퍼세트면 묶음째 옮긴다고');
  await page.click(`#moveBody [data-move-to="${T}"]`);
  const ss = await page.evaluate((T) => state.days[T].workouts.map((w) => [w.name, w.ss ?? null]), T);
  t.eq(ss.map((x) => x[0]), ['스쿼트', '케이블푸시다운', '트라이셉익스텐션'], '둘 다 옮겨짐');
  t.ok(ss[1][1] && ss[1][1] === ss[2][1] && ss[1][1] !== 'q', '옮겨 간 날에서도 한 묶음, 새 표시 (그 날 원래 있던 표시 q와 안 섞임)');
  t.eq(ss[0][1], null, '혼자 남은 스쿼트의 표시는 정리');

  // ── 다른 날 고르기 ──
  await openEx(page, 1);
  await page.click(`[data-move-ex="d"]`);
  await page.fill('#moveDate', '2026-01-15');
  await page.click('#moveBody [data-move-to="pick"]');
  t.eq(await names('2026-01-15'), ['딥스'], '날짜 칸으로 아무 날이나');
  await openEx(page, 0);
  await page.click('[data-move-ex="a"]');
  await page.click('#moveBody [data-move-to="pick"]');           // 그대로(같은 날)면 안 옮김
  t.ok(await page.evaluate(() => !$('#moveSheet').hidden) && (await names(Y)).includes('벤치프레스'), '같은 날을 고르면 아무것도 안 함');
  await page.keyboard.press('Escape');
  t.ok(await page.evaluate(() => $('#moveSheet').hidden && !layers.length), 'ESC로 닫힘');
  await page.click('[data-move-ex="a"]');
  await page.goBack().catch(() => {});
  await wait(page, 150);
  t.ok(await page.evaluate(() => $('#moveSheet').hidden), '뒤로가기로 닫힘');

  // ── 식단 하나 ──
  await tab(page, 'meals');
  await page.click('[data-move-meal="m1"]');
  t.ok((await text(page, '#moveBody')).includes('점심 · 제육덮밥'), '식단 줄의 📅 → 옮기기 창');
  await page.click(`#moveBody [data-move-to="${T}"]`);
  t.eq(await page.evaluate(({ Y, T }) => [state.days[Y].meals.length, state.days[T].meals.map((m) => [m.name, m.kcal, m.id !== 'm1'])], { Y, T }), [0, [['제육덮밥', 820, true]]], '식단도 오늘로 (새 id)');

  // ── 달력: 하루치 운동 ──
  await tab(page, 'history');
  await page.evaluate((Y) => { calMonth = Y.slice(0, 7); calPick = Y; renderCalendar(); }, Y);
  await page.click(`#calDetail [data-move-day="${Y}"]`);
  t.ok((await text(page, '#moveBody')).includes('운동 1종'), '달력에서 그 날 운동 전부');
  const D = await page.evaluate(() => shiftDate(todayStr(), -5));
  await page.fill('#moveDate', D);
  await page.click('#moveBody [data-move-to="pick"]');
  t.eq(await page.evaluate(({ Y, D }) => [state.days[Y].workouts.length, state.days[Y].split ?? null, state.days[Y].sessionMin ?? null,
    state.days[D].workouts.map((w) => w.name), state.days[D].split, state.days[D].sessionMin], { Y, D }),
    [0, null, null, ['벤치프레스'], '가슴·삼두', 50], '하루치를 옮기면 분할 이름·운동 시간도 같이');
  t.eq(await page.evaluate(() => [calMonth, calPick]), [D.slice(0, 7), D], '달력이 옮겨 간 날을 보여 줌');

  // ── 동기화: 옮긴 걸 다른 기기와 합쳐도 원래 날에 되살아나지 않음 ──
  const merged = await page.evaluate(({ Y }) => {
    mergeState({ days: { [Y]: { meals: [{ id: 'm1', type: '점심', name: '제육덮밥', kcal: 820 }], note: '', workouts: [{ id: 'a', name: '벤치프레스', sets: [{ weight: 60, reps: 10 }] }], updatedAt: 1 } } });
    return [state.days[Y].workouts.length, state.days[Y].meals.length];
  }, { Y });
  t.eq(merged, [0, 0], '다른 기기의 옛 사본과 합쳐도 원래 날엔 안 돌아옴');

  // ── 휴대폰 화면 ──
  await tab(page, 'workouts');
  await page.evaluate((Y) => { currentDate = Y; state.days[Y].workouts.push({ id: 'z', name: '데드리프트', sets: [{ weight: 100, reps: 5 }] }); save(); render(); }, Y);
  for (const vw of [375, 320]) {
    await page.setViewportSize({ width: vw, height: 760 });
    await openEx(page, 0);
    const foot = await page.evaluate(() => ({
      over: document.documentElement.scrollWidth - innerWidth,
      out: [...document.querySelectorAll('#workoutList .ex-foot *')].filter((x) => x.getBoundingClientRect().right > innerWidth + 0.5).length,
      small: [...document.querySelectorAll('#workoutList .ex-foot button')].filter((x) => x.getBoundingClientRect().height < 40).length,
    }));
    t.ok(foot.over <= 0 && foot.out === 0, `${vw}px 카드 아래 줄이 안 넘침`);
    t.eq(foot.small, 0, `${vw}px 카드 아래 버튼 40px 이상`);
    await page.click('[data-move-ex="z"]');
    const sheet = await page.evaluate(() => ({
      out: [...document.querySelectorAll('#moveSheet *')].filter((x) => x.getBoundingClientRect().right > innerWidth + 0.5).length,
      small: [...document.querySelectorAll('#moveSheet button')].filter((x) => x.getBoundingClientRect().height < 40).length,
      font: getComputedStyle(document.getElementById('moveDate')).fontSize,
    }));
    t.eq(sheet, { out: 0, small: 0, font: '16px' }, `${vw}px 옮기기 창 (넘침 없음·버튼 40px·날짜 칸 16px)`);
    await page.keyboard.press('Escape');
  }
  t.noErrors(page);
}
