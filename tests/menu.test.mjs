// 三 메뉴 (자주 안 쓰는 것: 운동 시간·밝기·도움말), 운동 시간 창(시계 + 숫자),
// 운동 탭에서 뺀 것들(운동 시간 카드·지난 운동 불러오기), 체중 칸은 마지막으로 적은 체중.
import { tab, text, wait, openTimer } from './lib.mjs';

export default async function (t) {
  const page = await t.open();
  await tab(page, 'workouts');
  t.eq(await page.locator('#workouts .card.session, #workouts #sessionBtn').count(), 0, '운동 탭에 운동 시간 카드 없음');
  t.eq(await page.locator('#loadRoutine').count(), 0, '"지난 운동 그대로 불러오기" 버튼 없음 (기록 탭 달력으로)');
  t.eq(await page.locator('header #themeBtn, header #helpBtn').count(), 0, '밝기·도움말은 헤더에서 메뉴로');
  t.eq(await page.locator('header.top > *').first().getAttribute('id'), 'menuBtn', '三 버튼은 왼쪽 위');
  t.eq(await page.locator('#menuBtn .bar').count(), 3, '막대 셋');

  // ── 메뉴 열고 닫기 ──
  await page.click('#menuBtn');
  t.ok(await page.locator('#menuSheet').isVisible(), '三을 누르면 메뉴');
  t.eq((await page.locator('.drawer-item').allTextContents()).map((s) => s.replace(/\s+/g, '')),
    ['⏱운동시간', '🌙Theme', '❓도움말'], '메뉴 항목');
  const box = await page.locator('.drawer-item').first().boundingBox();
  t.ok(box.height >= 44, `메뉴 항목은 누르기 쉬운 높이 (${box.height}px)`);
  await page.mouse.click(360, 400);                          // 판 바깥(어두운 곳)
  await wait(page, 100);
  t.ok(await page.locator('#menuSheet').isHidden(), '바깥을 누르면 닫힘');
  await page.click('#menuBtn');
  await page.goBack();
  await wait(page, 150);
  t.ok(await page.locator('#menuSheet').isHidden(), '휴대폰 뒤로가기로 닫힘 (앱이 꺼지지 않음)');
  await page.click('#menuBtn');
  await page.keyboard.press('Escape');
  t.ok(await page.locator('#menuSheet').isHidden(), 'ESC로 닫힘');

  // ── 운동 시간 창 ──
  await openTimer(page);
  t.ok(await page.locator('#timerSheet').isVisible() && await page.locator('#menuSheet').isHidden(), '메뉴 → 운동 시간: 메뉴는 닫고 창을 엶');
  t.eq(await text(page, '#timerClock'), '0:00:00', '처음엔 0:00:00');
  t.eq(await page.locator('#timerDial .dial-tick').count(), 60, '시계 눈금 60개');
  t.eq(await text(page, '#sessionBtn'), '▶️ 운동 시작', '시작 버튼');
  await page.click('#sessionBtn');
  await page.evaluate(() => { day().sessionStart = Date.now() - (12 * 60 + 34) * 1000; renderTimer(); });
  t.eq(await text(page, '#timerClock'), '0:12:34', '아래에 시:분:초로 크게');
  t.eq(await page.getAttribute('#dialHand', 'transform'), 'rotate(204 120 120)', '바늘 = 초 (34초 → 204°)');
  t.eq(await page.getAttribute('#dialArc', 'stroke-dasharray'), '12.57 60', '바깥 호 = 한 시간 중 몇 분째');
  t.ok((await text(page, '#sessionText')).startsWith('오늘 운동 중'), '재는 중 표시');
  t.eq(await text(page, '#sessionBtn'), '⏹ 운동 끝내기', '끝내기 버튼');
  await page.waitForFunction(() => document.getElementById('timerClock').textContent !== '0:12:34', null, { timeout: 2500 });
  t.ok(true, '창이 열려 있으면 1초마다 바뀜');

  await page.goBack();
  await wait(page, 150);
  t.ok(await page.locator('#timerSheet').isHidden(), '뒤로가기로 창만 닫힘');
  t.ok(await page.evaluate(() => typeof sessionOn === 'function' && layers.length === 0), '앱은 그대로 (메뉴 → 창으로 넘어가도 뒤로가기 한 번에 창만)');
  t.ok(await page.evaluate(() => sessionOn()), '창을 닫아도 계속 잼');
  t.ok(await page.locator('#menuDot').isVisible(), '도는 동안 三 버튼에 점 (끄는 걸 잊지 않게)');
  await page.click('#menuBtn');
  t.ok((await text(page, '#timerOpen')).includes('재는 중 · 12분'), '메뉴에도 재는 중이라고');
  await page.click('#timerOpen');
  await page.evaluate(() => { day().sessionStart = Date.now() - 3725 * 1000; renderTimer(); });
  t.eq(await text(page, '#timerClock'), '1:02:05', '한 시간이 넘으면 1:02:05');
  await page.click('#sessionBtn');
  t.eq(await page.evaluate(() => day().sessionMin), 62, '끝내면 분으로 쌓임');
  t.eq(await text(page, '#timerClock'), '1:02:00', '끝낸 뒤엔 쌓인 시간');
  t.eq(await text(page, '#sessionBtn'), '▶️ 이어서 재기', '다시 누르면 이어서');
  t.ok((await text(page, '#sessionText')).includes('62분 운동했어요'), '오늘 몇 분 했는지');
  await page.click('#timerClose');
  t.ok(await page.locator('#menuDot').isHidden(), '끝내면 점도 사라짐');

  // ── 체중 칸: 마지막으로 적은 체중 그대로 (안내문 없이) ──
  t.eq(await page.locator('#weightHint').count(), 0, '"안 적으면 ○kg으로 계산해요" 안내 없음');
  t.eq(await page.inputValue('#bodyWeight'), '', '한 번도 안 적었으면 빈칸');
  await page.fill('#bodyWeight', '78.5');
  await page.dispatchEvent('#bodyWeight', 'input');
  await page.evaluate(() => { document.activeElement.blur(); flushSave(); currentDate = shiftDate(todayStr(), 1); render(); });   // 칸에 포커스가 있으면 다시 그려도 안 바꾼다
  t.eq(await page.inputValue('#bodyWeight'), '78.5', '다음 날엔 마지막으로 적은 체중이 들어가 있음');
  t.eq(await page.evaluate(() => [day().weight ?? null, bodyWeight()]), [null, 78.5], '그 날 체중으로 저장하진 않고, 계산은 그 값으로');
  await page.fill('#bodyWeight', '77');
  await page.dispatchEvent('#bodyWeight', 'input');
  t.eq(await page.evaluate(() => day().weight), 77, '고치면 그 날 체중으로 기록');
  await page.evaluate(() => { document.activeElement.blur(); currentDate = shiftDate(todayStr(), -3); render(); });
  t.eq(await page.inputValue('#bodyWeight'), '77', '그 전 기록이 없는 날도 마지막으로 적은 체중');
  t.noErrors(page);
}
