// 기록 탭 그래프: 섭취·소모, 체중, 1RM 추이, 부위별 볼륨과 주간 목표
import { tab, text, wait, ago } from './lib.mjs';

export default async function (t) {
  const page = await t.open();
  // 40일치: 가슴/등/하체를 돌아가며, 매일 식단·체중
  await page.evaluate(() => {
    const names = [['벤치프레스', 60, 10], ['랫풀다운', 50, 12], ['스쿼트', 80, 8]];
    for (let i = 0; i < 40; i++) {
      const d = shiftDate(todayStr(), -i);
      const [n, w, r] = names[i % 3];
      state.days[d] = { note: '', weight: 75 - i / 10,
        meals: [{ id: 'm' + i, type: '점심', name: '밥', amount: '1공기', kcal: 300 + i }],
        workouts: [{ id: 'w' + i, name: n, sets: [0, 1, 2].map(() => ({ weight: w, reps: r, done: true })) }] };
    }
    save(); render();
  });
  await tab(page, 'history');

  // ── 섭취·소모 막대 ──
  t.eq(await page.locator('#weekChart .i-bar, #weekChart path[class*="bar"]').count() > 0, true, '섭취·소모 막대가 그려짐');
  t.ok((await text(page, '#weekTiles')).includes('평균 섭취'), '요약 타일');

  // ── 체중·1RM 추이 ──
  t.ok(await page.locator('#weightChart circle').count() >= 7, '체중 점이 7개 이상 (7일 보기)');
  t.ok(await page.locator('#liftChart circle').count() >= 2, '1RM 추이 점');
  const ticks = await page.locator('#liftChart text.axis').allTextContents();
  t.ok(ticks.every((s) => !/\.\d{2,}/.test(s)), `축 눈금이 다듬어짐 (${ticks.slice(0, 3).join(', ')})`);

  // ── 부위별 볼륨: 목록, 묶음, 오늘 포함 ──
  t.eq(await page.evaluate(() => [...$('#volPick').options].map((o) => o.value)), ['가슴', '등', '하체'], '볼륨이 있는 부위만 선택지에');
  t.eq(await page.evaluate(() => partVolumeBuckets('가슴', 7).length), 7, '7일은 하루씩 7개');
  const b30 = await page.evaluate(() => partVolumeBuckets('가슴', 30));
  t.eq(b30.length, 5, '30일은 한 주씩 5묶음');
  t.eq(b30.at(-1).date, ago(0), '마지막 묶음이 오늘로 끝남 (방금 한 운동이 빠지지 않음)');
  t.eq(b30.reduce((s, b) => s + b.days, 0), 30, '묶음 날 수 합이 정확히 30');
  const direct = await page.evaluate(() => {
    let v = 0;
    for (let i = 0; i < 30; i++) (state.days[shiftDate(todayStr(), -i)]?.workouts || []).forEach((w) => { if (partOf(w.name) === '가슴') v += volumeOf(w); });
    return v;
  });
  t.eq(b30.reduce((s, b) => s + b.value, 0), direct, '묶음 합 = 직접 더한 30일 볼륨');
  await page.click('[data-range="30"]');
  t.eq(await page.locator('#volChart .v-bar').count(), b30.filter((b) => b.value > 0).length, '30일 보기: 볼륨이 있는 묶음마다 막대');
  await page.selectOption('#volPick', '하체');
  t.ok((await text(page, '#volChart')).includes('합계'), '부위를 바꾸면 다시 그림');
  t.eq(await page.evaluate(() => shortNum(1500)), '1.5k', '절반 눈금 1500은 "2k"가 아니라 "1.5k"');

  // ── 부위별 주간 볼륨 목표 ──
  await page.selectOption('#volPick', '가슴');
  await page.fill('[data-vol-goal]', '5000');
  t.eq(await page.evaluate(() => document.activeElement.dataset.volGoal), '가슴', '목표를 치는 동안 입력칸이 안 갈림');
  t.eq(await page.evaluate(() => state.profile.volGoals), { '가슴': 5000 }, '목표 저장');
  t.eq(await page.locator('#volChart .goal-line').count(), 1, '30일(주 단위)엔 목표선');
  const full = b30.filter((b) => b.days === 7);
  t.ok((await text(page, '#volChart')).includes(`${full.length}주 중 ${full.filter((b) => b.value >= 5000).length}주 달성`), '꽉 찬 주만 세서 달성 주 표시');
  await page.fill('[data-vol-goal]', '500000');
  const lineY = await page.evaluate(() => +document.querySelector('#volChart .goal-line').getAttribute('y1'));
  t.ok(lineY >= 12, '목표가 한참 높아도 선이 그래프 안에 있음');
  await page.locator('[data-vol-goal]').blur();
  await page.click('[data-range="7"]');
  t.eq(await page.locator('#volChart .goal-line').count(), 0, '7일(하루 단위)엔 선을 안 그음 (하루 목표가 아니므로)');
  t.ok((await text(page, '#volChart')).includes('남음'), '대신 이번 주 %·남은 kg로 적음');
  await page.selectOption('#volPick', '등');
  t.eq(await page.inputValue('[data-vol-goal]'), '', '부위마다 목표가 따로');
  await page.click('[data-vol-goal-avg]');
  const avg = await page.evaluate(() => avgWeekVolume('등'));
  t.eq(await page.evaluate(() => state.profile.volGoals['등']), avg, '"평균으로" 버튼이 최근 4주 평균을 목표로');
  t.eq(await page.inputValue('[data-vol-goal]'), String(avg), '버튼을 누르면 칸에도 바로 들어감');
  t.eq(avg % 100, 0, '평균은 100kg 단위');
  await page.fill('[data-vol-goal]', '');
  await page.locator('[data-vol-goal]').blur();
  t.ok(!('등' in await page.evaluate(() => state.profile.volGoals)), '비우면 목표 삭제');

  // ── 볼륨이 전혀 없으면 카드를 숨김 ──
  await page.evaluate(() => {
    state.days = { [todayStr()]: { meals: [], note: '', workouts: [{ id: 'r', name: '러닝', minutes: 30, sets: [{ weight: null, reps: 1 }] }] } };
    save(); render();
  });
  t.ok(await page.locator('#volCard').isHidden(), '유산소만 있으면 볼륨 카드 숨김');
  t.noErrors(page);
}
