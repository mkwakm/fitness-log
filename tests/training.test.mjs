// 운동을 이어가게 돕는 것들: 최고 기록·1RM, 과부하 제안, 휴식, 자동완성, 루틴·계획, 꾸준함, 주간 리포트, 밸런스
import { tab, text, wait, ago } from './lib.mjs';

const seed = (page, days) => page.evaluate((days) => {
  state.days = {};
  for (const [off, workouts, extra] of days) {
    const d = shiftDate(todayStr(), off);
    state.days[d] = { meals: [], note: '', updatedAt: 1, ...(extra || {}),
      workouts: workouts.map(([name, sets, minutes], i) => ({ id: `w${off}_${i}`, name, minutes: minutes ?? null,
        sets: sets.map(([weight, reps, done = true]) => ({ weight, reps, done })) })) };
  }
  currentDate = todayStr(); save(); render();
}, days);

export default async function (t) {
  let answer;   // prompt에 돌려줄 값 (undefined면 기본 제안 그대로)
  const page = await t.open({ dialog: (d) => (d.type() === 'prompt' ? d.accept(answer ?? d.defaultValue()) : d.accept()) });
  await tab(page, 'workouts');

  // ── 1RM: 100×1보다 90×8이 센 기록 ──
  t.eq(await page.evaluate(() => [oneRM(100, 1), oneRM(90, 8), oneRM(60, 12), oneRM(60, 20), oneRM(0, 10)]),
    [100, 114, 84, 84, 0], '1RM: 1회는 그 무게, 12회 넘으면 12회로 제한');
  await seed(page, [[-5, [['벤치프레스', [[100, 1]]]]], [-2, [['벤치프레스', [[90, 8]]]]]]);
  t.eq(await page.evaluate(() => personalBest('벤치프레스')), { weight: 90, reps: 8, rm: 114, date: ago(2) },
    '최고 기록은 1RM 기준 (90×8 > 100×1)');
  await seed(page, [[-5, [['벤치프레스', [[80, 5]]]]], [0, [['벤치프레스', [[80, 5]]]]]]);
  t.eq(await page.evaluate(() => personalBest('벤치프레스').date), ago(5), '동점이면 먼저 세운 날이 남음 (신기록 아님)');
  t.ok(!(await text(page, '#workoutList')).includes('신기록'), '같은 기록을 다시 찍은 날엔 🎉 안 뜸');
  await seed(page, [[-5, [['벤치프레스', [[80, 5]]]]], [0, [['벤치프레스', [[85, 5]]]]]]);
  t.ok((await text(page, '#workoutList')).includes('신기록'), '넘기면 🎉 신기록');
  t.eq(await page.evaluate(() => personalBest('턱걸이')), null, '기록 없으면 null');
  await seed(page, [[-1, [['턱걸이', [[null, 8], [null, 12]]]]]]);
  t.eq(await page.evaluate(() => personalBest('턱걸이').reps), 12, '맨몸 운동은 횟수로');

  // ── 점진적 과부하 제안 ──
  const tip = async (sets) => { await seed(page, [[-2, [['벤치프레스', sets, 30]]]]); return page.evaluate(() => overloadTip('벤치프레스')); };
  t.eq(await tip([[60, 10], [60, 10], [60, 10], [60, 10]]), { kind: 'weight', from: 60, to: 62.5, step: 2.5, varied: false, reps: 10, date: ago(2) }, '다 채웠으면 +2.5kg');
  t.eq(await tip([[60, 10], [60, 10], [60, 8], [60, 6]]), null, '마지막에 횟수가 떨어졌으면 제안 안 함');
  t.eq(await tip([[60, 10], [60, 10, false], [60, 10, false]]), null, '완료 세트가 하나뿐이면 보류');
  t.eq((await tip([[null, 12], [null, 12], [null, 13]]))?.kind, 'reps', '맨몸이면 횟수를 올리자고 함');
  t.eq((await tip([[null, 12], [null, 12], [null, 13]]))?.to, 14, '맨몸은 +2회');
  await page.fill('#weightStep', '5');
  await page.dispatchEvent('#weightStep', 'input');
  t.eq((await tip([[60, 10], [60, 10], [60, 11]]))?.to, 65, '± 단위를 5로 바꾸면 제안도 +5kg');
  await page.fill('#weightStep', '2.5');
  await page.dispatchEvent('#weightStep', 'input');
  await tip([[60, 10], [60, 10], [60, 10]]);
  const rowW = () => page.locator('[data-ps$=":weight"]').evaluateAll((els) => els.map((e) => e.value));
  await page.fill('#exName', '벤치프레스');
  await wait(page, 80);
  t.eq(await rowW(), ['62.5', '62.5', '62.5'], '다 채웠으면 폼의 세트별 표에 +2.5kg을 미리 채움');
  t.ok((await text(page, '#exHint')).includes('지난번'), '폼에 지난 기록이 뜸');
  await page.fill('[data-ps="0:weight"]', '50');
  await page.fill('#exName', '벤치프레스 ');
  await wait(page, 80);
  t.eq((await rowW())[0], '50', '직접 적은 중량은 안 건드림');
  await page.click('#perSetToggle');
  t.eq(await page.inputValue('#exWeight'), '50', '"모든 세트 같게"로 바꾸면 표의 1세트 값이 한 칸으로');
  await page.click('#perSetToggle');
  await page.fill('#exName', '');

  // ── 세트 사이 휴식 ──
  const gaps = await page.evaluate(() => {
    const now = Date.now();
    const w = { sets: [{ done: true, doneAt: now - 210000 }, { done: true, doneAt: now - 120000 }, { done: true, doneAt: now },
      { done: true, doneAt: now + 30 * 60000 }] };
    return { gaps: restGaps(w), avg: avgRest(w) };
  });
  t.eq(gaps, { gaps: [90, 120], avg: 105 }, '휴식 간격 90·120초, 20분 넘는 공백은 뺌');

  // ── 자동완성 ──
  await seed(page, [[0, [['나만의운동', [[20, 10]]], ['  벤치프레스  ', [[60, 10]]]]]]);
  const opts = await page.locator('#exSuggestions option').evaluateAll((o) => o.map((x) => x.value));
  t.ok(opts.indexOf('나만의운동') < opts.indexOf('스쿼트'), '내가 쓴 이름이 흔한 운동보다 앞');
  t.eq(opts.filter((o) => o.trim() === '벤치프레스').length, 1, '공백만 다른 이름은 한 번만');
  t.ok(opts.length >= 54, `흔한 운동 목록 포함 (${opts.length}개)`);

  // ── 루틴 저장·불러오기 ──
  await seed(page, [[-1, [['벤치프레스', [[60, 10], [60, 10], [60, 10], [60, 10]]], ['인클라인덤벨프레스', [[22.5, 12], [22.5, 12], [22.5, 12]]]]]]);
  await page.evaluate(() => { currentDate = shiftDate(todayStr(), -1); render(); });
  answer = undefined;
  await page.click('#saveRoutineBtn');
  t.eq(await page.evaluate(() => Object.keys(state.profile.routines)), ['가슴 날'], '많이 한 부위로 이름 제안 (가슴 날)');
  const saved = await page.evaluate(() => state.profile.routines['가슴 날']);
  t.ok(saved.every((r) => !('weight' in r)), '루틴엔 중량을 저장 안 함');
  t.eq(saved.map((r) => [r.name, r.sets, r.reps]), [['벤치프레스', 4, 10], ['인클라인덤벨프레스', 3, 12]], '이름·세트·횟수 저장');

  await page.evaluate(() => { state.days[currentDate].workouts[0].sets.forEach((s) => { s.weight = 65; }); save(); });
  await page.evaluate(() => { currentDate = todayStr(); render(); });
  await page.click('[data-load-routine]');
  const loaded = await page.evaluate(() => day().workouts.map((w) => [w.name, w.sets.length, w.sets[0].weight, w.sets[0].done]));
  t.eq(loaded, [['벤치프레스', 4, 65, false], ['인클라인덤벨프레스', 3, 22.5, false]], '불러오면 중량은 최근 기록(65)에서, 완료 체크는 풀림');
  t.eq(await page.evaluate(() => day().plan), '가슴 날', '불러온 루틴이 곧 오늘의 계획');

  // ── 오늘의 계획 진행 ──
  let items = await page.evaluate(() => planItems().map((i) => [i.name, i.done, i.target, i.hit]));
  t.eq(items, [['벤치프레스', 0, 4, false], ['인클라인덤벨프레스', 0, 3, false]], '계획: 처음엔 0/4, 0/3');
  for (let i = 0; i < 4; i++) await page.locator('.set-no').nth(i).click();
  await page.evaluate(() => stopRest());
  items = await page.evaluate(() => planItems().map((i) => [i.done, i.hit]));
  t.eq(items, [[4, true], [0, false]], '벤치 4세트 완료하면 그 줄만 달성');
  t.ok((await text(page, '#planCard')).includes('1/2'), '카드에 1/2 완료');
  await page.evaluate(() => { state.profile.routines['가슴 날'][0].sets = 5; save(); render(); });
  t.eq(await page.evaluate(() => planItems()[0].target), 5, '루틴을 고치면 계획도 따라감 (이름만 저장하므로)');
  t.eq(await page.evaluate(() => state.days[shiftDate(todayStr(), 1)]?.plan ?? null), null, '계획은 그 날짜에만 걸림');

  answer = '등 날';
  await page.click('#saveRoutineBtn');
  t.eq((await page.evaluate(() => Object.keys(state.profile.routines))).sort(), ['가슴 날', '등 날'], '새 이름으로 하나 더 저장');
  await page.locator('[data-del-routine]').first().click();
  t.eq(await page.evaluate(() => Object.keys(state.profile.routines).length), 1, '루틴 삭제');
  await page.click('#undoBtn');
  t.eq(await page.evaluate(() => Object.keys(state.profile.routines).length), 2, '되돌리기');

  // ── 꾸준함 ──
  await seed(page, [[-1, [['스쿼트', [[80, 8]]]]], [-2, [['스쿼트', [[80, 8]]]]], [-3, [['스쿼트', [[80, 8]]]]], [-5, [['스쿼트', [[80, 8]]]]]]);
  t.eq(await page.evaluate(() => workoutStreak()), 3, '오늘 안 했어도 어제까지 3일 연속은 살아 있음');
  await seed(page, [[-2, [['스쿼트', [[80, 8]]]]]]);
  t.eq(await page.evaluate(() => workoutStreak()), 0, '어제도 안 했으면 0');

  // ── 주간 리포트 ──
  const mk = (off, n, kg) => [off, [['벤치프레스', Array.from({ length: n }, () => [kg, 10]), 30]],
    { meals: [{ id: 'm' + off, type: '점심', name: '밥', amount: '1공기', kcal: 300 }] }];
  await seed(page, [mk(-13, 3, 55), mk(-10, 3, 55), mk(-5, 4, 60), mk(-3, 4, 60), mk(-2, 4, 62.5), mk(0, 4, 65)]);
  const rep = await page.evaluate(() => { const r = weekReport(); return { now: [r.now.days, r.now.sets, r.now.mealDays], prev: [r.prev.days, r.prev.sets], prs: r.prs }; });
  t.eq(rep, { now: [4, 16, 4], prev: [2, 6], prs: ['벤치프레스'] }, '이번 주 4일·16세트, 지난주 2일·6세트, 신기록 모음');
  await tab(page, 'history');
  t.ok((await text(page, '#reportBody')).includes('+100%'), '운동한 날 +100%');
  t.ok((await text(page, '#reportBody')).includes('300 kcal'), '평균 섭취는 기록한 날로만 나눔 (300)');

  // ── 부위별 밸런스와 주간 목표 ──
  await seed(page, [[-1, [['벤치프레스', [[60, 10], [60, 10], [60, 10]]]]], [-4, [['스쿼트', [[80, 8]]]]]]);
  await tab(page, 'history');
  t.ok((await text(page, '#balanceHint')).includes('차례'), '오래 쉰 부위를 "오늘은 ○○ 차례"로 제안');
  t.ok(!(await text(page, '#balanceHint')).includes('가슴'), '어제 한 가슴은 제안 안 함');
  await page.click('#balanceCard .help summary');
  await page.locator('[data-part-goal="가슴"]').fill('12');
  await page.evaluate(() => { document.activeElement.blur(); renderBalance(); });
  t.ok((await text(page, '#balanceList')).includes('3/12'), '목표를 정하면 3/12');
  t.ok((await text(page, '#balanceHint')).includes('가슴 9세트'), '남은 세트 안내');
  await page.click('[data-range="30"]');
  t.ok(!(await text(page, '#balanceList')).includes('/12'), '30일 보기에선 주간 목표와 안 견줌');
  await page.click('[data-range="7"]');
  const kept = await page.evaluate(() => {
    const el = document.querySelector('[data-part-goal="등"]');
    el.focus(); el.value = '10'; renderHistory();
    return document.activeElement === el && el.value === '10';
  });
  t.ok(kept, '목표를 치는 중에 다시 그려도 칸이 안 날아감');

  // ── 지난 날 운동 통째로 불러오기 ──
  await page.evaluate(() => document.activeElement.blur());
  await page.locator('[data-copy-day]').first().click();
  t.ok(await page.evaluate(() => document.getElementById('workouts').classList.contains('active')), '불러오면 운동 탭으로');
  t.ok(await page.evaluate(() => day().workouts.every((w) => w.sets.every((s) => !s.done))), '불러온 세트는 완료 체크가 풀림');
  t.noErrors(page);
}
