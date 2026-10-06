// 날짜 이동(버튼·스와이프·빠른 연타). 기록 탭 달력·검색은 calendar.test.mjs
import { tab, text, wait, ago } from './lib.mjs';

// main에 손가락 제스처를 흉내 낸다
const swipe = (page, from, to, y = 400, dy = 0) => page.evaluate(async ({ from, to, y, dy }) => {
  const main = document.querySelector('main');
  const fire = (type, x, yy) => main.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true,
    touches: type === 'touchend' ? [] : [new Touch({ identifier: 1, target: main, clientX: x, clientY: yy })],
    changedTouches: [new Touch({ identifier: 1, target: main, clientX: x, clientY: yy })] }));
  fire('touchstart', from, y);
  let moved = false;
  for (let i = 1; i <= 6; i++) {
    fire('touchmove', from + (to - from) * i / 6, y + dy * i / 6);
    if (main.style.transform) moved = true;
    await new Promise((r) => setTimeout(r, 16));
  }
  fire('touchend', to, y + dy);
  return moved;
}, { from, to, y, dy });

export default async function (t) {
  const page = await t.open({ context: { hasTouch: true, isMobile: true } });
  const today = ago(0);
  const date = () => page.evaluate(() => currentDate);

  // ── 버튼 ──
  await page.click('#prevDay');
  t.eq(await date(), ago(1), '‹ 누르는 즉시 날짜 확정 (연출을 기다리지 않음)');
  await wait(page, 450);
  t.ok(await page.locator('#todayBtn').isVisible(), '오늘이 아니면 "오늘" 버튼');
  await page.click('#todayBtn');
  await wait(page, 450);
  t.eq(await date(), today, '"오늘"로 복귀');
  t.ok(await page.locator('#todayBtn').isHidden(), '오늘엔 버튼 숨김');
  await page.click('#prevDay');
  await page.click('#prevDay');
  await wait(page, 600);
  t.eq(await date(), ago(2), '빠르게 두 번 누르면 이틀 (하루만 넘어가지 않음)');
  t.eq(await page.inputValue('#date'), ago(2), '화면의 날짜도 맞음');
  await page.click('#todayBtn');
  await wait(page, 450);

  // ── 스와이프 ──
  t.ok(await swipe(page, 300, 100), '손가락을 따라 화면이 밀림');
  await wait(page, 600);
  t.eq(await date(), ago(-1), '왼쪽으로 쓸면 다음 날');
  t.ok(await page.locator('#datePill').isVisible(), '날짜 알약이 뜸');
  t.eq(await page.evaluate(() => document.querySelector('main').style.transform), '', '연출 끝나면 제자리');
  await swipe(page, 100, 300);
  await wait(page, 600);
  t.eq(await date(), today, '오른쪽으로 쓸면 전날');
  await swipe(page, 300, 270);
  await wait(page, 400);
  t.eq(await date(), today, '조금만 쓸면 안 넘어감');
  await swipe(page, 200, 128, 500, -240);
  await wait(page, 400);
  t.eq(await date(), today, '세로 스크롤 중엔 날짜가 안 넘어감');
  await wait(page, 1500);
  t.ok(await page.locator('#datePill').isHidden(), '알약은 잠시 뒤 사라짐');

  // ── 연출 도중엔 못 누름 (화면과 날짜가 어긋나는 120ms) ──
  await page.evaluate(() => { day().workouts.push({ id: 'z', name: '스쿼트', sets: [{ weight: 80, reps: 8 }] }); save(); render(); });
  await tab(page, 'workouts');
  const guard = await page.evaluate(() => { stepDate(1); return getComputedStyle(document.querySelector('main')).pointerEvents; });
  t.eq(guard, 'none', '넘어가는 중엔 main을 못 누름');
  await wait(page, 600);
  t.ok(await page.evaluate(() => findWorkout('z') == null), '다른 날의 운동 id는 못 찾음 (호출부가 이를 견딤)');
  await page.click('#todayBtn');
  await wait(page, 450);

  t.noErrors(page);
}
