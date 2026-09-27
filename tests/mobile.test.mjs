// 휴대폰 화면 규칙(가로 스크롤·16px·40px)과 기록이 많이 쌓였을 때의 속도
import { tab, wait } from './lib.mjs';

export default async function (t) {
  const page = await t.open();
  const gen = await page.evaluate(() => {
    const EX = ['벤치프레스', '스쿼트', '데드리프트', '랫풀다운', '오버헤드프레스', '바벨로우', '레그프레스', '턱걸이'];
    const FOOD = ['현미밥', '닭가슴살', '고구마', '바나나', '계란', '김치찌개'];
    state.days = {};
    for (let i = 0; i < 1100; i++) {
      state.days[shiftDate(todayStr(), -i)] = {
        note: i % 7 === 0 ? '컨디션' : '', weight: 70 + (i % 40) / 10,
        meals: [0, 1, 2].map((k) => ({ id: `m${i}-${k}`, type: '점심', name: FOOD[(i + k) % 6], amount: '150g', kcal: 200 + k * 50, protein: 20 })),
        workouts: i % 3 === 0 ? [] : [0, 1, 2].map((k) => ({ id: `w${i}-${k}`, name: EX[(i + k) % 8], note: k === 0 && i % 20 === 0 ? '메모' : null,
          sets: [0, 1, 2, 3].map(() => ({ weight: 40 + ((i * 3 + k) % 60), reps: 8 + (k % 4), done: true, doneAt: Date.now() })) })),
      };
    }
    save();
    return localStorage.getItem('fitness-log-v1').length;
  });
  t.ok(gen < 4 * 1024 * 1024, `3년치(1100일)가 ${(gen / 1024 / 1024).toFixed(2)}MB — localStorage 5MB 안`);

  const perf = await page.evaluate(() => {
    const time = (f) => { const a = performance.now(); f(); return Math.round(performance.now() - a); };
    return { render: time(render), history: time(renderHistory), save: time(save), sheet: time(() => { openExSheet('벤치프레스'); closeExSheet(); }) };
  });
  t.ok(perf.render < 800, `3년치 render ${perf.render}ms`);
  t.ok(perf.history < 500, `기록 탭 ${perf.history}ms`);
  t.ok(perf.save < 300, `저장 ${perf.save}ms`);
  t.ok(perf.sheet < 300, `운동 상세 ${perf.sheet}ms`);
  const t0 = Date.now();
  await page.reload();
  await page.waitForSelector('#mealList', { state: 'attached' });
  t.ok(Date.now() - t0 < 4000, `3년치로 새로 여는 데 ${Date.now() - t0}ms`);
  await tab(page, 'history');
  t.ok(await page.locator('#historyList .history-day').count() < 60, '기록 탭이 1100장을 한꺼번에 그리지 않음');

  // ── 화면 폭 ──
  for (const w of [375, 360, 320]) {
    await page.setViewportSize({ width: w, height: 812 });
    for (const name of ['meals', 'workouts', 'history']) {
      await tab(page, name);
      await wait(page, 120);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      t.ok(over <= 0, `${w}px ${name} 탭 가로 스크롤 없음${over > 0 ? ` (${over}px 넘침)` : ''}`);
    }
  }
  await page.setViewportSize({ width: 375, height: 812 });

  // ── 입력칸 16px, 자주 누르는 것 40px ──
  const audit = () => page.evaluate(() => {
    const small = [], tiny = [];
    document.querySelectorAll('button, input, select, textarea').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) && parseFloat(getComputedStyle(el).fontSize) < 16) tiny.push(el.id || el.className);
      // 문장 속 링크형 버튼은 예외 (자주 누르는 자리가 아님)
      if (r.height < 40 && !el.classList.contains('link-btn')) small.push(`${el.id || el.className || el.tagName}(${Math.round(r.height)})`);
    });
    return { small: [...new Set(small)], tiny: [...new Set(tiny)] };
  });
  for (const name of ['meals', 'workouts', 'history']) {
    await tab(page, name);
    const a = await audit();
    t.eq(a.tiny, [], `${name}: 16px 미만 입력칸 없음 (iOS 확대 방지)`);
    t.eq(a.small, [], `${name}: 40px 미만 버튼 없음`);
  }
  await page.evaluate(() => openExSheet('벤치프레스'));
  const s = await audit();
  t.eq(s.small, [], '운동 상세: 40px 미만 버튼 없음');
  t.noErrors(page);
}
