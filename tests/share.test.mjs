// 오운완 카드: 그 날 운동을 이미지 한 장으로 (공유·저장). 운동 카드 아래·집중 모드 마무리·달력에서 연다.
import { tab, text, wait, ago } from './lib.mjs';

export default async function (t) {
  const page = await t.open({ init: () => {
    navigator.canShare = (d) => !!d?.files?.length;
    navigator.share = async (d) => { window.__shared = { name: d.files[0].name, type: d.files[0].type, size: d.files[0].size }; };
  } });
  t.ok(await page.locator('#shareDayBtn').isHidden(), '운동이 없으면 오운완 버튼 없음');

  await page.evaluate(([y]) => {
    state.days[y] = { meals: [], note: '', workouts: [{ id: 'p1', name: '벤치프레스', sets: [{ weight: 70, reps: 8, done: true }] }] };
    day().split = '가슴·삼두';
    day().workouts.push(
      { id: 'a', name: '벤치프레스', sets: [{ weight: 40, reps: 10, done: true, warmup: true }, { weight: 75, reps: 8, done: true }, { weight: 75, reps: 6, done: true }] },
      { id: 'b', name: '딥스', sets: [{ weight: null, reps: 12, done: true }, { weight: null, reps: 10, done: false }] },
      { id: 'c', name: '케이블푸시다운', sets: [{ weight: 25, reps: 12, done: false }] });
    save(); render();
  }, [ago(3)]);
  t.ok(await page.locator('#shareDayBtn').isVisible(), '완료한 세트가 있으면 운동 카드 아래에 오운완 버튼');
  const order = await page.evaluate(() => {
    const list = document.querySelector('#workoutList'), btn = document.querySelector('#shareDayBtn'), form = document.querySelector('#workoutForm');
    return !!(list.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING) && !!(btn.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  t.ok(order, '버튼은 운동 카드와 운동 추가 폼 사이 (카드 위에 얹지 않음)');

  // ── 카드에 들어가는 숫자 ──
  const data = await page.evaluate(() => shareCardData(todayStr()));
  t.eq(data.title, '가슴·삼두', '제목은 분할 이름');
  t.eq(data.sets, 4, '본 세트만 셈 (워밍업 빼고, 체크 안 한 세트 빼고)');
  t.eq(data.vol, 75 * 8 + 75 * 6 + 25 * 12, '볼륨은 화면과 같은 집계');
  t.eq(data.exercises.map((e) => e.best), ['75kg × 8', '12회', '25kg × 12'], '운동마다 가장 센 세트 (맨몸은 횟수)');
  t.eq(data.exercises.map((e) => e.pr), [true, false, false], '신기록은 예전 기록을 넘긴 것만 (처음 해 본 딥스는 아님)');
  t.eq(data.prs, 1, '신기록 수');
  t.ok(data.min > 0 && data.burn > 0, '시간을 안 쟀으면 세트로 추정한 시간과 소모');

  // ── 미리보기 · 공유 ──
  await page.click('#shareDayBtn');
  t.ok(await page.locator('#shareSheet').isVisible(), '누르자마자 창이 열림 (그림은 뒤이어)');
  await page.waitForFunction((d) => shareImg.dataset.date === d && shareImg.complete && shareImg.naturalWidth > 0, await page.evaluate(() => todayStr()));
  t.ok(await page.locator('#shareSheet').isVisible(), '누르면 미리보기 창');
  t.eq(await page.evaluate(() => [shareImg.naturalWidth, shareImg.naturalHeight]), [1080, 1350], '1080×1350 (4:5)');
  const colors = await page.evaluate(() => {
    const c = document.createElement('canvas');
    drawShareCard(c, shareCardData(todayStr()));
    const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const set = new Set();
    for (let i = 0; i < px.length; i += 4 * 97) set.add(`${px[i]},${px[i + 1]},${px[i + 2]}`);
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    return { n: set.size, accent };
  });
  t.ok(colors.n > 20, `빈 그림이 아님 (색 ${colors.n}가지)`);
  t.ok(await page.locator('#shareSend').isVisible(), '공유할 수 있는 브라우저면 공유 버튼');
  await page.click('#shareSend');
  await wait(page, 200);
  const shared = await page.evaluate(() => window.__shared);
  t.ok(shared?.name === `오운완-${await page.evaluate(() => todayStr())}.png` && shared.type === 'image/png' && shared.size > 10000, `PNG 파일로 공유 (${shared?.name})`);
  // file://에선 브라우저가 download 이름을 무시하므로 붙인 이름은 링크에서 본다
  await page.evaluate(() => { const orig = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { window.__dlName = this.download; return orig.call(this); }; });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#shareSave')]);
  t.ok(!!dl && /^오운완-\d{4}-\d\d-\d\d\.png$/.test(await page.evaluate(() => window.__dlName)), '이미지 저장은 PNG 내려받기 (오운완-날짜.png)');
  await page.goBack();
  await wait(page, 150);
  t.ok(await page.locator('#shareSheet').isHidden() && await page.evaluate(() => layers.length === 0), '뒤로가기로 닫힘');

  // ── 달력의 그 날 보기에서 ──
  await tab(page, 'history');
  await page.evaluate((y) => { calMonth = y.slice(0, 7); calPick = y; renderCalendar(); }, ago(3));
  await page.click('#calDetail [data-share-day]');
  await page.waitForFunction((d) => shareImg.dataset.date === d && shareImg.complete && shareImg.naturalWidth > 0, ago(3));
  t.eq(await page.evaluate(() => shareDate), ago(3), '달력에서 연 카드는 그 날 운동');
  await page.keyboard.press('Escape');
  await wait(page, 100);
  t.ok(await page.locator('#shareSheet').isHidden(), 'ESC로 닫힘');

  // ── 집중 모드 마무리 화면에서 ──
  await tab(page, 'workouts');
  await page.evaluate(() => { day().workouts.forEach((w) => w.sets.forEach((s) => { s.done = true; })); save(); render(); openFocus(); focusAt = null; renderFocus(); });
  await wait(page, 100);
  t.ok(await page.locator('#focusBody [data-share-day]').isVisible(), '집중 모드 마무리 화면에 오운완 카드');
  await page.click('#focusBody [data-share-day]');
  await page.waitForFunction(() => !!shareImg.dataset.date);
  t.ok(await page.evaluate(() => !!document.elementFromPoint(200, 300)?.closest('#shareSheet')), '집중 모드 위에 뜸');
  await page.keyboard.press('Escape');
  t.ok(await page.locator('#shareSheet').isHidden() && await page.locator('#focusSheet').isVisible(), '닫으면 집중 모드로 돌아옴');

  // ── 운동이 많으면 일부만 + "N개 더", 체크 안 쓰는 지난 날도 ──
  const many = await page.evaluate(() => {
    const d = shiftDate(todayStr(), -10);
    state.days[d] = { meals: [], note: '', workouts: Array.from({ length: 10 }, (_, i) => ({ id: 'm' + i, name: '운동' + i, sets: [{ weight: 10, reps: 10, done: false }] })) };
    save();
    return { can: canShareDay(d), n: shareCardData(d).exercises.length };
  });
  t.ok(many.can, '체크를 안 쓴 지난 날도 공유할 수 있음');
  t.eq(many.n, 10, '데이터엔 다 들어감 (그림에선 6개 + "4개 더")');
  t.noErrors(page);
}
