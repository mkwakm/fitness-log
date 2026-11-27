// Claude 연결 (구글 드라이브): Claude가 읽을 정리 글(recordText) + Apps Script 웹 앱으로 자동 저장 (가짜 서버로)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, serve, tab, text, wait } from './lib.mjs';

const URL1 = 'https://script.google.com/macros/s/AKfycbFAKE123/exec';
const PW = 'pw-secret-77';

export default async function (t) {
  // ── 정리 글 ──
  let page = await t.open();
  const out = await page.evaluate(() => {
    const W = (name, sets, extra = {}) => ({ id: uid(), name, minutes: null, sets, ...extra });
    const S = (weight, reps, extra = {}) => ({ weight, reps, done: false, ...extra });
    state.profile.weeklyGoal = 3;
    state.profile.parts = { 페이스풀: '어깨' };   // 직접 고른 부위가 이긴다 (기본은 등)
    state.days = {
      '2026-04-01': { meals: [], note: '', workouts: [W('스쿼트', [S(60, 10)])] },
      '2026-11-20': {
        note: '컨디션 좋음', weight: 79.5,
        meals: [{ id: uid(), type: '점심', name: '제육덮밥', amount: '1그릇', kcal: 800, protein: 30 }],
        workouts: [
          W('벤치프레스', [S(40, 10, { warmup: true, done: true }), S(60, 10, { done: true }), S(70, 8, { done: true, drops: [{ weight: 50, reps: 8 }] }), S(80, 5)], { note: '그립 넓게' }),
          W('사레레', [S(10, 15), S(10, 15)], { ss: 'x' }),
          W('페이스풀', [S(20, 12)], { ss: 'x' }),
        ],
      },
      '2026-11-25': { meals: [], note: '', workouts: [W('벤치프레스', [S(80, 6)]), W('데드리프트', [S(100, 5)])] },
    };
    return recordText(new Date(2026, 10, 27, 13, 5));
  });
  const has = (s, msg) => t.ok(out.includes(s), `${msg} — "${s}"`);
  t.ok(out.startsWith('# 운동 기록\n'), '제목으로 시작');
  has('마지막 저장 2026-11-27 13:05 · 오늘 2026-11-27 (금)', '저장 시각과 오늘');
  has('W = 워밍업', '표기 설명이 문서 안에 있음 (Claude가 기호를 알게)');
  has('- 기록: 2026-04-01 ~ 2026-11-25 · 운동한 날 3일', '기록 기간');
  has('- 이번 주(11/23~): 1일 / 목표 주 3일 · 지난주 1일 · 연속 0일', '이번 주·지난주·목표');
  has('- 최근 4주: 2일 · 본 세트 7 · 볼륨 3,080kg (그 전 4주: 0일 · 0세트 · 0kg)', '최근 4주 (완료 체크한 세트만, 드롭 포함, 워밍업 뺌)');
  has('가슴 11/25, 2일 전 (3세트)', '부위별 마지막으로 한 날');
  has('어깨 11/20, 7일 전 (3세트)', '부위별 — 어깨');
  t.ok(/부위별 마지막[^\n]*: 등 안 함/.test(out), '안 한 부위가 맨 앞 (오래 쉰 순)');
  has('- 체중: 79.5kg (11/20 기록)', '체중');
  has('- 사레레 (= 사이드레터럴레이즈) [어깨]', '줄임말은 정식 이름을 같이');
  has('- 벤치프레스 [가슴] 2일 · 3세트 · 최고 80×6 (1RM 96kg), 11/25 · 처음 11/20 70×8 (1RM 89kg) · 최근 11/25: 80×6', '운동별: 최고·처음·최근');
  t.ok(out.indexOf('- 벤치프레스 [가슴] 2일') < out.indexOf('- 데드리프트 [하체] 1일'), '자주 한 운동이 위');
  has('- 벤치프레스 [가슴]: W 40×10, 60×10, 70×8↘50×8, 80×5 (안 함) · 1,560kg', '세트: 워밍업 W, 드롭 ↘, 체크 안 한 세트');
  has('  메모: 그립 넓게', '운동 메모');
  has('- 사레레 [어깨] (슈퍼세트 A): 10×15, 10×15 · 300kg', '슈퍼세트 표시');
  has('- 페이스풀 [어깨] (슈퍼세트 A): 20×12 · 240kg', '슈퍼세트 짝');
  has('- 식단 800kcal · 단백질 30g: 점심 제육덮밥 1그릇 800kcal', '식단 한 줄');
  has('- 체중 79.5kg\n- 메모: 컨디션 좋음', '그 날 체중·메모');
  has('- 벤치프레스 [가슴]: 80×6 · 480kg · 신기록', '예전 기록을 넘긴 날은 신기록');
  t.ok(out.includes('- 데드리프트 [하체]: 100×5 · 500kg') && !out.includes('100×5 · 500kg · 신기록'), '처음 해 본 운동은 신기록 아님 (비교할 게 없다)');
  t.ok(out.indexOf('### 2026-11-25 (수)') < out.indexOf('### 2026-11-20 (금)'), '날짜별은 최근부터');
  t.ok(!out.includes('### 2026-04-01'), '180일보다 오래된 날은 날짜별에서 뺌');
  has('그 전 1일치는 fitness-log.json에', '뺐다는 걸 알림');

  const empty = await (await t.open()).evaluate(() => recordText());
  t.ok(empty.includes('- 아직 운동 기록이 없어요.') && /## 날짜별 \(최근부터\)\n- 없음/.test(empty), '빈 기록도 글이 만들어짐');
  const broken = await page.evaluate(() => {
    state.days['2026-11-26'] = { meals: [{ id: 'm', kcal: -5 }], note: '', workouts: [{ id: 'w', name: '', sets: [{ weight: '-50', reps: 'x', drops: 'bad' }] }] };
    try { return recordText(new Date(2026, 10, 27)).includes('### 2026-11-26'); } catch (e) { return e.message; }
  });
  t.eq(broken, true, '망가진 값이 있어도 안 깨짐');
  t.noErrors(page, '정리 글');

  // ── 자동 저장 (가짜 Apps Script) ──
  const server = { key: null, text: null, json: null, posts: [], mode: 'ok' };
  let answers = [];
  const open = async () => {
    const p = await t.open({ dialog: (d) => (d.type() === 'prompt' ? d.accept(answers.shift() ?? '') : d.accept()) });
    await p.route('https://script.google.com/**', async (route) => {
      if (server.mode === 'down') return route.abort('internetdisconnected');
      const headers = { 'access-control-allow-origin': '*' };
      if (server.mode === 'html') return route.fulfill({ status: 200, contentType: 'text/html', headers, body: '<html>로그인</html>' });
      const req = route.request();
      const body = JSON.parse(req.postData());
      server.posts.push({ ...body, type: req.headers()['content-type'] });
      const reply = (o) => route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(o) });
      if (!server.key) server.key = body.key;
      else if (server.key !== body.key) return reply({ ok: false, error: 'key' });
      server.text = body.text;
      server.json = body.json;
      return reply({ ok: true, at: Date.now(), docUrl: 'https://docs.google.com/document/d/abc/edit' });
    });
    await tab(p, 'history');
    return p;
  };
  const status = (p) => text(p, '#driveRow');
  const posts = () => server.posts.length;

  const A = await open();
  t.ok(await A.locator('#driveOnBtn').count() && await A.locator('#driveScriptBtn').count() && await A.locator('#copyTextBtn').count(),
    '연결 전: 연결하기·스크립트 복사·글로 복사');
  t.ok((await status(A)).includes('연결 안 됨'), '연결 안 됨 표시');

  answers = ['https://example.com/macros/s/x/exec'];
  await A.click('#driveOnBtn');
  await wait(A, 150);
  t.ok((await text(A, '.sync-msg')).includes('주소 모양'), '엉뚱한 주소는 거절');
  t.eq(await A.evaluate(() => sync.driveUrl), '', '거절한 주소는 저장 안 함');

  await A.evaluate(() => { day().workouts.push({ id: uid(), name: '바벨로우', minutes: null, sets: [{ weight: 60, reps: 10, done: false }] }); save(); render(); });
  answers = [URL1, PW];
  await A.click('#driveOnBtn');
  await wait(A, 400);
  t.eq(posts(), 1, '연결하면 바로 한 번 저장');
  const first = server.posts[0];
  t.eq(first.key, PW, '정한 비밀번호를 같이 보냄');
  t.ok(first.type.startsWith('text/plain'), 'text/plain으로 보냄 (Apps Script는 사전 요청을 못 받는다)');
  t.ok(first.text.startsWith('# 운동 기록') && first.text.includes('바벨로우'), '정리 글을 보냄');
  t.eq(JSON.parse(first.json).days, await A.evaluate(() => state.days), '기록 전체(JSON)도 보냄');
  t.ok((await status(A)).includes('마지막 저장: 방금'), '마지막 저장 시각');
  t.eq(await A.locator('#driveDocBtn').count(), 1, '문서 열기 버튼');

  const dump = await A.evaluate(() => [localStorage.getItem('fitness-log-v1'), backupFile().text(), localStorage.getItem('fitness-log-sync')]);
  dump[1] = await A.evaluate(() => backupFile().text());
  t.ok(!dump[0].includes(PW) && !dump[0].includes('AKfycbFAKE'), '주소·비밀번호가 기록(state)에 없음');
  t.ok(!dump[1].includes(PW), '내보내기 파일에도 없음');
  t.ok(dump[2].includes(PW) && dump[2].includes('AKfycbFAKE'), '이 기기 동기화 설정에만 있음');
  t.ok((await text(A, '#safetyStatus')).includes('구글 드라이브'), '드라이브 저장이 "이 기기 밖 사본"으로 잡힘 (백업 알림)');

  await A.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await wait(A, 300);
  t.eq(posts(), 1, '바뀐 게 없으면 다시 안 보냄');

  // 앱을 닫는 순간: 미뤄 둔 저장까지 반영해서 바로 보낸다 (숨겨지면 30초 타이머가 안 돈다)
  const stampBefore = await A.evaluate(() => day().updatedAt);
  await A.evaluate(() => new Promise((r) => setTimeout(r, 5)));
  await A.evaluate(() => {
    day().note = '닫기 전 메모';
    saveSoon();
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await wait(A, 400);
  await A.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); });
  t.eq(posts(), 2, '앱을 닫을 때 밀린 걸 바로 보냄');
  const today = await A.evaluate(() => todayStr());
  const sent = JSON.parse(server.json).days[today];
  t.ok(sent.note === '닫기 전 메모' && sent.updatedAt > stampBefore, '미뤄 둔 저장(수정 시각)까지 반영해서 보냄');
  t.ok(server.text.includes('- 메모: 닫기 전 메모'), '정리 글에도');

  // 고치면 잠잠해진 뒤 한 번
  await A.evaluate(() => {
    driveAfterEdit = function () { clearTimeout(driveTimer); driveTimer = setTimeout(() => { driveTimer = null; drivePush({ quiet: true }); }, 300); };
    day().note = '운동 끝'; save();
  });
  await wait(A, 120);
  t.eq(posts(), 2, '고친 직후엔 안 보냄');
  await wait(A, 600);
  t.eq(posts(), 3, '잠잠해지면 보냄');

  // 다른 기기: 비밀번호가 다르면 막히고, 맞추면 된다
  const B = await open();
  answers = [URL1, 'wrong-pass'];
  await B.click('#driveOnBtn');
  await wait(B, 400);
  t.ok((await status(B)).includes('비밀번호'), '비밀번호가 다르면 알려줌');
  t.ok(server.text.includes('운동 끝'), '틀린 비밀번호로는 문서를 못 덮어씀');
  t.eq(await B.locator('#driveOnBtn').count(), 1, '다시 연결 버튼');
  answers = [URL1, PW];
  await B.click('#driveOnBtn');
  await wait(B, 400);
  t.ok((await status(B)).includes('마지막 저장'), '같은 비밀번호로 다시 연결하면 저장됨');

  // 인터넷이 끊기면 알리고, 돌아오면 다시
  server.mode = 'down';
  await A.evaluate(() => { day().note = '오프라인'; save(); });
  await A.click('#drivePushBtn');
  await wait(A, 300);
  t.ok((await status(A)).includes('연결하지 못했어요'), '못 보내면 카드에 표시');
  t.ok(await A.locator('#drivePushBtn').isEnabled(), '버튼이 다시 살아남');
  server.mode = 'ok';
  const before = posts();
  await A.evaluate(() => window.dispatchEvent(new Event('online')));
  await wait(A, 400);
  t.eq(posts(), before + 1, '인터넷이 돌아오면 다시 보냄');
  t.ok((await status(A)).includes('마지막 저장') && server.text.includes('오프라인'), '밀렸던 내용이 들어감');

  server.mode = 'html';
  await A.click('#drivePushBtn');
  await wait(A, 300);
  t.ok((await text(A, '.sync-msg')).includes('응답을 못 읽었어요'), '배포 설정이 틀려 로그인 화면이 오면 알려줌');
  server.mode = 'ok';

  await A.click('#driveOffBtn');
  await wait(A, 200);
  t.eq(await A.locator('#driveOnBtn').count(), 1, '연결 끊기');
  t.eq(await A.evaluate(() => [sync.driveUrl, sync.driveKey]), ['', ''], '주소·비밀번호를 지움');
  const after = posts();
  await A.evaluate(() => { day().note = '끊은 뒤'; save(); document.dispatchEvent(new Event('visibilitychange')); });
  await wait(A, 600);
  t.eq(posts(), after, '끊으면 더 안 보냄');
  t.noErrors(A, 'A');
  t.noErrors(B, 'B');

  // ── 복사 버튼 (클립보드는 http에서만) ──
  const srv = await serve();
  try {
    const P = await t.open({ url: srv.url, context: { permissions: ['clipboard-read', 'clipboard-write'] } });
    await tab(P, 'history');
    await P.click('#driveScriptBtn');
    await wait(P, 400);
    t.eq(await P.evaluate(() => navigator.clipboard.readText()), readFileSync(join(ROOT, 'tools/drive-apps-script.gs'), 'utf8'), '스크립트 복사');
    await P.evaluate(() => { day().workouts.push({ id: uid(), name: '랫풀다운', minutes: null, sets: [{ weight: 50, reps: 12, done: false }] }); save(); render(); });
    await P.click('#copyTextBtn');
    await wait(P, 300);
    const [clip, now] = await P.evaluate(async () => [await navigator.clipboard.readText(), recordText()]);
    const strip = (s) => s.replace(/마지막 저장 [^·]+·/, '');
    t.ok(clip.includes('랫풀다운') && strip(clip) === strip(now), '글로 복사 = 드라이브 문서와 같은 정리');
    t.noErrors(P, '복사');
  } finally {
    await srv.close();
  }
}
