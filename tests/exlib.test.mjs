// 운동 목록(exercise-db.js): 부위·MET, 다른 이름 묶기(metKey), 예전 키 옮기기, 폼 안내, "📋 운동 고르기" 창
import { tab, text, wait } from './lib.mjs';

export default async function (t) {
  const page = await t.open();

  // ── 목록 자체 ──
  const db = await page.evaluate(() => {
    const keys = EXERCISES.map(([n]) => exKey(n));
    const aliases = EXERCISES.flatMap(([, , a]) => a.map(exKey));
    return {
      n: EXERCISES.length,
      badPart: EXERCISES.filter(([, p]) => !PART_ORDER.includes(p) || p === '기타').map(([n]) => n),
      dupNames: keys.filter((k, i) => keys.indexOf(k) !== i),
      dupAliases: aliases.filter((k, i) => aliases.indexOf(k) !== i),
      aliasIsName: aliases.filter((k) => keys.includes(k)),
      spaces: EXERCISES.filter(([n]) => /\s/.test(n)).map(([n]) => n),
      perPart: Object.fromEntries(PICK_PARTS.concat('전신').map((p) => [p, EXERCISES.filter(([, q]) => q === p).length])),
    };
  });
  t.ok(db.n >= 200, `운동 ${db.n}가지`);
  t.ok(Object.values(db.perPart).every((n) => n >= 8), `부위마다 8가지 이상 ${JSON.stringify(db.perPart)}`);
  t.eq(db.badPart, [], '모든 운동의 부위가 정해진 부위 중 하나 (기타 없음)');
  t.eq([db.dupNames, db.dupAliases, db.aliasIsName], [[], [], []], '이름·다른 이름이 겹치지 않음 (겹치면 다른 운동 기록이 섞인다)');
  t.eq(db.spaces, [], '이름은 띄어쓰기 없이 (예전 기록과 같은 모양)');

  // 예전 흔한 운동 54종: 부위·MET이 그대로 (지난 기록의 칼로리·밸런스가 바뀌면 안 된다)
  const old = await page.evaluate(() => {
    const OLD = ['벤치프레스', '인클라인벤치프레스', '덤벨프레스', '인클라인덤벨프레스', '체스트프레스', '케이블크로스오버', '펙덱플라이', '덤벨플라이', '딥스', '푸시업',
      '랫풀다운', '풀업', '바벨로우', '덤벨로우', '시티드로우', '티바로우', '페이스풀', '백익스텐션', '스쿼트', '핵스쿼트', '레그프레스', '레그컬', '레그익스텐션', '런지',
      '힙쓰러스트', '카프레이즈', '데드리프트', '루마니안데드리프트', '오버헤드프레스', '숄더프레스', '아놀드프레스', '사이드레터럴레이즈', '프론트레이즈', '리어델트', '슈러그',
      '바벨컬', '덤벨컬', '해머컬', '프리처컬', '트라이셉익스텐션', '케이블푸시다운', '킥백', '플랭크', '크런치', '레그레이즈', '러시안트위스트', '앱롤러',
      '런닝머신', '사이클', '로잉머신', '일립티컬', '스텝퍼', '줄넘기', '버피'];
    const rxPart = (n) => { n = exKey(n); for (const [p, re] of PART_TABLE) if (re.test(n)) return p; return '기타'; };
    const rxMet = (n) => { n = exKey(n); for (const [re, m] of MET_TABLE) if (re.test(n)) return m; return DEFAULT_MET; };
    return { n: OLD.length, inDb: OLD.filter((n) => !EX_INFO.has(metKey(n))), diff: OLD.filter((n) => rxPart(n) !== autoPart(n) || rxMet(n) !== autoMet(n)) };
  });
  t.eq([old.n, old.inDb], [54, []], '예전 흔한 운동 54종이 모두 목록에 있음');
  t.eq(old.diff, [], '예전 54종의 부위·MET이 이전과 같음');

  // 이름 규칙으론 틀리던 것 — 목록이 먼저라 맞게 잡힘
  const parts = await page.evaluate(() => Object.fromEntries(['노르딕컬', '케이블글루트킥백', '업라이트로우', '다이아몬드푸시업', '디클라인싯업', '벤치딥스', '글루트브릿지',
    '워킹런지', '클로즈그립랫풀다운', '덤벨오버헤드익스텐션', '로우케이블플라이', '자전거크런치', '힙어브덕션', '팔로프프레스'].map((n) => [n, autoPart(n)])));
  t.eq(parts, { 노르딕컬: '하체', 케이블글루트킥백: '하체', 업라이트로우: '어깨', 다이아몬드푸시업: '삼두', 디클라인싯업: '코어', 벤치딥스: '삼두', 글루트브릿지: '하체',
    워킹런지: '하체', 클로즈그립랫풀다운: '등', 덤벨오버헤드익스텐션: '삼두', 로우케이블플라이: '가슴', 자전거크런치: '코어', 힙어브덕션: '하체', 팔로프프레스: '코어' },
  '이름 규칙이 틀리던 14가지 (노르딕"컬"은 이두가 아니라 하체, 워킹런지는 유산소가 아니라 하체 …)');
  const mets = await page.evaluate(() => ['데드버그', '팔로프프레스', '천국의계단', '배틀로프', '클린', '박스점프', '목록에없는운동'].map(autoMet));
  t.eq(mets, [3.8, 3.8, 9, 9, 6, 8, 5], 'MET: 규칙이 못 잡는 코어는 코어 값, 유산소·올림픽 리프트는 목록 값, 모르는 운동은 기본');

  // ── 다른 이름은 같은 운동 ──
  const same = await page.evaluate(() => [['사레레', '사이드레터럴레이즈'], ['렛풀다운', '랫풀다운'], ['벤치 프레스', '벤치프레스'], ['OHP', '오버헤드프레스'],
    ['턱걸이', '풀업'], ['런닝머신', '러닝머신'], ['리어델트', '리어델트플라이'], ['스컬크러셔', '라잉트라이셉익스텐션']].map(([a, b]) => metKey(a) === metKey(b)));
  t.ok(same.every(Boolean), '다른 이름·띄어쓰기·대소문자가 달라도 같은 운동');
  t.ok(await page.evaluate(() => metKey('덤벨숄더프레스') !== metKey('숄더프레스') && metKey('케이블킥백') !== metKey('케이블글루트킥백')), '다른 운동은 안 묶임');

  await page.evaluate(() => {
    const S = (w, r) => ({ weight: w, reps: r, done: true });
    state.days = {
      [shiftDate(todayStr(), -9)]: { meals: [], note: '', workouts: [{ id: 'a', name: '렛풀다운', sets: [S(60, 10), S(60, 10)] }] },
      [shiftDate(todayStr(), -5)]: { meals: [], note: '', workouts: [{ id: 'b', name: '랫풀다운', sets: [S(55, 10), S(55, 10)] }] },
      [shiftDate(todayStr(), -2)]: { meals: [], note: '', workouts: [{ id: 'c', name: '사레레', sets: [S(8, 15), S(8, 15)] }, { id: 'd', name: '벤치 프레스', sets: [S(70, 8)] }] },
    };
    save(); render();
  });
  t.eq(await page.evaluate(() => [personalBest('랫풀다운').weight, personalBest('랫풀다운').date === shiftDate(todayStr(), -9)]), [60, true], '렛풀다운 기록이 랫풀다운 최고 기록에 들어감');
  t.eq(await page.evaluate(() => lastRecord('사이드레터럴레이즈')?.workout.name), '사레레', '사이드레터럴레이즈의 지난번 = 사레레로 적은 날');
  t.eq(await page.evaluate(() => exerciseLog('벤치프레스').length), 1, '운동 상세도 묶어서 ("벤치 프레스")');

  // ── 예전 키로 저장된 MET·부위 옮기기 ──
  const mig = await page.evaluate(() => {
    const p = migrateProfile({ mets: { '벤치 프레스': 6, 사레레: 4.5, 사이드레터럴레이즈: 4 }, parts: { 풀오버: '등', 리어델트: '등' } });
    const sorted = (o) => Object.fromEntries(Object.entries(o).sort());
    return [sorted(p.mets), sorted(p.parts)];
  });
  t.eq(mig, [{ 벤치프레스: 6, 사이드레터럴레이즈: 4 }, { 덤벨풀오버: '등', 리어델트플라이: '등' }], '예전 키를 정식 이름 키로 (이미 새 키에 있던 값이 이김)');
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('fitness-log-v1'));
    raw.profile.mets = { '벤치 프레스': 6 };
    raw.profile.parts = { 리어델트: '등' };
    localStorage.setItem('fitness-log-v1', JSON.stringify(raw));
  });
  await page.reload();
  await page.waitForSelector('#mealList', { state: 'attached' });
  t.eq(await page.evaluate(() => [metOf('벤치프레스'), partOf('리어델트플라이'), partOf('리어델트')]), [6, '등', '등'], '다시 열어도 예전에 정한 MET·부위가 그대로');
  t.eq(await page.evaluate(() => {
    mergeState({ days: {}, profile: { updatedAt: Date.now() + 1000, parts: { 렛풀다운: '어깨' } } });
    return partOf('랫풀다운');
  }), '어깨', '다른 기기에서 예전 키로 온 profile도 옮김');
  await page.evaluate(() => { state.profile.parts = {}; save(); render(); });

  // ── 폼: 다른 이름이면 어느 운동인지 한 줄, 적은 이름은 그대로 ──
  await tab(page, 'workouts');
  await page.fill('#exName', '렛풀다운');
  await wait(page, 80);
  const hint = await text(page, '#exHint');
  t.ok(hint.startsWith('= 랫풀다운'), '다른 이름으로 적으면 "= 랫풀다운"');
  t.ok(hint.includes('지난번'), '지난 기록도 같이 (랫풀다운으로 적은 날)');
  await page.fill('#exName', '랫풀다운');
  await wait(page, 80);
  t.ok(!(await text(page, '#exHint')).includes('='), '정식 이름이면 그 줄 없음');
  await page.fill('#exName', '사레레');
  await page.click('#workoutForm button[type=submit]');
  await wait(page, 100);
  t.eq(await page.evaluate(() => day().workouts.at(-1).name), '사레레', '적은 이름은 바꾸지 않음');
  t.ok((await page.$$eval('#exSuggestions option', (x) => x.length)) >= 200, '자동완성에 목록 전체');

  // ── 📋 운동 고르기 ──
  await page.click('#workoutForm [data-ex-pick="main"]');
  t.ok(await page.evaluate(() => !$('#pickSheet').hidden), '📋 목록을 누르면 창이 열림');
  t.eq(await page.$eval('#pickTabs .part-chip.on', (e) => e.textContent), '최근', '기록이 있으면 "최근"부터');
  const recent = await page.$$eval('#pickList .pick-row b', (x) => x.map((e) => e.textContent));
  t.eq(recent, ['사레레', '벤치 프레스', '랫풀다운'], '최근: 같은 운동은 하나로(렛풀다운·랫풀다운), 최근 순');
  await page.click('[data-pick-tab="등"]');
  const back = await page.evaluate(() => ({
    secs: [...document.querySelectorAll('#pickList .pick-sec')].map((e) => e.textContent),
    first: document.querySelector('#pickList .pick-row b').textContent,
    names: [...document.querySelectorAll('#pickList .pick-row b')].map((e) => e.textContent),
  }));
  t.eq(back.secs, ['내가 한 운동', '다른 운동'], '부위 탭: 내가 한 운동 먼저');
  t.eq(back.first, '랫풀다운', '내가 한 등 운동이 맨 위');
  t.ok(!back.names.slice(1).includes('랫풀다운') && back.names.includes('티바로우') && back.names.includes('풀업'), '다른 운동엔 안 해 본 것만');
  await page.evaluate(() => setCustomPart('티바로우', '하체'));
  await page.click('[data-pick-tab="하체"]');
  t.ok((await page.$$eval('#pickList .pick-row b', (x) => x.map((e) => e.textContent))).includes('티바로우'), '직접 고른 부위를 따름');
  await page.evaluate(() => setCustomPart('티바로우', null));

  await page.fill('#pickSearch', '불스스');
  await wait(page, 50);
  t.eq(await page.$$eval('#pickList .pick-row b', (x) => x.map((e) => e.textContent)), ['불가리안스플릿스쿼트'], '다른 이름(줄임말)으로도 찾음 (같은 운동이라 "그대로 쓰기"는 없음)');
  t.ok((await text(page, '#pickList')).includes('"불스스"') && (await text(page, '#pickList')).includes('하체'), '어느 이름으로 걸렸는지·부위를 같이');
  await page.fill('#pickSearch', '랫풀다운');
  await wait(page, 50);
  t.ok(!(await text(page, '#pickList')).includes('그대로 쓰기'), '딱 맞는 운동이 있으면 "그대로 쓰기" 없음');
  await page.fill('#pickSearch', '우리동네체조');
  await wait(page, 50);
  t.ok((await text(page, '#pickList')).includes('목록에 없어요'), '없으면 그 이름으로 쓰기');

  const expectSets = await page.evaluate(() => setsLikeLast('사레레', 0, null, { progress: true }).map((s) => s.weight));
  await page.fill('#pickSearch', '사레');
  await page.click('#pickList [data-pick-name="사레레"]');
  t.ok(await page.evaluate(() => $('#pickSheet').hidden), '고르면 창이 닫힘');
  t.eq(await page.inputValue('#exName'), '사레레', '이름 칸에 들어감');
  t.eq(await page.evaluate(() => perSet.map((s) => s.weight)), expectSets, '지난번 세트대로 표가 채워짐 (이름을 친 것과 같음)');

  await page.click('[data-part-pick="코어"]');
  await page.click('#workoutForm [data-ex-pick="main"]');
  t.eq(await page.$eval('#pickTabs .part-chip.on', (e) => e.textContent), '코어', '부위를 먼저 눌렀으면 그 부위부터');
  await page.click('#pickList [data-pick-name="플랭크"]');
  t.eq(await page.evaluate(() => [$('#exName').value, partPick]), ['플랭크', null], '앞 운동에 눌러 둔 부위는 풀림');

  // 뒤로가기·ESC로 닫힘
  await page.click('#workoutForm [data-ex-pick="main"]');
  await page.goBack().catch(() => {});
  await wait(page, 150);
  t.ok(await page.evaluate(() => $('#pickSheet').hidden && !layers.length), '휴대폰 뒤로가기로 닫힘');
  await page.click('#workoutForm [data-ex-pick="main"]');
  await page.keyboard.press('Escape');
  t.ok(await page.evaluate(() => $('#pickSheet').hidden), 'ESC로 닫힘');

  // 슈퍼세트 칸에서도
  await page.click('#ssAdd');
  await page.click('[data-ex-pick="0"]');
  await page.click('[data-pick-tab="등"]');
  await page.click('#pickList [data-pick-name="바벨로우"]');
  t.eq(await page.evaluate(() => [partners[0].name, $('[data-pn="0"]').value]), ['바벨로우', '바벨로우'], '슈퍼세트 칸에도 들어감');

  // ── 휴대폰 화면 ──
  for (const vw of [375, 320]) {
    await page.setViewportSize({ width: vw, height: 760 });
    await page.click('#workoutForm [data-ex-pick="main"]');
    await page.click('[data-pick-tab="가슴"]');
    const r = await page.evaluate(() => ({
      over: document.documentElement.scrollWidth - innerWidth,
      out: [...document.querySelectorAll('#pickSheet *, #workoutForm .ex-name-row *')].filter((x) => x.getBoundingClientRect().right > innerWidth + 0.5).length,
      small: [...document.querySelectorAll('#pickSheet button, .ex-pick-btn')].filter((x) => x.offsetParent && x.getBoundingClientRect().height < 40).length,
      font: getComputedStyle($('#pickSearch')).fontSize,
    }));
    t.ok(r.over <= 0 && r.out === 0, `${vw}px 가로 넘침 없음`);
    t.eq(r.small, 0, `${vw}px 버튼 40px 이상`);
    t.eq(r.font, '16px', `${vw}px 검색칸 16px (아이폰 확대 방지)`);
    await page.keyboard.press('Escape');
  }
  t.noErrors(page);
}
