// 오늘의 운동 (profile.split, day.split): 분할·쉬는 요일 정하기, 순서상 오늘 차례, 주간 띠,
// 운동 전에 오늘 할 분할 고르기, "지난번 그 분할대로 시작"(순서·슈퍼세트·워밍업·드롭, 무게는 최근 기록 + 과부하),
// 쉬는 날 안내, 운동 중엔 한 줄, 기록 탭 요약·검색.
import { tab, text, wait } from './lib.mjs';

export default async function (t) {
  const page = await t.open();
  await tab(page, 'workouts');
  const card = () => text(page, '#splitCard');
  const hidden = () => page.evaluate(() => $('#splitCard').hidden);

  // ── 안 정했으면: 빈 날에만 한 줄 권유 ──
  t.ok(!(await hidden()) && (await card()).includes('분할 정하기'), '분할을 안 정했으면 권유가 보임');
  await page.evaluate(() => { day().workouts.push({ id: 'x', name: '벤치프레스', sets: [{ weight: 60, reps: 10, done: false }] }); save(); render(); });
  t.ok(await hidden(), '운동이 있는 날엔 권유를 숨김 (카드가 주인공)');
  await page.evaluate(() => { day().workouts = []; save(); render(); });

  // ── 정하기: n분할·이름·쉬는 요일 ──
  await page.click('[data-split-setup]');
  t.eq(await page.evaluate(() => [...document.querySelectorAll('[data-split-name]')].map((x) => x.value)), ['가슴·삼두', '등·이두', '하체·어깨'], '처음엔 3분할 기본 이름');
  await page.click('[data-split-n="4"]');
  t.eq(await page.evaluate(() => [...document.querySelectorAll('[data-split-name]')].map((x) => x.value)), ['가슴', '등', '하체', '어깨·팔'], '4분할을 누르면 4칸');
  await page.fill('[data-split-name="3"]', '어깨');
  await page.click('[data-split-rest="3"]');   // 수요일
  t.eq(await page.evaluate(() => [...document.querySelectorAll('[data-split-name]')].map((x) => x.value)), ['가슴', '등', '하체', '어깨'], '요일을 눌러도 고친 이름이 남음');
  await page.click('[data-split-save]');
  t.eq(await page.evaluate(() => state.profile.split), { days: ['가슴', '등', '하체', '어깨'], rest: [0, 3] }, '저장: 4분할, 일·수 휴식');
  t.ok(JSON.parse(await page.evaluate(() => localStorage.getItem('fitness-log-v1'))).profile.split.days.length === 4, 'localStorage에 저장됨');

  // ── 같은 이름 두 개는 번호를 붙임 (순서를 따라가야 하니까) ──
  await page.click('[data-split-setup]');
  await page.fill('[data-split-name="1"]', '가슴');
  await page.click('[data-split-save]');
  t.eq(await page.evaluate(() => state.profile.split.days), ['가슴', '가슴 2', '하체', '어깨'], '겹치는 이름은 "가슴 2"로');
  await page.click('[data-split-setup]');
  await page.click('[data-split-cancel]');
  t.eq(await page.evaluate(() => state.profile.split.days[1]), '가슴 2', '취소하면 그대로');

  // ── 순서: 분할을 적고 운동한 마지막 날 다음 차례 ──
  // 날짜를 고정해 요일을 정한다: 2026-10-06(화) 보고 있음, 그 주 월요일 10-05.
  await page.evaluate(() => {
    const mk = (name, w, extra = {}) => ({ id: uid(), name, sets: [1, 2, 3].map(() => ({ weight: w, reps: 10, done: true })), ...extra });
    state.profile.split = { days: ['가슴·삼두', '등·이두', '하체·어깨'], rest: [0, 3] };
    state.days = {
      '2026-09-29': { meals: [], note: '', split: '하체·어깨', workouts: [
        mk('스쿼트', 100, { sets: [{ weight: 50, reps: 10, done: true, warmup: true }, ...[1, 2, 3].map(() => ({ weight: 100, reps: 10, done: true }))] }),
        mk('레그프레스', 180, { sets: [{ weight: 180, reps: 10, done: true, drops: [{ weight: 140, reps: 10 }] }, { weight: 180, reps: 10, done: true }] }),
        mk('사이드레터럴레이즈', 8, { ss: 'q' }), mk('리어델트플라이', 6, { ss: 'q' })] },
      '2026-10-01': { meals: [], note: '', workouts: [mk('러닝', 0)] },                       // 분할 안 적은 날은 순서에 안 셈
      '2026-10-02': { meals: [], note: '', split: '가슴·삼두', workouts: [mk('벤치프레스', 60)] },
      '2026-10-03': { meals: [], note: '', split: '등·이두', workouts: [] },                  // 골라만 두고 안 한 날도 안 셈
      '2026-10-05': { meals: [], note: '', split: '등·이두', workouts: [mk('랫풀다운', 55)] },
    };
    currentDate = '2026-10-06';
    save(); render();
  });
  t.eq(await page.evaluate(() => [lastSplitDay().date, nextSplit()]), ['2026-10-05', '하체·어깨'], '마지막으로 한 분할(등·이두) 다음 = 하체·어깨');
  t.ok((await card()).includes('오늘은 하체·어깨 차례') && (await card()).includes('3분할 3일차'), '오늘 차례와 몇 일차인지 보임');
  t.eq(await page.evaluate(() => nextSplit('2026-10-02')), '가슴·삼두', '분할을 안 적은 날(러닝)은 건너뛰고 09-29 하체·어깨 다음');
  t.eq(await page.evaluate(() => nextSplit('2026-10-05')), '등·이두', '골라만 두고 운동 안 한 날(10-03 등·이두)은 안 셈 → 10-02 가슴·삼두 다음');

  // ── 주간 띠 ──
  const week = await page.evaluate(() => [...document.querySelectorAll('.split-day')].map((x) => [x.querySelector('span').textContent, x.querySelector('b').textContent, x.className.replace('split-day', '').trim()]));
  t.eq(week, [['월', '등', 'done'], ['화', '하체', 'today'], ['수', '휴식', 'rest'], ['목', '가슴', 'next'], ['금', '등', 'next'], ['토', '하체', 'next'], ['일', '휴식', 'rest']],
    '이번 주 띠: 지난 날은 한 것, 오늘부터는 쉬는 요일 건너뛰고 순서대로 (칸이 좁아 첫 부위만)');
  t.eq(await page.evaluate(() => document.querySelector('.split-day.today').title), '하체·어깨', '전체 이름은 title로');

  // ── 지난번 그 분할 ──
  const c = await card();
  t.ok(c.includes('지난번 하체·어깨') && c.includes('4종') && c.includes('스쿼트') && c.includes('리어델트플라이'), '지난번 하체·어깨 날의 운동 목록');
  t.ok(c.includes('지난번 하체·어깨대로 시작'), '그대로 시작 버튼');

  // ── 운동 전에 오늘 할 분할 고르기 ──
  await page.click('[data-split-pick="가슴·삼두"]');
  t.eq(await page.evaluate(() => day().split), '가슴·삼두', '칩을 누르면 오늘 분할로 적힘 (운동 전 기록)');
  t.ok((await card()).includes('오늘은 가슴·삼두 차례') && (await card()).includes('벤치프레스'), '고른 분할의 지난번 기록으로 바뀜');
  t.eq(await page.evaluate(() => document.querySelector('.split-pick .chip.on')?.textContent), '가슴·삼두', '고른 칩이 켜짐');
  await page.click('[data-split-pick="하체·어깨"]');

  // ── 지난번대로 시작: 순서·슈퍼세트·워밍업·드롭, 무게는 최근 기록 + 과부하 ──
  await page.click('[data-split-start="하체·어깨"]');
  const ws = await page.evaluate(() => day().workouts.map((w) => ({ name: w.name, ss: !!w.ss, sets: w.sets.map((s) => [s.weight, s.reps, !!s.warmup, (s.drops || []).length, !!s.done]) })));
  t.eq(ws.map((w) => w.name), ['스쿼트', '레그프레스', '사이드레터럴레이즈', '리어델트플라이'], '지난번 순서 그대로');
  t.eq(ws[0].sets, [[50, 10, true, 0, false], [102.5, 10, false, 0, false], [102.5, 10, false, 0, false], [102.5, 10, false, 0, false]], '워밍업 그대로(무게 안 올림), 본 세트는 다 채웠으니 +2.5, 완료 체크는 비움');
  t.eq(ws[1].sets.map((s) => s[3]), [1, 0], '드롭 모양도 따라옴');
  t.eq([ws[2].ss, ws[3].ss], [true, true], '슈퍼세트 묶음 그대로');
  t.eq(await page.evaluate(() => { const w = day().workouts; return w[2].ss === w[3].ss && w[2].ss !== 'q'; }), true, '슈퍼세트 표시는 새로 (지난 날과 안 섞이게)');
  t.eq(await page.evaluate(() => day().split), '하체·어깨', '시작하면 오늘 분할이 적힘');

  // ── 운동 중엔 한 줄 ──
  t.ok((await card()).includes('오늘: 하체·어깨') && !(await page.$('.split-week')), '운동이 있으면 한 줄로 접힘');
  await page.click('[data-split-change]');
  t.eq(await page.$$eval('[data-split-pick]', (x) => x.length), 3, '바꾸기를 누르면 칩');
  await page.click('[data-split-pick="등·이두"]');
  t.eq(await page.evaluate(() => day().split), '등·이두', '운동 중에도 바꿀 수 있음');
  t.eq(await page.$$eval('[data-split-pick]', (x) => x.length), 0, '고르면 칩이 다시 접힘');

  // ── 운동은 했는데 분할을 안 적었으면 적게 한다 ──
  await page.evaluate(() => { delete day().split; save(); render(); });
  t.ok((await card()).includes('어느 날이었나요'), '분할 안 적은 운동 날: 적으라고 물음');
  await page.click('[data-split-pick="하체·어깨"]');
  t.eq(await page.evaluate(() => day().split), '하체·어깨', '칩으로 적힘');

  // ── 직접 넣을게요: 분할만 적고 폼으로 ──
  await page.evaluate(() => { currentDate = '2026-10-09'; render(); });   // 금요일, 기록 없음
  t.eq(await page.evaluate(() => todaySplit()), '가슴·삼두', '오늘(10-06) 하체·어깨 다음 = 가슴·삼두');
  await page.click('[data-split-own="가슴·삼두"]');
  t.eq(await page.evaluate(() => [day().split, document.activeElement?.id]), ['가슴·삼두', 'exName'], '분할을 적고 운동 이름 칸으로');

  // ── 기록이 없는 분할 ──
  await page.evaluate(() => { state.profile.split.days.push('전신'); delete day().split; state.days['2026-10-08'] = { meals: [], note: '', split: '하체·어깨', workouts: [{ id: 'z', name: '스쿼트', sets: [{ weight: 100, reps: 5 }] }] }; save(); render(); });
  t.eq(await page.evaluate(() => todaySplit()), '전신', '새로 넣은 분할 차례');
  t.ok((await card()).includes('아직 전신 기록이 없어요') && !(await page.$('[data-split-start]')), '기록 없는 분할은 안내와 "전신로 시작"만');

  // ── 쉬는 날 ──
  await page.evaluate(() => { currentDate = '2026-10-07'; render(); });   // 수요일
  t.ok((await card()).includes('오늘은 쉬는 날이에요') && (await card()).includes('다음 운동은'), '쉬는 요일엔 휴식 안내 + 다음 차례');
  await page.click('[data-rest-anyway]');
  t.ok((await card()).includes('차례') && !!(await page.$('[data-split-own]')), '그래도 운동할래요 → 평소 화면');
  t.eq(await page.evaluate(() => isRestDay('2026-10-07') && !day().split), true, '휴식일 설정·기록은 안 바뀜');

  // ── 기록 탭: 요약·검색, 이 날 운동 불러오기도 분할을 따라옴 ──
  await page.evaluate(() => { currentDate = '2026-10-06'; render(); });
  await tab(page, 'history');
  t.ok(await page.evaluate(() => dayText(state.days['2026-09-29']).includes('하체·어깨')), '검색 글에 분할 이름이 들어감');
  t.ok(await page.evaluate(() => calDetailHtml('2026-09-29').includes('<span class="cal-split">하체·어깨</span>')), '달력 그 날 보기에 분할 이름');
  await page.evaluate(() => { currentDate = '2026-10-10'; render(); });
  await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<button id="cp" data-copy-day="2026-09-29">x</button>'));
  await page.click('#cp');
  t.eq(await page.evaluate(() => [state.days['2026-10-10'].split, state.days['2026-10-10'].workouts.length]), ['하체·어깨', 4], '이 날 운동 불러오기: 분할도 따라옴');

  // ── 동기화: 분할은 day의 값이라 최근 쪽 ──
  const merged = await page.evaluate(() => {
    state.days['2026-10-11'] = { meals: [], note: '', workouts: [], split: '가슴·삼두', updatedAt: 1 };
    mergeState({ days: { '2026-10-11': { meals: [], note: '', workouts: [], split: '등·이두', updatedAt: 2 } } });
    return state.days['2026-10-11'].split;
  });
  t.eq(merged, '등·이두', '동기화: 최근에 고친 쪽 분할');

  // ── 분할 안 쓰기 ──
  await tab(page, 'workouts');
  await page.evaluate(() => { currentDate = '2026-10-12'; render(); });
  await page.click('[data-split-setup]');
  await page.click('[data-split-clear]');
  t.eq(await page.evaluate(() => state.profile.split), null, '분할 안 쓰기');
  t.eq(await page.evaluate(() => state.days['2026-09-29'].split), '하체·어깨', '지난 기록의 분할 이름은 그대로');

  // ── 망가진 설정이 와도 안 깨짐 ──
  await page.evaluate(() => { state.profile.split = { days: ['a', 'b'], rest: '0' }; render(); });
  t.ok(await page.evaluate(() => isRestDay('2026-10-11') === false), 'rest가 배열이 아니면 휴식일 없음');

  // ── 휴대폰 화면 ──
  await page.evaluate(() => { state.profile.split = { days: ['가슴·삼두', '등·이두', '하체·어깨'], rest: [0, 3] }; currentDate = '2026-10-06'; delete state.days['2026-10-06']; render(); });
  for (const vw of [375, 320]) {
    await page.setViewportSize({ width: vw, height: 800 });
    const r = await page.evaluate(() => ({
      over: document.documentElement.scrollWidth - innerWidth,
      cardOver: [...document.querySelectorAll('#splitCard *')].filter((x) => x.getBoundingClientRect().right > innerWidth + 0.5).length,
      small: [...document.querySelectorAll('#splitCard button:not(.link-btn)')].filter((x) => x.getBoundingClientRect().height < 40).length,
    }));
    t.ok(r.over <= 0 && r.cardOver === 0, `${vw}px 가로 넘침 없음`);
    t.eq(r.small, 0, `${vw}px 버튼 40px 이상`);
  }
  t.noErrors(page);
}
