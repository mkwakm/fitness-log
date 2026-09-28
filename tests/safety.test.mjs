// 기록 보호: 브라우저에 "지우지 마" 요청, 아이폰 홈 화면 안내(옮기는 순서 포함), 사본이 오래되면 알림
import { tab, text, wait } from './lib.mjs';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0';

// navigator.storage·홈 화면 여부·공유를 원하는 대로 흉내 낸다
const fake = ({ persisted = false, grant = false, standalone = false, share = false }) => ({
  fn: ({ persisted, grant, standalone, share }) => {
    window.__persistCalls = 0;
    let p = persisted;
    Object.defineProperty(navigator, 'storage', { configurable: true, value: {
      persisted: async () => p,
      persist: async () => { window.__persistCalls++; p = grant; return grant; },
    } });
    if (standalone) Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
    if (share) {
      navigator.canShare = () => true;
      navigator.share = async (d) => { window.__shared = d.files[0].name; };
    } else {
      navigator.canShare = () => false;
    }
  },
  arg: { persisted, grant, standalone, share },
});
const seedDays = (page, n) => page.evaluate((n) => {
  for (let i = 0; i < n; i++) state.days[shiftDate(todayStr(), -i)] = { meals: [{ id: 'm' + i, type: '점심', name: '밥', amount: '1공기', kcal: 300 }], workouts: [], note: '' };
  save(); render();
}, n);
const banner = (page) => page.evaluate(() => ($('#safetyBanner').hidden ? '' : $('#safetyBanner').textContent.replace(/\s+/g, ' ').trim()));

