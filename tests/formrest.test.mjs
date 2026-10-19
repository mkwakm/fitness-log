// 운동 폼의 세트 수(−/+, 줄였다 늘려도 적어 둔 세트가 남음)와 운동마다 쉬는 시간(w.rest)
import { tab, text, wait, openEx } from './lib.mjs';

export default async function (t) {
  const page = await t.open();
  await tab(page, 'workouts');
  const rows = () => page.evaluate(() => perSet.map((s) => `${s.weight}x${s.reps}`));
  const fillRows = async (vals) => {
    for (const [i, [w, r]] of vals.entries()) {
      await page.fill(`[data-ps="${i}:weight"]`, String(w));
      await page.fill(`[data-ps="${i}:reps"]`, String(r));
    }
  };

  // ── 폼 모양: 시간 칸 대신 휴식 ──
  t.ok(!(await page.$('#exMinutes')), '폼에 시간(분) 칸 없음 (세트 수로 추정, 카드에서 고칠 수 있음)');
  t.eq(await page.inputValue('#exRest'), '90', '휴식은 기본 휴식(90초)으로');
  t.ok((await page.$$eval('#exRest option', (x) => x.map((o) => o.textContent))).includes('끄기'), '휴식 "끄기"도 고를 수 있음');

  // ── 세트 수: 숫자를 지웠다 다시 쳐도 적어 둔 세트가 남음 ──
  await page.fill('#exName', '스쿼트');
  await wait(page, 50);
  await page.click('[data-sets-step="1"]');
  t.eq(await page.inputValue('#exSets'), '4', '+ 누르면 4세트');
  await fillRows([[60, 10], [70, 9], [80, 8], [90, 7]]);
  await page.fill('#exSets', '');
  await page.dispatchEvent('#exSets', 'input');
  t.eq(await rows(), ['60x10', '70x9', '80x8', '90x7'], '숫자를 지우는 순간(빈칸)엔 표를 안 건드림');
  await page.fill('#exSets', '3');
  await page.dispatchEvent('#exSets', 'input');
  t.eq(await rows(), ['60x10', '70x9', '80x8'], '4 → 3: 마지막 세트만 빠지고 나머지는 그대로 (예전엔 1세트 값으로 다시 채워졌다)');
  await page.click('[data-sets-step="1"]');
  t.eq(await rows(), ['60x10', '70x9', '80x8', '90x7'], '다시 늘리면 빠졌던 세트가 그대로 돌아옴');
  await page.click('[data-sets-step="-1"]');
  await page.click('[data-sets-step="-1"]');
  t.eq([await page.inputValue('#exSets'), await rows()], ['2', ['60x10', '70x9']], '− 두 번이면 2세트');
  await page.click('[data-sets-step="1"]');
  await page.click('[data-sets-step="1"]');
  await page.click('[data-sets-step="1"]');
  t.eq(await rows(), ['60x10', '70x9', '80x8', '90x7', '90x7'], '빠졌던 것을 다 돌려준 뒤엔 마지막 세트를 따라 늘림');
  for (let i = 0; i < 6; i++) await page.click('[data-sets-step="-1"]');
  t.eq(await page.inputValue('#exSets'), '1', '1세트 밑으로는 안 내려감');
  await page.fill('#exSets', '');
  await page.dispatchEvent('#exSets', 'input');
  await page.dispatchEvent('#exSets', 'change');
  t.eq(await page.inputValue('#exSets'), '1', '빈칸으로 두고 나가면 지금 세트 수로 돌아옴');

  // 슈퍼세트 칸도 같이
  await page.fill('#exSets', '3');
  await page.dispatchEvent('#exSets', 'input');
  await page.click('#ssAdd');
  await page.fill('[data-pn="0"]', '바벨로우');
  await page.dispatchEvent('[data-pn="0"]', 'input');
  for (const [i, w] of [50, 55, 60].entries()) await page.fill(`[data-pps="0:${i}:weight"]`, String(w));
  await page.click('[data-sets-step="-1"]');
  await page.click('[data-sets-step="1"]');
  t.eq(await page.evaluate(() => partners[0].sets.map((s) => s.weight)), [50, 55, 60], '슈퍼세트 칸도 줄였다 늘리면 그대로');
  await page.click('[data-pdel="0"]');

  // 다른 운동으로 바꿔 표를 새로 채우면 앞 운동의 빠진 세트는 버림
  await page.evaluate(() => {
    state.days[shiftDate(todayStr(), -3)] = { meals: [], note: '', workouts: [
      { id: 'b', name: '벤치프레스', rest: 120, sets: [{ weight: 70, reps: 8, done: true }, { weight: 70, reps: 8, done: true }] },
      { id: 'c', name: '바벨컬', rest: 0, sets: [{ weight: 30, reps: 10, done: true }] }] };
    save(); render();
    perSetTouched = false;
  });
  await page.fill('#exName', '레그프레스');
  await page.dispatchEvent('#exName', 'input');
  await page.click('[data-sets-step="1"]');
  await page.fill('[data-ps="3:weight"]', '200');
  await page.click('[data-sets-step="-1"]');
  await page.evaluate(() => { perSetTouched = false; });
  await page.fill('#exName', '벤치프레스');
  await page.dispatchEvent('#exName', 'input');
  await page.click('[data-sets-step="1"]');
  t.ok(!(await rows()).some((r) => r.startsWith('200')), '이름이 바뀌어 표를 새로 채웠으면 앞 운동의 세트는 안 돌아옴');

  // ── 휴식: 운동마다 ──
  t.eq(await page.inputValue('#exRest'), '120', '지난번 이 운동의 휴식(2분)으로');
  await page.fill('#exName', '바벨컬');
  await page.dispatchEvent('#exName', 'input');
  t.eq(await page.inputValue('#exRest'), '0', '지난번에 끄기였으면 끄기');
  await page.selectOption('#exRest', '60');
  await page.fill('#exName', '벤치프레스');
  await page.dispatchEvent('#exName', 'input');
  t.eq(await page.inputValue('#exRest'), '60', '직접 고른 휴식은 이름을 바꿔도 그대로');
  await page.click('#ssAdd');
  await page.fill('[data-pn="0"]', '덤벨플라이');
  await page.dispatchEvent('[data-pn="0"]', 'input');
  await page.click('#workoutForm button[type=submit]');
  await wait(page, 100);
  t.eq(await page.evaluate(() => day().workouts.slice(-2).map((w) => [w.name, w.rest, w.minutes])), [['벤치프레스', 60, null], ['덤벨플라이', 60, null]],
    '넣으면 운동에 휴식 저장 (슈퍼세트 칸도 같은 휴식 — 한 바퀴 돌고 쉬니까), 시간은 비움');
  t.eq(await page.inputValue('#exRest'), '90', '넣은 뒤 폼은 기본 휴식으로');
  await page.fill('#exName', '벤치프레스');
  await page.dispatchEvent('#exName', 'input');
  t.eq(await page.inputValue('#exRest'), '60', '다음번엔 이번에 정한 휴식으로');
  await page.fill('#exName', '');
  await page.dispatchEvent('#exName', 'input');

  // 세트를 끝내면 그 운동의 휴식으로 타이머
  await page.evaluate(() => {
    day().workouts = [
      { id: 'x', name: '스쿼트', rest: 180, sets: [{ weight: 100, reps: 5 }, { weight: 100, reps: 5 }] },
      { id: 'y', name: '바벨컬', rest: 0, sets: [{ weight: 30, reps: 10 }, { weight: 30, reps: 10 }] },
      { id: 'z', name: '레그컬', sets: [{ weight: 40, reps: 12 }, { weight: 40, reps: 12 }] }];
    save(); render();
  });
  const left = () => page.evaluate(() => (restEndAt ? Math.round((restEndAt - Date.now()) / 1000) : 0));
  await openEx(page, 0);
  await page.click('[data-toggle="x:0"]');
  t.eq(await left(), 180, '스쿼트 세트 완료 → 3분');
  t.ok(await page.evaluate(() => !$('#restBar').hidden), '아래 휴식 바가 뜸');
  await page.evaluate(() => stopRest());
  await openEx(page, 1);
  await page.click('[data-toggle="y:0"]');
  t.eq([await left(), await page.evaluate(() => $('#restBar').hidden)], [0, true], '휴식 "끄기"인 운동은 타이머 안 켬');
  await openEx(page, 2);
  await page.click('[data-toggle="z:0"]');
  t.eq(await left(), 90, '휴식을 안 정한 운동은 기본 휴식');
  await page.evaluate(() => stopRest());

  // 카드의 ⏱: 세트 완료를 안 눌러도 바로 쉬기
  t.eq(await text(page, '[data-rest-now="x"]'), '⏱ 3:00', '카드에 그 운동의 휴식이 보임');
  await page.click('[data-rest-now="x"]');
  t.eq(await left(), 180, '⏱ 누르면 바로 타이머');
  await page.click('[data-rest-now="y"]');
  t.eq(await left(), 90, '"끄기"인 운동에서 ⏱을 누르면 기본 휴식');
  await page.evaluate(() => stopRest());

  // 카드에서 휴식 바꾸기 (접힘 안)
  await page.evaluate(() => { exMetaOpen.add('x'); render(); });
  await page.selectOption('[data-rest-sel="x"]', '150');
  t.eq(await page.evaluate(() => [day().workouts[0].rest, restFor('스쿼트')]), [150, 150], '카드에서 고치면 그 운동과 다음번 기본값이 바뀜');
  t.eq(await text(page, '[data-rest-now="x"]'), '⏱ 2:30', '⏱ 버튼도 바뀜');

  // 집중 모드도 그 운동의 휴식
  await page.evaluate(() => { day().workouts.forEach((w) => w.sets.forEach((s) => { s.done = false; })); save(); render(); });
  await page.click('#focusBtn');
  await page.click('#focusSheet [data-focus-done]');
  t.eq(await left(), 150, '집중 모드도 그 운동의 휴식');
  await page.evaluate(() => stopRest());
  await page.click('#focusClose');

  // 망가진 값이 와도
  t.eq(await page.evaluate(() => [restOf({ name: '스쿼트', rest: '30' }), restOf({ name: '스쿼트', rest: -5 }), restOf({ name: '없는운동' })]), [150, 150, 90],
    '숫자가 아니거나 음수인 휴식은 무시하고 그 운동의 지난 값·기본값');

  // ── 휴대폰 화면 ──
  await page.click('[data-rest-now="x"]');
  for (const vw of [375, 320]) {
    await page.setViewportSize({ width: vw, height: 800 });
    await openEx(page, 0);
    const r = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('#workoutList .set-btns')][0];
      const tops = [...btns.querySelectorAll('button')].map((b) => Math.round(b.getBoundingClientRect().top));
      const bar = $('#restBar').getBoundingClientRect();
      return {
        over: document.documentElement.scrollWidth - innerWidth,
        oneRow: new Set(tops).size === 1,
        barH: Math.round(bar.height), barIn: bar.left >= 0 && bar.right <= innerWidth,
        small: [...document.querySelectorAll('[data-sets-step], .set-btns button, #restBar button')].filter((x) => x.getBoundingClientRect().height < 40).length,
        font: getComputedStyle($('#exSets')).fontSize,
      };
    });
    t.ok(r.over <= 0, `${vw}px 가로 넘침 없음`);
    t.ok(r.oneRow, `${vw}px 카드의 세트 버튼 넷이 한 줄`);
    t.ok(r.barH < 64 && r.barIn, `${vw}px 휴식 바가 한 줄로 화면 안에 (높이 ${r.barH}px)`);
    t.eq(r.small, 0, `${vw}px −/+·세트 버튼·휴식 바 버튼 40px 이상`);
    t.eq(r.font, '16px', `${vw}px 세트 칸 글자 16px (아이폰 확대 방지)`);
  }
  t.noErrors(page);
}
