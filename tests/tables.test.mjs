// 이름으로 추정하는 표: MET, 부위, 음식
export default async function (t) {
  const page = await t.open();

  // 흔한 운동 54종은 부위가 "기타"로 새면 안 된다
  const common = await page.evaluate(() => COMMON_EX.map((n) => [n, partOf(n), autoMet(n)]));
  t.eq(common.filter(([, p]) => p === '기타').map(([n]) => n), [], `흔한 운동 ${common.length}종 모두 부위가 잡힘`);

  // "먼저 걸리는 줄" 규칙 때문에 헷갈리기 쉬운 이름들
  const cases = {
    케이블푸시다운: '팔', 케이블크로스오버: '가슴', 레그레이즈: '코어', 레그프레스: '하체', 레그컬: '하체', 시티드로우: '등',
    인클라인벤치프레스: '가슴', 해머컬: '팔', 힙쓰러스트: '하체', 사이드레터럴레이즈: '어깨', 펙덱플라이: '가슴',
    스미스머신스쿼트: '하체', 루마니안데드리프트: '하체', 친업: '등', 딥스: '가슴', 플랭크: '코어', 러닝머신: '유산소', 버피: '유산소',
  };
  const got = await page.evaluate((names) => Object.fromEntries(names.map((n) => [n, partOf(n)])), Object.keys(cases));
  t.eq(Object.entries(got).filter(([n, p]) => cases[n] !== p), [], '헷갈리기 쉬운 이름 18개의 부위');

  const mets = await page.evaluate(() => ({ 줄넘기: autoMet('줄넘기'), 러닝: autoMet('러닝'), 스쿼트: autoMet('스쿼트'), 벤치프레스: autoMet('벤치프레스'),
    레그레이즈: autoMet('레그레이즈'), 레그프레스: autoMet('레그프레스'), 러시안트위스트: autoMet('러시안트위스트'), 앱롤러: autoMet('앱롤러'),
    요가: autoMet('요가'), 모르는운동: autoMet('모르는운동') }));
  t.eq(mets, { 줄넘기: 11, 러닝: 8, 스쿼트: 6, 벤치프레스: 5, 레그레이즈: 3.8, 레그프레스: 6, 러시안트위스트: 3.8, 앱롤러: 3.8, 요가: 3, 모르는운동: 5 },
    'MET 추정 (레그레이즈는 코어, 레그프레스는 하체로 갈라짐)');

  // 음식: 표의 키로 "끝날" 때만
  const foods = await page.evaluate(() => [['현미밥', '210g'], ['밥', '1공기'], ['김치전', '1개'], ['할머니손맛김치', '50g'], ['라면', '1개'],
    ['계란', '2개'], ['삼겹살', ''], ['없는음식', '100g']].map(([n, a]) => { const e = estimateKcal(n, a); return e ? [e.key, e.grams, e.kcal] : null; }));
  t.eq(foods, [['현미밥', 210, 252], ['밥', 210, 300], ['김치전', 100, 126], ['김치', 50, 15], ['라면', 120, 505], ['계란', 100, 155], ['삼겹살', 200, 662], null],
    '음식 칼로리 (김치전은 김치가 아니라 김치전, ○○김치 ○, 양을 안 적으면 1인분, 라면은 봉지 기준)');

  // 내가 등록한 음식이 기본 표보다 우선
  const mine = await page.evaluate(() => { state.profile.foods = { 밥: { kcal100: 100, protein: 1 } }; return estimateKcal('밥', '100g').kcal; });
  t.eq(mine, 100, '직접 등록한 음식이 기본 표보다 우선');
  t.noErrors(page);
}
