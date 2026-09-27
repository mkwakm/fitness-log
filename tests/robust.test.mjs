// 이상한 입력과 망가진 데이터에도 앱이 버티는지
import { tab, text, wait } from './lib.mjs';

export default async function (t) {
  const page = await t.open();

  // ── HTML을 이름에 넣어도 실행되지 않음 ──
  await page.evaluate(() => {
    const evil = '<img src=x onerror="window.__pwned=1">';
    state.days[todayStr()] = { meals: [{ id: '1', type: '아침', name: evil, amount: '"><b>x', kcal: 100 }],
      workouts: [{ id: '2', name: evil, note: '</span><script>window.__pwned=2<\/script>', sets: [{ weight: 10, reps: 5, done: true }] }], note: evil };
    save(); render();
  });
  await wait(page, 200);
  await tab(page, 'history');
  await page.evaluate(() => openExSheet(day().workouts[0].name));
  await wait(page, 200);
  t.ok(!(await page.evaluate(() => window.__pwned)), '이름·메모의 HTML이 실행되지 않음 (식단·운동·기록·상세)');
  t.eq(await page.evaluate(() => document.querySelectorAll('#workoutList img, #mealList img:not([data-photo]), #exSheet img').length), 0, '태그로 안 들어감');
  await page.keyboard.press('Escape');

  // ── 프로토타입 이름 ──
  const proto = await page.evaluate(() => {
    state.days = {};
    ['__proto__', 'constructor', 'toString', 'hasOwnProperty'].forEach((n, i) => {
      state.days[shiftDate(todayStr(), -i)] = { note: '', meals: [{ id: 'm' + i, type: '아침', name: n, amount: '100g', kcal: 50 }],
        workouts: [{ id: 'w' + i, name: n, sets: [{ weight: 10, reps: 5, done: true }] }] };
    });
    save(); render(); renderHistory();
    return { polluted: Object.prototype.polluted, fav: favoriteFoods().length, tally: [...partBalance()].flat().join(),
      met: [metOf('constructor'), metOf('__proto__')], toStr: typeof ({}).toString };
  });
  t.eq(proto.polluted, undefined, 'Object.prototype 안 더러워짐');
  t.eq(proto.fav, 4, '"constructor" 같은 음식 이름도 따로 집계');
  t.ok(!proto.tally.includes('NaN'), '부위 집계에 NaN 없음');
  t.eq(proto.met, [5, 5], 'MET 조회도 멀쩡');
  t.eq(proto.toStr, 'function', 'toString 안 망가짐');

  // ── 말도 안 되는 숫자 ──
  const nums = await page.evaluate(() => {
    state.days = {}; currentDate = todayStr();
    state.days[currentDate] = { note: '', weight: -5, meals: [{ id: 'a', type: '아침', name: '밥', amount: 'abc', kcal: -300 }],
      workouts: [{ id: 'b', name: '스쿼트', minutes: -10, sets: [{ weight: -50, reps: 1e9, done: true }, { weight: 'abc', reps: null, done: true }] }] };
    save(); render();
    return { intake: dayIntake(day()), vol: volumeOf(day().workouts[0]), burn: dayBurn(currentDate), bw: bodyWeight(currentDate) };
  });
  t.eq([nums.intake, nums.vol], [0, 0], '음수 칼로리·중량은 0으로 봄');
  t.ok(nums.burn >= 0 && Number.isFinite(nums.burn), '소모 칼로리도 유한한 양수');
  t.ok(nums.bw > 0, '음수 체중은 무시');
  await tab(page, 'workouts');
  t.ok(!(await text(page, 'main')).includes('NaN'), '화면 어디에도 NaN 없음');

  // ── 저장된 값이 깨져 있어도 열림 ──
  for (const junk of ['{"days":"망가짐","profile":null}', '{"days":{"2026-09-01":null},"profile":{}}',
    '{"days":{"2026-09-01":{"meals":null,"workouts":"x","note":5}},"profile":{"mets":"x"}}', '{{{ 깨진 JSON']) {
    await page.evaluate((j) => localStorage.setItem('fitness-log-v1', j), junk);
    page.errors.length = 0;
    await page.reload();
    await page.waitForSelector('#mealList', { state: 'attached' });
    const alive = await page.evaluate(() => { try { render(); renderHistory(); return !!state.days && Array.isArray(day().meals); } catch { return false; } });
    t.ok(alive && !page.errors.length, `깨진 저장값 ${junk.slice(0, 28)}… → 앱이 열림`);
  }

  // ── 아주 긴 이름 ──
  await page.evaluate(() => {
    state.days = { [todayStr()]: { meals: [], note: '', workouts: [{ id: 'x', name: '아'.repeat(300), note: '메'.repeat(500), sets: [{ weight: 10, reps: 5 }] }] } };
    save(); render();
  });
  await tab(page, 'workouts');
  t.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '300자 이름에도 가로 스크롤 없음');

  // ── 날짜 계산 가장자리 ──
  t.eq(await page.evaluate(() => [shiftDate('2028-02-28', 1), shiftDate('2026-12-31', 1), shiftDate('2027-01-01', -1), shiftDate('2026-03-31', 1)]),
    ['2028-02-29', '2027-01-01', '2026-12-31', '2026-04-01'], '윤년·연말·월말');
  t.eq(await page.evaluate(() => [weekStart('2026-09-27'), weekStart('2026-09-21')]), ['2026-09-21', '2026-09-21'], '주는 월요일에 시작 (일요일은 그 주 끝)');

  // ── 표기가 흔들리는 이름 ──
  const same = await page.evaluate(() => {
    state.days = {
      [shiftDate(todayStr(), -2)]: { meals: [], note: '', workouts: [{ id: 'p', name: ' 벤치프레스 ', sets: [{ weight: 60, reps: 10, done: true }] }] },
      [todayStr()]: { meals: [], note: '', workouts: [{ id: 'q', name: '벤치프레스', sets: [{ weight: 62.5, reps: 10, done: true }] }] },
    };
    return [exerciseLog('벤치프레스').length, lastRecord('벤치프레스')?.date === shiftDate(todayStr(), -2)];
  });
  t.eq(same, [2, true], '앞뒤 공백만 다른 이름은 같은 운동');
  t.noErrors(page);
}
