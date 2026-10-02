// 슈퍼세트 (w.ss): 카드 사이 버튼으로 묶기·풀기, 세 개 묶기, 순서 바꾸기·지우기 뒤 정리,
// 휴식은 한 바퀴 뒤에, 집중 모드는 A1 → B1 → A2 순서, 루틴·지난 운동 불러오기, 완료한 세트 아래 드롭 버튼.
import { tab, text, wait, addWorkout } from './lib.mjs';

export default async function (t) {
  const page = await t.open({ dialog: (d) => (d.type() === 'prompt' ? d.accept('등 가슴 슈퍼') : d.accept()) });
  await tab(page, 'workouts');
  const ss = () => page.evaluate(() => day().workouts.map((w) => w.ss ?? null));
  const names = () => page.evaluate(() => day().workouts.map((w) => w.name));
  const link = (k) => page.locator('[data-ss-link]').nth(k);

  await addWorkout(page, '벤치프레스', { sets: 3, weight: 60, reps: 10 });
  await addWorkout(page, '바벨로우', { sets: 3, weight: 50, reps: 10 });
  await addWorkout(page, '사이드레터럴레이즈', { sets: 2, weight: 8, reps: 15 });
  t.eq(await page.locator('[data-ss-link]').count(), 2, '카드 사이마다 "슈퍼세트로 묶기" 버튼 (마지막 카드 아래엔 없음)');

  // ── 묶기 ──
  await link(0).click();
  let g = await ss();
  t.ok(g[0] && g[0] === g[1] && g[2] === null, '위아래 두 운동이 한 묶음으로');
  t.eq(await page.locator('#workoutList .card.ss').count(), 2, '묶인 카드는 이어진 모양');
  t.ok((await text(page, '#workoutList')).includes('슈퍼세트 2종'), '묶음 맨 위에 "슈퍼세트" 표시');
  t.ok((await link(0).textContent()).includes('풀기'), '사이 버튼은 "풀기"로 바뀜');

  // ── 세 개 (자이언트 세트) ──
  await link(1).click();
  g = await ss();
  t.ok(g[0] === g[1] && g[1] === g[2], '아래 운동도 묶으면 셋이 한 묶음');
  // 가운데를 풀면 위 하나는 혼자 → 표시가 지워지고, 아래 둘은 묶음으로 남음
  await link(0).click();
  g = await ss();
  t.ok(g[0] === null && g[1] && g[1] === g[2], '가운데를 풀면 둘로 나뉨 (혼자 남은 쪽은 묶음 아님)');
  await link(0).click();
  g = await ss();
  t.ok(g[0] && g[0] === g[1] && g[1] === g[2], '다시 묶으면 아래 묶음째로 합쳐짐');

  // ── 순서 바꾸기·지우기 뒤 정리 ──
  await page.evaluate(() => { day().workouts.forEach((w) => delete w.ss); save(); render(); });
  await link(0).click();                                    // 벤치 + 로우
  await page.click(`[data-move="${(await page.evaluate(() => day().workouts[2].id))}:-1"]`);   // 레터럴을 가운데로
  t.eq(await names(), ['벤치프레스', '사이드레터럴레이즈', '바벨로우'], '순서 바뀜');
  t.eq(await ss(), [null, null, null], '사이에 다른 운동이 끼면 묶음이 저절로 풀림');
  await link(0).click();
  await page.locator('[data-del-workout]').nth(1).click();  // 묶음 중 하나를 지움
  await wait(page, 100);
  t.eq(await ss(), [null, null], '묶음이 하나만 남으면 표시도 지움');

  // ── 휴식: 한 바퀴를 돌아야 쉰다 ──
  await page.evaluate(() => {
    const mk = (id, name, w) => ({ id, name, ss: 'g', sets: [1, 2, 3].map(() => ({ weight: w, reps: 10, done: false })) });
    day().workouts = [mk('a', '벤치프레스', 60), mk('b', '바벨로우', 50)];
    stopRest(); save(); render();
  });
  await page.click('[data-toggle="a:0"]');
  t.eq(await page.evaluate(() => restEndAt), 0, 'A1을 끝내면 쉬지 않고 B1로');
  await page.click('[data-toggle="b:0"]');
  t.ok(await page.evaluate(() => restLeft() > 0), 'B1까지 끝내면 휴식 시작');
  await page.evaluate(() => stopRest());

  // ── 집중 모드: A1 → B1 → A2 → B2 ──
  t.eq(await page.evaluate(() => focusQueue().map((x) => `${x.w.id}${x.i + 1}`)), ['a1', 'b1', 'a2', 'b2', 'a3', 'b3'], '집중 모드 순서는 번갈아');
  await page.click('#focusBtn');
  t.ok((await text(page, '#focusSheet')).includes('슈퍼세트'), '집중 모드에 슈퍼세트 표시');
  t.eq(await page.evaluate(() => { const c = focusCurrent(); return `${c.w.id}${c.i + 1}`; }), 'a2', '이미 한 a1·b1 다음은 a2');
  await page.click('#focusSheet [data-focus-done]');
  await wait(page, 100);
  t.eq(await page.evaluate(() => ({ at: `${focusCurrent().w.id}${focusCurrent().i + 1}`, rest: restEndAt })), { at: 'b2', rest: 0 }, 'a2 완료 → 휴식 없이 b2');
  await page.click('#focusSheet [data-focus-done]');
  await wait(page, 100);
  t.ok(await page.evaluate(() => restLeft() > 0), 'b2 완료 → 휴식');
  t.ok((await text(page, '#focusSheet')).includes('벤치프레스 3세트'), '휴식 뒤 다음은 a3');
  await page.evaluate(() => stopRest());
  await page.click('#focusClose');

  // ── 세트 수가 다르면 남는 쪽만 이어서 ──
  t.eq(await page.evaluate(() => {
    const d = { workouts: [{ id: 'x', name: 'A', ss: 'h', sets: [{}, {}, {}] }, { id: 'y', name: 'B', ss: 'h', sets: [{}] }, { id: 'z', name: 'C', sets: [{}] }] };
    return focusQueue(d).map((q) => `${q.w.id}${q.i + 1}`);
  }), ['x1', 'y1', 'x2', 'x3', 'z1'], '세트 수가 다르면 남는 세트만 이어서, 묶음 아닌 운동은 그 뒤에');

  // ── 루틴: 묶음 모양이 따라옴 (표시는 새로) ──
  await page.evaluate(() => { day().workouts.push({ id: 'c', name: '사이드레터럴레이즈', sets: [{ weight: 8, reps: 15, done: false }] }); save(); render(); });
  await page.click('#saveRoutineBtn');
  const saved = await page.evaluate(() => Object.values(state.profile.routines)[0].map((x) => x.ss ?? null));
  t.eq(saved, [1, 1, null], '루틴엔 묶음 번호만 저장');
  await page.evaluate(() => { currentDate = shiftDate(todayStr(), 1); render(); });
  await page.click('[data-load-routine]');
  await page.click('[data-load-routine]');                  // 두 번 불러와도 두 묶음이 섞이지 않음
  g = await ss();
  t.ok(g[0] && g[0] === g[1] && g[2] === null && g[3] && g[3] === g[4] && g[3] !== g[0] && g[0] !== 'g', '루틴을 불러오면 같은 모양, 새 표시 (두 번 불러와도 따로)');

  // ── 지난 운동 통째로 불러오기 ──
  await page.evaluate(() => { day().workouts = []; save(); render(); });
  await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', `<button id="cp" data-copy-day="${todayStr()}"></button>`));
  await page.click('#cp');
  g = await ss();
  t.ok(g[0] && g[0] === g[1] && g[2] === null && g[0] !== 'g', '지난 운동을 불러와도 묶음이 따라옴');

  // ── 드롭: 방금 완료한 세트 바로 아래에 버튼 ──
  await page.evaluate(() => { currentDate = todayStr(); day().workouts = [{ id: 'd', name: '덤벨컬', sets: [1, 2, 3].map(() => ({ weight: 15, reps: 10, done: false })) }]; stopRest(); save(); render(); });
  t.eq(await page.locator('.drop-inline').count(), 0, '완료한 세트가 없으면 세트 아래 드롭 버튼도 없음');
  await page.click('[data-toggle="d:1"]');
  t.eq(await page.locator('.drop-inline').count(), 1, '세트를 완료하면 그 세트 바로 아래에 드롭 버튼');
  const after = await page.evaluate(() => document.querySelector('.drop-inline').previousElementSibling.querySelector('[data-toggle]')?.dataset.toggle);
  t.eq(after, 'd:1', '버튼은 방금 완료한 2세트 바로 아래');
  await page.click('.drop-inline');
  t.eq(await page.evaluate(() => day().workouts[0].sets[1].drops), [{ weight: 12.5, reps: 10 }], '누르면 그 세트에 드롭이 붙음');

  // ── 운동 폼에서 한 번에 넣기 (운동 순서가 처음부터 번갈아라) ──
  await page.evaluate(() => {
    state.days = {};
    state.days[shiftDate(todayStr(), -3)] = { meals: [], note: '', workouts: [
      { id: 'p', name: '벤치프레스', ss: 'old', sets: [1, 2, 3].map(() => ({ weight: 60, reps: 10, done: true })) },
      { id: 'q', name: '바벨로우', ss: 'old', sets: [1, 2, 3].map(() => ({ weight: 50, reps: 8, done: true })) },
      { id: 'r', name: '레그프레스', sets: [{ weight: 100, reps: 10, done: true }] }] };
    currentDate = todayStr(); save(); render();
  });
  await page.fill('#exName', '레그프레스');
  await wait(page, 80);
  t.eq(await page.locator('[data-ss-suggest]').count(), 0, '슈퍼세트로 안 했던 운동은 제안 없음');
  await page.fill('#exName', '벤치프레스');
  await wait(page, 80);
  t.ok((await text(page, '#exHint')).includes('바벨로우와(과) 슈퍼세트'), '지난번에 같이 한 운동을 알려줌');
  await page.click('[data-ss-suggest]');
  t.eq(await page.evaluate(() => partners.map((p) => [p.name, p.sets.map((x) => [x.weight, x.reps])])),
    [['바벨로우', [[52.5, 8], [52.5, 8], [52.5, 8]]]], '"같이 추가"를 누르면 두 번째 칸이 그 운동의 지난번 세트로 (다 채웠으면 한 단위 올려서, 첫 운동과 같은 규칙)');
  t.eq(await page.locator('[data-ss-suggest]').count(), 0, '이미 넣었으면 제안은 사라짐');
  await page.fill('#exSets', '2');
  await page.dispatchEvent('#exSets', 'input');
  t.eq(await page.evaluate(() => partners[0].sets.length), 2, '세트 수는 위 칸 하나로 같이');
  await page.fill('[data-pps="0:1:reps"]', '6');
  await page.click('#ssAdd');                                         // 세 번째 (자이언트 세트)
  await page.fill('[data-pn="1"]', '케이블플라이');
  await wait(page, 50);
  t.eq(await page.evaluate(() => partners[1].sets.length), 2, '세 번째 운동도 같은 세트 수');
  t.ok((await text(page, '#ssHint1')).includes('처음 하는 운동'), '처음 하는 운동이면 그렇게 알려줌');
  await page.click('#workoutForm button[type=submit]');
  const ws = await page.evaluate(() => day().workouts.map((w) => ({ name: w.name, ss: w.ss ?? null, sets: w.sets.map((x) => [x.weight, x.reps]) })));
  t.eq(ws.map((w) => w.name), ['벤치프레스', '바벨로우', '케이블플라이'], '"운동 추가" 한 번에 셋이 순서대로');
  t.ok(ws[0].ss && ws.every((w) => w.ss === ws[0].ss) && ws[0].ss !== 'old', '처음부터 한 묶음 (지난번 표시와는 다른 새 표시)');
  t.eq(ws[1].sets, [[52.5, 8], [52.5, 6]], '두 번째 운동에 적은 값 그대로');
  t.eq(await page.evaluate(() => focusQueue().map((x) => `${x.w.name[0]}${x.i + 1}`)), ['벤1', '바1', '케1', '벤2', '바2', '케2'], '집중 모드는 바로 번갈아');
  t.eq(await page.evaluate(() => partners.length), 0, '추가하면 폼의 슈퍼세트 칸은 비워짐');
  t.ok(await page.locator('#ssBox').isHidden(), '빈 칸은 숨김');
  // 빈 이름 칸은 무시
  await page.fill('#exName', '스쿼트');
  await page.click('#ssAdd');
  await page.click('#workoutForm button[type=submit]');
  t.eq(await page.evaluate(() => day().workouts.at(-1).ss ?? null), null, '두 번째 이름을 비워 두면 그냥 한 운동으로');
  await page.click('#ssAdd');
  await page.click('[data-pdel="0"]');
  t.eq(await page.evaluate(() => partners.length), 0, '✕로 뺄 수 있음');

  // ── 휴대폰 화면 ──
  await page.evaluate(() => {
    const mk = (id, name, ss) => ({ id, name, ...(ss ? { ss } : {}), sets: [{ weight: 60, reps: 10, done: true, doneAt: Date.now() }] });
    day().workouts = [mk('a', '벤치프레스', 'g'), mk('b', '바벨로우', 'g'), mk('c', '사이드레터럴레이즈')];
    save(); render();
  });
  await page.click('#ssAdd');
  for (const w of [375, 320]) {
    await page.setViewportSize({ width: w, height: 800 });
    const r = await page.evaluate(() => ({
      over: document.documentElement.scrollWidth - innerWidth,
      small: [...document.querySelectorAll('#workoutList [data-ss-link], #workoutList .drop-inline, #ssAdd, #ssBox button, #ssBox input')].filter((x) => x.getBoundingClientRect().height < 40).length,
      font: Math.min(...[...document.querySelectorAll('#ssBox input')].map((x) => parseFloat(getComputedStyle(x).fontSize))),
    }));
    t.ok(r.over <= 0, `${w}px 가로 스크롤 없음`);
    t.eq(r.small, 0, `${w}px 묶기·드롭·폼 슈퍼세트 칸 40px 이상`);
    t.ok(r.font >= 16, `${w}px 폼 슈퍼세트 입력칸 16px 이상`);
  }
  t.noErrors(page);
}
