// 원판 계산기(바벨 무게 → 한쪽 원판, 바 무게·있는 원판 설정)와 워밍업 자동(카드 첫 + 워밍업, 폼 🔥 워밍업 자동)
import { tab, text, wait, openEx } from './lib.mjs';

export default async function (t) {
  const page = await t.open();
  await tab(page, 'workouts');

  // ── 계산 ──
  const calc = await page.evaluate(() => [142.5, 60, 20, 15, 101].map((kg) => { const r = platesFor(kg); return [r.under, r.plates, r.actual]; }));
  t.eq(calc, [[false, [20, 20, 20, 1.25], 142.5], [false, [20], 60], [false, [], 20], [true, [], 15], [false, [20, 20], 100]],
    '기본(바 20kg, 25kg 원판 없음): 큰 원판부터, 빈 바, 바보다 가벼움, 딱 못 맞추면 가장 가까운 아래 무게');
  t.eq(await page.evaluate(() => platesFor(142.5, { bar: 20, sizes: [25, 20, 15, 10, 5, 2.5, 1.25] }).plates), [25, 25, 10, 1.25], '25kg이 있으면 25부터');
  t.eq(await page.evaluate(() => ['벤치프레스', '벤치 프레스', '바벨힙쓰러스트', '데드', '내맘대로바벨운동', '스미스머신스쿼트', '덤벨프레스', '레그프레스'].map(isBarbell)),
    [true, true, true, true, true, false, false, false], '바벨 운동만 (다른 이름·"바벨"이 든 이름 포함, 스미스·덤벨·머신은 아님)');
  t.eq(await page.evaluate(() => { state.profile.plates = { bar: 'x', sizes: [3, 'a'] }; const c = plateCfg(); state.profile.plates = null; return c; }),
    { bar: 20, sizes: [20, 15, 10, 5, 2.5, 1.25] }, '망가진 설정이 와도 기본값');

  // ── 카드: 다음 세트의 원판 한 줄 ──
  await page.evaluate(() => {
    day().workouts = [
      { id: 'b', name: '벤치프레스', sets: [{ weight: 60, reps: 10 }, { weight: 100, reps: 5 }] },
      { id: 'l', name: '레그프레스', sets: [{ weight: 180, reps: 10 }] }];
    save(); render();
  });
  await openEx(page, 0);
  await openEx(page, 1);
  t.eq(await page.$$eval('#workoutList .plate-line', (x) => x.map((e) => e.textContent.trim())), ['🏋️ 60kg · 한쪽 20'], '바벨 운동 카드에만, 아직 안 한 다음 세트 무게로');
  await page.click('[data-toggle="b:0"]');
  await page.evaluate(() => stopRest());
  t.eq(await text(page, '#workoutList .plate-line'), '🏋️ 100kg · 한쪽 20 · 20', '세트를 끝내면 다음 세트 무게로');
  await page.click('[data-toggle="b:1"]');
  await page.evaluate(() => stopRest());
  t.eq(await page.$$eval('#workoutList .plate-line', (x) => x.length), 0, '다 끝내면 안 보임');
  await page.click('[data-toggle="b:1"]');
  await page.evaluate(() => stopRest());

  // ── 계산기 창 ──
  await page.click('#workoutList .plate-line');
  t.ok(await page.evaluate(() => !$('#plateSheet').hidden), '원판 줄을 누르면 계산기');
  t.eq(await page.inputValue('#plateKg'), '100', '그 무게로 열림');
  t.ok((await text(page, '#plateResult')).includes('한쪽 20 · 20'), '결과');
  t.eq(await page.$$eval('#plateResult .plate', (x) => x.map((e) => e.textContent)), ['20', '20'], '한쪽 그림');
  await page.click('[data-plate-step="1"]');
  t.eq([await page.inputValue('#plateKg'), (await text(page, '#plateResult')).includes('1.25')], ['102.5', true], '+ 한 번이면 ± 단위만큼');
  await page.fill('#plateKg', '101');
  await page.dispatchEvent('#plateKg', 'input');
  t.ok((await text(page, '#plateResult')).includes('딱 못 맞춰요') && (await text(page, '#plateResult')).includes('100kg'), '못 맞추면 가장 가까운 무게를 알려줌');
  t.eq(await page.evaluate(() => document.activeElement?.id), 'plateKg', '치는 동안 칸이 안 끊김');

  await page.click('[data-plate-bar="15"]');
  t.eq(await page.evaluate(() => state.profile.plates.bar), 15, '바 무게를 고르면 저장');
  await page.fill('#plateKg', '60');
  await page.dispatchEvent('#plateKg', 'input');
  t.ok((await text(page, '#plateResult')).includes('한쪽 20 · 2.5'), '바 15kg이면 60kg = 한쪽 20 · 2.5');
  await page.click('[data-plate-size="25"]');
  await page.click('[data-plate-bar="20"]');
  await page.fill('#plateKg', '120');
  await page.dispatchEvent('#plateKg', 'input');
  t.ok((await text(page, '#plateResult')).includes('한쪽 25 · 25'), '25kg 원판을 켜면 25부터');
  t.eq(await page.evaluate(() => state.profile.plates.sizes), [25, 20, 15, 10, 5, 2.5, 1.25], '있는 원판 저장');
  for (const p of [25, 20, 15, 10, 5, 2.5, 1.25]) await page.click(`[data-plate-size="${p}"]`);
  t.eq(await page.evaluate(() => plateCfg().sizes), [1.25], '원판은 하나는 남김');
  await page.click('[data-plate-size="20"]');
  await page.click('[data-plate-size="1.25"]');
  await page.keyboard.press('Escape');
  t.ok(await page.evaluate(() => $('#plateSheet').hidden && !layers.length), 'ESC로 닫힘');
  await page.click('#workoutList .plate-line');
  await page.goBack().catch(() => {});
  await wait(page, 150);
  t.ok(await page.evaluate(() => $('#plateSheet').hidden), '뒤로가기로 닫힘');
  t.eq(await page.evaluate(() => plateCfg().sizes), [20], '지금 원판은 20kg만');
  await page.evaluate(() => { day().workouts[0].sets[1].weight = 102.5; save(); render(); });
  t.eq(await text(page, '#workoutList .plate-line'), '🏋️ 102.5kg · 한쪽 20 · 20 (= 100kg)', '설정이 카드에도 (20kg만 있으면 102.5kg은 100kg까지)');

  // ── 집중 모드 ──
  await page.evaluate(() => { day().workouts[0].sets.forEach((s) => { s.done = false; }); save(); render(); });
  await page.click('#focusBtn');
  t.eq(await text(page, '#focusSheet .focus-plates'), '🏋️ 한쪽 20', '집중 모드: 무게 아래 원판');
  await page.click('#focusSheet .focus-plates');
  t.eq(await page.evaluate(() => [!$('#plateSheet').hidden, layers.join(',')]), [true, 'focus,plate'], '집중 모드 위에 계산기');
  await page.keyboard.press('Escape');
  t.ok(await page.evaluate(() => !$('#focusSheet').hidden), '계산기만 닫히고 집중 모드는 그대로');
  await page.click('#focusClose');

  // ── 워밍업 자동: 카드 ──
  await page.evaluate(() => { day().workouts = [{ id: 's', name: '스쿼트', sets: [{ weight: 100, reps: 5 }, { weight: 100, reps: 5 }] }]; save(); render(); });
  await openEx(page, 0);
  await page.click('[data-add-warmup="s"]');
  t.eq(await page.evaluate(() => day().workouts[0].sets.map((s) => `${s.warmup ? 'W' : ''}${s.weight}x${s.reps}`)),
    ['W20x10', 'W40x5', 'W60x3', 'W80x2', '100x5', '100x5'], '+ 워밍업 (처음): 빈 바부터 한 번에');
  t.eq(await text(page, '#workoutList .plate-line'), '🏋️ 20kg · 빈 바', '원판 줄은 첫 워밍업(빈 바)부터');

  // ── 워밍업 자동: 폼 ──
  await page.fill('#exName', '벤치프레스');
  await page.dispatchEvent('#exName', 'input');
  await page.evaluate(() => { perSet = defaultPerSet(3); perSetTouched = false; renderPerSet(); });
  await page.click('#warmupAuto');
  t.ok((await text(page, '#exHint')).includes('1세트 무게를 먼저'), '무게가 없으면 먼저 적으라고');
  t.eq(await page.evaluate(() => perSet.length), 3, '표는 그대로');
  for (const i of [0, 1, 2]) await page.fill(`[data-ps="${i}:weight"]`, '80');
  await page.click('#warmupAuto');
  t.eq(await page.evaluate(() => perSet.map((s) => `${s.warmup ? 'W' : ''}${s.weight}`)), ['W20', 'W32.5', 'W47.5', 'W65', '80', '80', '80'], '1세트 80kg → 빈 바·32.5·47.5·65 워밍업을 표 맨 앞에');
  t.eq(await page.inputValue('#exSets'), '7', '세트 칸도 7');
  await page.fill('[data-ps="4:weight"]', '100');
  await page.click('#warmupAuto');
  t.eq(await page.evaluate(() => perSet.map((s) => `${s.warmup ? 'W' : ''}${s.weight}`)), ['W20', 'W40', 'W60', 'W80', '100', '80', '80'], '다시 누르면 워밍업을 새로 짬 (겹쳐 쌓이지 않음)');
  await page.click('#workoutForm button[type=submit]');
  await wait(page, 100);
  t.eq(await page.evaluate(() => day().workouts.at(-1).sets.filter((s) => s.warmup).length), 4, '넣으면 워밍업 4세트가 같이');

  // ── 휴대폰 화면 ──
  for (const vw of [375, 320]) {
    await page.setViewportSize({ width: vw, height: 700 });
    await page.evaluate(() => openPlates(142.5));
    const r = await page.evaluate(() => ({
      over: document.documentElement.scrollWidth - innerWidth,
      out: [...document.querySelectorAll('#plateSheet *')].filter((x) => x.getBoundingClientRect().right > innerWidth + 0.5).length,
      small: [...document.querySelectorAll('#plateSheet button, .plate-line, #warmupAuto')].filter((x) => x.offsetParent && x.getBoundingClientRect().height < 40).length,
      font: getComputedStyle($('#plateKg')).fontSize,
    }));
    t.ok(r.over <= 0 && r.out === 0, `${vw}px 계산기 가로 넘침 없음`);
    t.eq(r.small, 0, `${vw}px 버튼 40px 이상`);
    t.ok(parseFloat(r.font) >= 16, `${vw}px 무게 칸 16px 이상`);
    await page.keyboard.press('Escape');
  }
  t.noErrors(page);
}