export default async function (t) {
  // ── 아이폰 사파리, 아직 기록 없음 ──
  let page = await t.open({ context: { userAgent: IPHONE, isMobile: true, hasTouch: true }, init: fake({}) });
  t.ok((await banner(page)).includes('기록을 시작하기 전에 홈 화면에 추가'), '아이폰 사파리: 기록 전엔 먼저 설치하라고 (옮길 게 없을 때가 제일 쉽다)');
  t.eq(await page.evaluate(() => window.__persistCalls), 0, '기록이 없으면 보호 요청을 아직 안 함');

  // ── 기록이 생기면: 옮기는 순서까지 ──
  await seedDays(page, 3);
  await wait(page, 100);
  const b = await banner(page);
  t.ok(b.includes('7일') && b.includes('홈 화면에 추가'), '7일 삭제 위험과 설치 방법');
  t.ok(b.includes('따로') && b.includes('가져오기'), '홈 화면 앱은 기록을 따로 쓴다는 것과 옮기는 법');
  t.ok(await page.evaluate(() => window.__persistCalls) >= 1, '기록이 생기면 보호 요청');
  await tab(page, 'history');
  t.ok((await text(page, '#safetyStatus')).includes('사파리로 열었어요'), '상태: 사파리로 열었다는 경고');
  t.ok((await text(page, '#safetyStatus')).includes('아직 없음'), '상태: 사본 없음');

  // ── 나중에 → 사흘 뒤 다시 ──
  await page.click('[data-safety-snooze^="ios"]');
  t.eq(await banner(page), '', '"나중에"로 숨김');
  await page.reload();
  await page.waitForSelector('#mealList', { state: 'attached' });
  t.eq(await banner(page), '', '새로 열어도 숨긴 채');
  await page.evaluate(() => { saveUi({ snooze: { ios: Date.now() - 1 } }); render(); });
  t.ok((await banner(page)).includes('홈 화면'), '미룬 기간이 지나면 다시 알림');
  t.ok(!JSON.stringify(await page.evaluate(() => state)).includes('snooze'), '알림 상태는 기록(state)에 안 섞임');

  // ── 아이폰 홈 화면 앱: 처음 열면 빈 화면 → 가져오기 안내 ──
  const dir = mkdtempSync(join(tmpdir(), 'fl-'));
  const file = join(dir, 'from-safari.json');
  writeFileSync(file, JSON.stringify(await page.evaluate(() => state)));
  page = await t.open({ context: { userAgent: IPHONE, isMobile: true, hasTouch: true }, init: fake({ standalone: true, grant: true }) });
  t.ok((await banner(page)).includes('사파리에서 쓰던 기록'), '홈 화면 앱이 비어 있으면 "사파리에서 쓰던 기록이 있나요?"');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-safety="import"]')]);
  await chooser.setFiles(file);
  await wait(page, 400);
  t.eq(await page.evaluate(() => recordedDays()), 3, '버튼 하나로 사파리 기록을 가져옴');
  t.eq(await banner(page), '', '가져오면 안내가 사라짐');
  await tab(page, 'history');
  await wait(page, 100);
  t.ok((await text(page, '#safetyStatus')).includes('홈 화면 앱으로 열었어요'), '상태: 홈 화면 앱');
  t.ok((await text(page, '#safetyStatus')).includes('지우지 않게 보호됨'), '홈 화면 앱은 보호 요청이 받아들여짐');
  t.noErrors(page, '아이폰');

  // ── 컴퓨터 크롬: 기록이 쌓였는데 사본이 없으면 ──
  page = await t.open({ context: { acceptDownloads: true }, init: fake({ grant: true }) });
  await seedDays(page, 6);
  t.eq(await banner(page), '', '기록 6일치까지는 백업 알림 안 함 (시작하자마자 잔소리하지 않는다)');
  await seedDays(page, 8);
  t.ok((await banner(page)).includes('한 번도 없어요'), '7일치가 넘었는데 사본이 없으면 알림');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-safety="save"]')]);
  t.ok(/\.json$/.test(dl.suggestedFilename()), '"지금 백업"은 파일로 받음 (공유 못 하는 기기)');
  t.eq(await banner(page), '', '백업하면 알림이 사라짐');
  await tab(page, 'history');
  t.ok((await text(page, '#safetyStatus')).includes('방금 (내보내기)'), '상태: 마지막 사본 방금');
  await page.evaluate(() => { saveUi({ lastExport: Date.now() - 20 * 86400000 }); render(); });
  t.ok((await banner(page)).includes('20일 됐어요'), '사본이 2주 넘게 오래되면 다시 알림');
  await page.evaluate(() => { sync.lastFile = Date.now(); render(); });
  t.eq(await banner(page), '', '파일 자동 저장이 돌고 있으면 그게 사본이라 알림 안 함');
  t.ok((await text(page, '#safetyStatus')).includes('파일 자동 저장'), '상태에 어디에 사본이 있는지');
  t.ok(await page.evaluate(() => window.__persistCalls) === 1, '보호 요청은 한 번만');
  t.noErrors(page, '크롬');

  // ── 휴대폰 공유로 백업 ──
  page = await t.open({ init: fake({ share: true }) });
  await seedDays(page, 8);
  await page.click('[data-safety="save"]');
  await wait(page, 100);
  t.ok(/\.json$/.test(await page.evaluate(() => window.__shared) || ''), '공유할 수 있는 폰이면 공유 창으로 (파일 앱·드라이브·카톡)');
  t.eq(await banner(page), '', '공유하면 백업한 것으로 침');

  // ── 파이어폭스: 권한 창이 뜨므로 자동으로 묻지 않음 ──
  page = await t.open({ context: { userAgent: FIREFOX }, init: fake({ grant: true }) });
  await seedDays(page, 2);
  await wait(page, 100);
  t.eq(await page.evaluate(() => window.__persistCalls), 0, '파이어폭스에선 알아서 묻지 않음');
  await tab(page, 'history');
  await page.click('[data-safety="persist"]');
  await wait(page, 100);
  t.eq(await page.evaluate(() => window.__persistCalls), 1, '"보호 요청"을 누르면 그때 물음');
  t.ok((await text(page, '#safetyStatus')).includes('보호됨'), '허락받으면 상태가 바뀜');

  // ── 설치할 수 있는 브라우저인데 보호를 못 받았으면 설치 권유 ──
  page = await t.open({ init: fake({ grant: false }) });
  await seedDays(page, 2);
  await wait(page, 100);
  t.eq(await banner(page), '', '설치를 제안할 수 없으면 아무것도 안 띄움');
  await page.evaluate(() => {
    const e = new Event('beforeinstallprompt');
    e.prompt = () => { window.__prompted = true; };
    e.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(e);
  });
  t.ok((await banner(page)).includes('앱으로 설치하면'), '설치할 수 있게 되면 설치 권유');
  await page.click('[data-safety="install"]');
  t.ok(await page.evaluate(() => window.__prompted), '"설치"를 누르면 브라우저 설치 창');

  // ── 아이폰 경고가 백업 알림보다 먼저 ──
  page = await t.open({ context: { userAgent: IPHONE }, init: fake({}) });
  await seedDays(page, 10);
  t.ok((await banner(page)).includes('홈 화면'), '둘 다 해당하면 더 위험한 쪽(아이폰 7일 삭제)부터');
  t.ok(await page.evaluate(() => document.querySelectorAll('#safetyBanner button').length) >= 2, '할 일 버튼과 "나중에"');
  const small = await page.evaluate(() => [...document.querySelectorAll('#safetyBanner .safety-btns button')].filter((x) => x.getBoundingClientRect().height < 40).length);
  t.eq(small, 0, '알림 버튼은 40px 이상');
  t.noErrors(page, '아이폰 백업');
}
