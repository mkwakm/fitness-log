// 기록 탭 맨 위 운동 달력: 날짜 밑에 한 부위, 누르면 그 날 운동(숫자 4개·운동별 세트 칩·슈퍼세트·워밍업·드롭·신기록),
// 달 넘기기, 이 날 열기·불러오기, 검색(🔍), 휴대폰 화면.
import { tab, text, wait } from './lib.mjs';

export default async function (t) {
  const page = await t.open();
  await page.evaluate(() => {
    const S = (weight, reps, x = {}) => ({ weight, reps, done: true, ...x });
    const W = (id, name, sets, x = {}) => ({ id, name, sets, ...x });
    state.days = {
      '2026-09-08': { meals: [], note: '', workouts: [W('o1', '벤치프레스', [S(70, 8), S(70, 8)])] },
      '2026-09-22': { meals: [], note: '', split: '등·이두', workouts: [W('o2', '랫풀다운', [S(55, 10), S(55, 10)]), W('o3', '바벨컬', [S(30, 10)])] },
      '2026-10-02': { meals: [], note: '어깨 컨디션 좋음', split: '가슴·삼두', workouts: [
        W('a', '벤치프레스', [S(40, 12, { warmup: true }), S(80, 6), S(80, 6, { drops: [{ weight: 60, reps: 8 }] }), { weight: 80, reps: 6, done: false }], { note: '그립 넓게' }),
        W('b', '케이블푸시다운', [S(25, 12), S(25, 12)], { ss: 'x' }),
        W('c', '트라이셉익스텐션', [S(15, 12), S(15, 12)], { ss: 'x' })] },
      '2026-10-05': { meals: [], note: '', workouts: [W('d', '스쿼트', [S(100, 5)]), W('e', '사이드레터럴레이즈', [S(8, 15)]), W('f', '바벨컬', [S(30, 10)]), W('g', '크런치', [S(0, 20)])] },
      '2026-10-07': { meals: [{ id: 'm1', type: '점심', name: '제육덮밥', amount: '1인분', kcal: 820, protein: 32 }], note: '', workouts: [] },
      '2026-10-08': { meals: [], note: '', workouts: [W('h', '이상한운동', [S(10, 10)])] },
      '2026-10-12': { meals: [], note: '', workouts: [W('i', '이상한운동', [S(10, 10), S(10, 10), S(10, 10)]), W('j', '데드리프트', [S(120, 5)])] },
    };
    currentDate = '2026-10-15';
    save(); render();
  });
  await tab(page, 'history');

  // ── 맨 위, 이 달 ──
  t.eq(await page.evaluate(() => document.querySelector('#history > .card:not([hidden])')?.id), 'calCard', '기록 탭 맨 위가 달력');
  t.ok((await text(page, '#calTop')).includes('2026년 10월'), '보고 있는 날의 달');
  t.ok((await text(page, '#calTop')).includes('4일 운동'), '이 달 운동한 날 수');
  t.eq(await page.$$eval('.cal-wd', (x) => x.map((e) => e.textContent).join('')), '월화수목금토일', '월요일 시작');
  t.eq(await page.$$eval('#calGrid > *', (x) => x.findIndex((e) => e.dataset.cal === '2026-10-01')), 7 + 3, '10월 1일(목) 앞은 빈칸 3개');
  t.eq(await page.$$eval('.cal-day', (x) => x.length), 31, '이 달 날짜만 버튼');

  // ── 날짜 밑엔 부위만 ──
  const under = (d) => page.$$eval(`[data-cal="${d}"] span`, (x) => x.map((e) => e.textContent));
  t.eq(await under('2026-10-02'), ['팔', '가슴'], '세트 많은 부위부터 (팔 4세트, 가슴 3세트)');
  t.eq(await under('2026-10-05'), ['하체', '어깨+2'], '셋 이상이면 둘째 칸에 +N');
  t.eq(await under('2026-10-08'), ['운동'], '부위를 모르는 운동만 했으면 "운동"');
  t.eq(await under('2026-10-12'), ['하체'], '모르는 운동이 더 많아도 아는 부위가 있으면 그것만');
  t.ok(!!(await page.$('[data-cal="2026-10-07"] .cal-dot')) && (await under('2026-10-07')).length === 0, '식단만 적은 날은 점만');
  t.ok(await page.$eval('[data-cal="2026-10-02"]', (e) => e.classList.contains('work')), '운동한 날은 색칸');

  // ── 처음엔 보고 있는 날 전 마지막 운동한 날 ──
  t.eq(await page.$eval('.cal-day.pick', (e) => e.dataset.cal), '2026-10-12', '따로 안 누르면 최근 운동한 날이 골라져 있음');

  // ── 누르면 그 날 운동 ──
  await page.click('[data-cal="2026-10-02"]');
  const det = await text(page, '#calDetail');
  t.ok(det.includes('10월 2일 금요일'), '날짜·요일');
  t.ok(det.includes('가슴·삼두'), '분할 이름');
  t.eq(await page.$$eval('.cal-stats strong', (x) => x.map((e) => e.textContent)), ['3종목', '6세트', '2,400kg', `${await page.evaluate(() => ['a', 'b', 'c'].reduce((n, id) => n + minutesOf(state.days['2026-10-02'].workouts.find((w) => w.id === id)), 0))}분`],
    '종목·본 세트(워밍업·안 한 세트 빼고)·볼륨(드롭 포함)·시간');
  t.eq(await page.$$eval('.cal-ex-name', (x) => x.map((e) => e.textContent)), ['벤치프레스', '케이블푸시다운', '트라이셉익스텐션'], '운동 순서대로');
  const chips = await page.$$eval('.cal-ex:first-child .cal-set', (x) => x.map((e) => [e.textContent, e.className]));
  t.eq(chips.map((c) => c[0]), ['W40kg×12', '80×6', '80×6 ↘ 60×8', '80×6'], '세트 칩: 첫 칩에만 kg, 드롭은 ↘로 이어서');
  t.eq(chips.map((c) => c[1].replace('cal-set', '').trim()), ['wu', '', '', 'skip'], '워밍업은 점선, 체크 안 한 세트는 흐리게');
  t.eq(await page.$$eval('.cal-ss .cal-ex-name', (x) => x.map((e) => e.textContent)), ['케이블푸시다운', '트라이셉익스텐션'], '슈퍼세트는 한 묶음으로');
  t.ok(det.includes('그립 넓게') && det.includes('어깨 컨디션 좋음'), '운동 메모·날짜 메모');
  t.ok(await page.$eval('.cal-ex:first-child', (e) => e.querySelector('.cal-pr') !== null), '예전 기록(09-08 70kg)을 넘으면 🏆');
  t.ok(await page.$$eval('.cal-ss .cal-pr', (x) => x.length === 0), '처음 해 본 운동은 🏆 없음');
  t.eq(await page.evaluate(() => currentDate), '2026-10-15', '누르기만 하면 날짜는 안 바뀜 (보기만)');
  t.eq(await page.$eval('.cal-day.pick', (e) => e.dataset.cal), '2026-10-02', '누른 날 표시');

  await page.click('[data-cal="2026-10-07"]');
  t.ok((await text(page, '#calDetail')).includes('운동 기록이 없어요') && (await text(page, '#calDetail')).includes('820 kcal'), '운동 없는 날: 없다고 + 식단 한 줄');
  await page.click('[data-cal="2026-10-05"]');
  t.ok((await page.$$eval('.cal-set', (x) => x.map((e) => e.textContent))).includes('20회'), '맨몸은 횟수만');

  // ── 운동 이름 → 운동 상세 ──
  await page.click('.cal-ex-name >> text=스쿼트');
  t.ok(await page.evaluate(() => !$('#exSheet').hidden), '운동 이름을 누르면 운동 상세');
  await page.keyboard.press('Escape');

  // ── 달 넘기기 ──
  await page.click('[data-cal-nav="-1"]');
  t.ok((await text(page, '#calTop')).includes('2026년 9월'), '‹ 지난달');
  t.eq(await page.$eval('.cal-day.pick', (e) => e.dataset.cal), '2026-09-22', '지난달은 그 달 마지막 운동한 날');
  t.ok((await text(page, '#calDetail')).includes('랫풀다운'), '그 날 운동');
  await page.click('[data-cal-nav="-1"]');
  t.ok((await text(page, '#calDetail')).includes('이 달엔 운동 기록이 없어요'), '기록 없는 달');
  t.ok(!!(await page.$('[data-cal-nav="0"]')), '다른 달이면 "이번 달" 버튼');
  await page.click('[data-cal-nav="0"]');
  t.eq(await page.evaluate(() => calMonth), await page.evaluate(() => todayStr().slice(0, 7)), '"이번 달"로 돌아옴');
  await page.evaluate(() => { calMonth = '2026-09'; renderCalendar(); });

  // ── 이 날 열기 / 불러오기 ──
  await page.click('[data-cal="2026-09-22"]');
  await page.click('#calDetail [data-copy-day="2026-09-22"]');
  t.eq(await page.evaluate(() => [state.days['2026-10-15'].workouts.map((w) => w.name), state.days['2026-10-15'].split]), [['랫풀다운', '바벨컬'], '등·이두'], '불러오기: 보고 있는 날로 운동·분할');
  t.ok(await page.evaluate(() => $('#workouts').classList.contains('active')), '불러오면 운동 탭으로');
  await tab(page, 'history');
  await page.click('#calDetail [data-goto="2026-09-22"]');
  t.eq(await page.evaluate(() => [currentDate, $('#workouts').classList.contains('active')]), ['2026-09-22', true], '이 날 열기 → 그 날 운동 탭');
  await tab(page, 'history');
  await page.evaluate(() => { calMonth = '2026-10'; render(); });
  await page.click('[data-cal="2026-10-07"]');
  await page.click('#calDetail [data-goto="2026-10-07"]');
  t.ok(await page.evaluate(() => $('#meals').classList.contains('active')), '식단만 있는 날은 식단 탭으로');

  // ── 검색 ──
  await tab(page, 'history');
  t.ok(await page.evaluate(() => $('#calSearch').hidden), '검색칸은 접혀 있음');
  await page.click('[data-cal-search]');
  t.ok(await page.evaluate(() => !$('#calSearch').hidden && document.activeElement.id === 'historySearch'), '🔍 누르면 열리고 바로 입력');
  await page.fill('#historySearch', '바벨컬');
  await wait(page, 100);
  t.eq(await page.$$eval('#historyList .history-day', (x) => x.map((e) => e.dataset.calGo)), ['2026-10-15', '2026-10-05', '2026-09-22'], '찾은 날, 최근 순 (10-15는 방금 불러온 날)');
  t.ok((await text(page, '#historyList')).includes('등·팔'), '결과에 부위');
  await page.click('[data-cal-go="2026-09-22"]');
  t.eq(await page.evaluate(() => [calMonth, calPick]), ['2026-09', '2026-09-22'], '결과를 누르면 달력이 그 날로');
  await page.fill('#historySearch', '제육');
  await wait(page, 100);
  t.ok((await text(page, '#historyList')).includes('🍚 제육덮밥'), '식단으로도 찾음');
  await page.fill('#historySearch', '그립 넓게');
  await wait(page, 100);
  t.eq(await page.$$eval('#historyList .history-day', (x) => x.length), 1, '운동 메모로도 찾음');
  await page.fill('#historySearch', '없는말ㅁㄴㅇ');
  await wait(page, 100);
  t.ok((await text(page, '#historyList')).includes('검색 결과가 없어요'), '없으면 안내');
  await page.click('[data-cal-search]');
  t.ok(await page.evaluate(() => $('#calSearch').hidden && $('#historySearch').value === ''), '🔍 다시 누르면 닫히고 비움');
  await page.evaluate(() => {
    for (let i = 0; i < 100; i++) state.days[shiftDate('2026-08-01', -i)] = { meals: [], note: '', workouts: [{ id: 'z' + i, name: '바벨컬', sets: [{ weight: 20, reps: 10 }] }] };
    save(); render();
  });
  await page.click('[data-cal-search]');
  await page.fill('#historySearch', '바벨컬');
  await wait(page, 100);
  t.eq(await page.$$eval('#historyList .history-day', (x) => x.length), 60, '결과는 60개까지만');
  t.ok((await text(page, '#historyList')).includes('모두 103일'), '몇 개 더 있는지 알려줌');
  await page.click('[data-cal-search]');

  // ── 휴대폰 화면 ──
  await page.evaluate(() => { calMonth = '2026-10'; calPick = '2026-10-02'; renderCalendar(); });
  for (const vw of [375, 320]) {
    await page.setViewportSize({ width: vw, height: 800 });
    const r = await page.evaluate(() => ({
      over: document.documentElement.scrollWidth - innerWidth,
      out: [...document.querySelectorAll('#calCard *')].filter((x) => x.getBoundingClientRect().right > innerWidth + 0.5).length,
      small: [...document.querySelectorAll('.cal-day, .cal-nav, .cal-find, .cal-actions button')].filter((x) => x.getBoundingClientRect().height < 40 || x.getBoundingClientRect().width < 32).length,   // 320px에서 날짜 칸은 34px 폭(높이 58px)
    }));
    t.ok(r.over <= 0 && r.out === 0, `${vw}px 가로 넘침 없음`);
    t.eq(r.small, 0, `${vw}px 날짜 칸·버튼 누르기 충분히 큼`);
  }
  t.noErrors(page);
}
