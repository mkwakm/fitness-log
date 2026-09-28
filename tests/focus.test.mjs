// 운동 중 집중 모드: 세트 하나씩 → 완료 → 휴식 → 다음 세트, 그리고 휴대폰에서 탭이 다시 열려도 이어지는지
import { tab, text, wait } from './lib.mjs';

export default async function (t) {
  const page = await t.open();
  const seed = () => page.evaluate(() => {
    state.days = {};
    const y = shiftDate(todayStr(), -3);
    state.days[y] = { meals: [], note: '', workouts: [{ id: 'old', name: '벤치프레스', note: '와이드그립',
      sets: [0, 1, 2].map(() => ({ weight: 60, reps: 10, done: true })) }] };
    state.days[todayStr()] = { meals: [], note: '', workouts: [
      { id: 'b', name: '벤치프레스', sets: [0, 1, 2].map(() => ({ weight: 60, reps: 10, done: false })) },
      { id: 'r', name: '랫풀다운', sets: [{ weight: 50, reps: 12, done: false }, { weight: 45, reps: 12, done: false }] },
    ] };
    currentDate = todayStr(); state.profile.restSec = 90; save(); render();
  });
  const cur = () => page.evaluate(() => { const c = focusCurrent(); return c.w ? `${c.w.id}:${c.i}` : null; });
  const sets = (id) => page.evaluate((id) => day().workouts.find((w) => w.id === id).sets.map((s) => [s.weight, s.reps, !!s.done]), id);
  const shown = () => page.evaluate(() => (document.querySelector('#focusRestTime') ? 'rest' : document.querySelector('[data-focus-finish]') ? 'finish'
    : document.querySelector('[data-focus-done]') ? 'set' : 'other'));

  // ── 진입 버튼 ──
  await tab(page, 'workouts');
  t.ok(await page.locator('#focusBtn').isHidden(), '운동이 없으면 버튼 없음');
  await seed();
  t.ok((await text(page, '#focusBtn')).includes('남은 5세트'), '버튼에 남은 세트 수');

  // ── 열면: 첫 세트, 운동 시간 시작 ──
  await page.click('#focusBtn');
  t.ok(await page.locator('#focusSheet').isVisible(), '집중 모드가 열림');
  t.eq(await cur(), 'b:0', '첫 번째 안 한 세트부터');
  t.ok(await page.evaluate(() => sessionOn()), '오늘이면 운동 시간 재기를 같이 시작');
  t.ok((await text(page, '#focusBody')).includes('벤치프레스') && (await text(page, '#focusBody')).includes('1세트 / 3'), '운동 이름과 1세트 / 3');
  t.eq([await page.inputValue('[data-focus-edit="weight"]'), await page.inputValue('[data-focus-edit="reps"]')], ['60', '10'], '중량·횟수가 크게');
  t.ok((await text(page, '#focusBody')).includes('📝 와이드그립'), '지난번 기록과 메모');
  t.ok((await text(page, '#focusBody')).includes('62.5kg'), '첫 세트엔 과부하 제안');
  t.eq(await text(page, '#focusProgress'), '0 / 5세트', '전체 진행');

  // ── 중량을 올리면 남은 같은 세트도 따라감 ──
  await page.click('[data-focus-step="weight:1"]');
  t.eq(await sets('b'), [[62.5, 10, false], [62.5, 10, false], [62.5, 10, false]], '+ 한 번에 남은 세트도 62.5로');
  await page.click('[data-focus-step="reps:-1"]');
  t.eq((await sets('b')).map((s) => s[1]), [9, 9, 9], '횟수도 같이');
  await page.click('[data-focus-step="reps:1"]');

  // ── 완료 → 휴식 → 다음 ──
  await page.click('[data-focus-done]');
  t.eq((await sets('b'))[0][2], true, '세트 완료');
  t.ok(await page.evaluate(() => day().workouts[0].sets[0].doneAt > 0), '완료 시각을 남김 (휴식 통계용)');
  t.eq(await shown(), 'rest', '완료하면 휴식 화면');
  t.ok(/^1:(29|30)$/.test(await text(page, '#focusRestTime')), `휴식 1:30부터 (${await text(page, '#focusRestTime')})`);
  t.ok((await text(page, '#focusBody')).includes('다음 · 벤치프레스 2세트'), '다음 세트 미리 보기');
  t.eq(await text(page, '#focusProgress'), '1 / 5세트', '진행 1/5');
  await page.click('[data-focus-rest="30"]');
  t.ok(await page.evaluate(() => restLeft()) >= 115, '+30초');
  await page.click('[data-focus-rest="skip"]');
  t.eq([await shown(), await cur()], ['set', 'b:1'], '바로 시작 → 2세트');

  // ── 휴식이 끝나면 저절로 다음 세트 화면 ──
  await page.click('[data-focus-done]');
  await page.evaluate(() => { restEndAt = Date.now() + 300; });
  await wait(page, 700);
  t.eq([await shown(), await cur()], ['set', 'b:2'], '휴식이 끝나면 저절로 3세트');

  // ── 이전 세트로 가서 완료 취소 ──
  await page.click('[data-focus-move="-1"]');
  t.eq(await cur(), 'b:1', '‹ 이전');
  t.ok((await text(page, '[data-focus-done]')).includes('완료 취소'), '끝낸 세트면 "완료 취소"');
  await page.click('[data-focus-done]');
  t.eq((await sets('b'))[1][2], false, '완료 취소');
  await page.click('[data-focus-done]');
  await page.click('[data-focus-rest="skip"]');
  t.eq(await cur(), 'b:2', '다시 완료하면 남은 세트로');

  // ── 운동이 바뀌는 곳 ──
  await page.click('[data-focus-done]');
  t.ok((await text(page, '#focusBody')).includes('다음 · 랫풀다운 1세트'), '벤치를 다 하면 다음은 랫풀다운');
  await page.click('[data-focus-rest="skip"]');
  const w1 = await page.inputValue('[data-focus-edit="weight"]');
  await page.fill('[data-focus-edit="weight"]', '55');
  await page.locator('[data-focus-edit="weight"]').blur();
  await wait(page, 100);
  t.eq(await sets('r'), [[55, 12, false], [45, 12, false]], `직접 입력 (${w1}→55), 값이 달랐던 다음 세트(45)는 안 건드림`);

  // ── + 세트 ──
  await page.click('[data-focus-add]');
  t.eq((await sets('r')).length, 3, '+ 세트');
  t.eq(await cur(), 'r:2', '추가한 세트로 이동');
  t.eq((await sets('r'))[2], [45, 12, false], '마지막 세트 값을 따라 만듦');

  // ── 다 끝내면 ──
  for (let k = 0; k < 3; k++) {
    if (await shown() === 'rest') await page.click('[data-focus-rest="skip"]');
    if (await shown() === 'set') await page.click('[data-focus-done]');
  }
  t.eq(await shown(), 'finish', '다 하면 마무리 화면');
  t.eq(await page.evaluate(() => restEndAt), 0, '마지막 세트 뒤엔 휴식 타이머를 안 켬');
  const fin = await text(page, '#focusBody');
  t.ok(fin.includes('세트 6') || /세트\s*6/.test(fin), '마무리: 세트 6');
  t.ok(fin.includes('신기록') && fin.includes('벤치프레스'), '오늘 세운 신기록 (62.5kg)');
  t.ok(!/신기록[^)]*랫풀다운/.test(fin), '처음 해 본 운동(랫풀다운)은 신기록으로 안 침');
  t.ok(!/시간\s*0\s*분/.test(fin), '시간이 0분으로 안 나옴');
  await page.click('[data-focus-move="-1"]');
  t.eq(await cur(), 'r:2', '"세트 다시 보기"는 마지막 세트로');
  t.eq(await text(page, '[data-focus-move="1"]'), '마무리 ›', '맨 끝에서 다음 버튼은 "마무리 ›"');
  await page.click('[data-focus-move="1"]');
  t.eq(await shown(), 'finish', '마무리 화면으로 돌아옴');
  await page.click('[data-focus-finish]');
  t.ok(await page.locator('#focusSheet').isHidden(), '운동 끝내기 → 닫힘');
  t.ok(!(await page.evaluate(() => sessionOn())), '운동 시간도 멈춤');
  t.ok(await page.evaluate(() => day().sessionMin) >= 1, '운동 시간 기록');
  t.eq(await page.locator('#workoutList .set-row.done').count(), 6, '카드 화면에도 완료 6세트가 그대로');

  // ── 닫기·뒤로가기·겹쳐 열기 ──
  await seed();
  const len0 = await page.evaluate(() => history.length);
  await page.click('#focusBtn');
  await page.click('#focusClose');
  await wait(page, 150);
  await page.click('#focusBtn');
  await page.keyboard.press('Escape');
  await wait(page, 150);
  t.ok(await page.locator('#focusSheet').isHidden(), 'ESC로 닫힘');
  t.ok(await page.evaluate(() => history.length) <= len0 + 1, '✕·ESC로 여닫아도 history가 쌓이지 않음');
  await page.click('#focusBtn');
  await page.click('.focus-ex');
  t.ok(await page.locator('#exSheet').isVisible(), '집중 모드에서 운동 이름을 누르면 상세가 위에 뜸');
  await page.goBack();
  await wait(page, 200);
  t.ok(await page.locator('#exSheet').isHidden() && await page.locator('#focusSheet').isVisible(), '뒤로가기 한 번 → 상세만 닫힘');
  await page.click('.focus-ex');
  await page.click('#exSheetClose');
  await wait(page, 200);
  t.ok(await page.locator('#focusSheet').isVisible(), '상세를 ✕로 닫아도 집중 모드는 그대로');
  await page.goBack();
  await wait(page, 200);
  t.ok(await page.locator('#focusSheet').isHidden(), '뒤로가기 한 번 더 → 집중 모드 닫힘');
  t.ok(await page.evaluate(() => typeof state === 'object') && page.url().includes('index.html'), '앱은 안 꺼짐');

  // ── 탭이 다시 열려도 이어짐 (휴대폰에서 다른 앱 쓰다 오면 흔하다) ──
  await page.click('#focusBtn');
  await page.click('[data-focus-done]');
  const endAt = await page.evaluate(() => restEndAt);
  await page.evaluate(() => flushSave());
  await page.reload();
  await page.waitForSelector('#mealList', { state: 'attached' });
  await wait(page, 150);
  t.ok(await page.locator('#focusSheet').isVisible(), '새로 열어도 집중 모드로 돌아옴');
  t.ok(Math.abs(await page.evaluate(() => restEndAt) - endAt) < 1500, '쉬던 타이머도 끝나는 시각 그대로');
  t.eq(await shown(), 'rest', '휴식 화면으로');
  t.ok(!JSON.stringify(await page.evaluate(() => state)).includes('restEndAt'), '화면 상태는 기록(state)에 안 섞임');
  await page.click('#focusClose');
  await page.evaluate(() => stopRest());
  await page.reload();
  await page.waitForSelector('#mealList', { state: 'attached' });
  t.ok(await page.locator('#focusSheet').isHidden(), '닫고 나갔으면 새로 열어도 안 뜸');

  // ── 다른 날엔 운동 시간을 멋대로 켜지 않음 ──
  await page.evaluate(() => { if (sessionOn()) toggleSession(); currentDate = shiftDate(todayStr(), -3); render(); });
  await tab(page, 'workouts');
  await page.click('#focusBtn');
  t.ok(!(await page.evaluate(() => sessionOn())), '지난 날짜를 정리할 땐 운동 시간을 안 켬');
  t.eq(await shown(), 'finish', '다 끝난 날은 마무리 화면');
  await page.click('#focusClose');
  await page.evaluate(() => { currentDate = todayStr(); render(); });

  // ── 휴대폰 화면 ──
  await seed();
  for (const w of [375, 320]) {
    await page.setViewportSize({ width: w, height: 700 });
    await page.click('#focusBtn');
    const r = await page.evaluate(() => ({
      over: document.documentElement.scrollWidth - innerWidth,
      small: [...document.querySelectorAll('#focusSheet button, #focusSheet input')].filter((b) => b.offsetParent && b.getBoundingClientRect().height < 40)
        .map((b) => b.className || b.textContent.trim()),
      done: document.querySelector('[data-focus-done]').getBoundingClientRect(),
      font: parseFloat(getComputedStyle(document.querySelector('[data-focus-edit]')).fontSize),
    }));
    t.ok(r.over <= 0, `${w}px 가로 스크롤 없음`);
    t.eq(r.small, [], `${w}px 40px 미만 버튼 없음`);
    t.ok(r.done.height >= 60, `${w}px 완료 버튼은 크게 (${Math.round(r.done.height)}px)`);
    t.ok(r.done.bottom <= 700, `${w}px 완료 버튼이 스크롤 없이 보임`);
    t.ok(r.font >= 16, '숫자 입력칸 16px 이상');
    await page.click('#focusClose');
  }
  await page.setViewportSize({ width: 375, height: 812 });

  // ── 시트 안 스와이프는 날짜를 안 바꿈 ──
  await page.click('#focusBtn');
  const d0 = await page.evaluate(() => currentDate);
  await page.locator('#focusBody').hover();
  await page.mouse.down(); await page.mouse.move(30, 300); await page.mouse.move(340, 300); await page.mouse.up();
  await wait(page, 200);
  t.eq(await page.evaluate(() => currentDate), d0, '집중 모드 안에서 쓸어도 날짜 그대로');

  // ── 다른 운동 추가하기 ──
  await page.click('[data-focus-addex]');
  t.ok(await page.locator('#focusSheet').isHidden(), '"다른 운동 추가하기" → 닫고');
  t.eq(await page.evaluate(() => document.activeElement.id), 'exName', '운동 이름 칸으로');
  t.noErrors(page);
}
