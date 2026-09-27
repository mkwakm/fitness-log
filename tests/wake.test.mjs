// 운동 중 화면 꺼짐 방지 (Wake Lock). 헤드리스에선 실제로 안 붙어서 흉내 낸다.
import { tab, text, wait } from './lib.mjs';

export default async function (t) {
  const page = await t.open({ init: () => {
    window.__locks = 0;
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async () => {
      window.__locks++;
      const ls = [];
      return { released: false, addEventListener: (_, f) => ls.push(f), release: async () => { window.__locks--; ls.forEach((f) => f()); } };
    } } });
  } });
  await tab(page, 'workouts');
  const locks = () => page.evaluate(() => window.__locks);
  t.eq(await locks(), 0, '시작 전엔 안 잡음');
  await page.click('#sessionBtn');
  await wait(page, 150);
  t.eq(await locks(), 1, '운동 시작하면 화면을 붙잡음');
  t.ok((await text(page, '#sessionText')).includes('화면 안 꺼짐'), '붙잡았다고 표시');
  await page.click('#sessionBtn');
  await wait(page, 150);
  t.eq(await locks(), 0, '끝내면 놓음');

  await page.click('#sessionBtn');
  await wait(page, 150);
  await page.evaluate(() => wakeLock?.release?.());   // 화면을 가리면 브라우저가 알아서 푼다
  await wait(page, 100);
  t.eq(await locks(), 0, '브라우저가 풀어버린 상황');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await wait(page, 200);
  t.eq(await locks(), 1, '돌아오면 다시 잡음');
  await page.click('#sessionBtn');

  await page.evaluate(() => Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: undefined }));
  await page.click('#sessionBtn');
  await page.evaluate(() => { day().sessionStart = Date.now() - 5 * 60000; });
  await page.click('#sessionBtn');
  t.ok(await page.evaluate(() => day().sessionMin) >= 5, '지원 안 하는 브라우저에서도 기록은 그대로');
  t.noErrors(page);
}
