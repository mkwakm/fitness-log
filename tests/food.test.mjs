// 음식 표 (식약처 음식 데이터 + 손으로 적은 표): 국·탕·찌개, 1인분 단위, 끝말 평균, 표기 차이, "한 그릇" 같은 양
import { tab, text, wait, ROOT } from './lib.mjs';
import { statSync } from 'node:fs';
import { join } from 'node:path';

export default async function (t) {
  const page = await t.open();
  const est = (name, amount) => page.evaluate(([n, a]) => estimateKcal(n, a), [name, amount]);
  const unit = (key, u) => page.evaluate(([k, u]) => FOOD_DB[k]?.units?.[u], [key, u]);

  // ── 표 크기 ──
  const size = await page.evaluate(() => ({ keys: Object.keys(FOOD_DB).length, mfds: MFDS_FOODS.length, names: FOOD_NAMES.length }));
  t.ok(size.mfds > 1000, `식약처 음식 ${size.mfds}가지`);
  t.ok(size.keys > 1200, `찾을 수 있는 이름 ${size.keys}개`);

  // ── 사용자가 먹었던 것 ──
  const dogani = await est('도가니탕', '1그릇');
  t.ok(dogani && dogani.key === '도가니탕', '도가니탕이 표에 있음');
  t.eq(dogani.grams, await unit('도가니탕', '그릇'), '1그릇 = 식약처 1인분 무게');
  t.eq(dogani.kcal, Math.round(40 * dogani.grams / 100), '도가니탕 100g당 40kcal (식약처)');
  t.ok(dogani.protein > 20, `단백질도 (${dogani.protein}g)`);
  t.eq(dogani.kind, 's', '국물 요리로 분류');
  const budae = await est('부대찌개', '1인분');
  t.eq(budae.grams, await unit('부대찌개', '인분'), '부대찌개 1인분 = 식약처 1인분 무게 (예전엔 기본값 200g으로 잡혀 턱없이 낮았다)');
  t.ok(budae.grams > 300, `부대찌개 1인분 ${budae.grams}g`);
  const src = await page.evaluate(() => MFDS_FOODS.find((r) => r[0] === '부대찌개'));
  t.eq([budae.grams, (await est('부대찌개', '1그릇')).grams], [src[3], src[3]],
    '그릇·인분 무게는 식약처 1인분 그대로 (옛 표의 어림값 500g이 덮어쓰지 않음)');
  t.eq((await est('부대찌개', '1그릇')).grams, budae.grams, '그릇·인분·뚝배기는 같은 1인분');
  t.eq((await est('부대찌개', '1뚝배기')).grams, budae.grams, '뚝배기도');

  // ── 흔한 국·탕·찌개가 다 있는지 ──
  const soups = ['갈비탕', '곰탕', '설렁탕', '삼계탕', '감자탕', '순대국', '육개장', '해장국', '뼈다귀해장국', '추어탕', '매운탕', '알탕', '떡국', '김치찌개', '된장찌개', '순두부찌개', '청국장찌개', '동태찌개', '곱창전골', '버섯전골', '미역국', '북어국', '콩나물국', '어묵탕', '마라탕'];
  const miss = [];
  for (const n of soups) { const e = await est(n, '1그릇'); if (!e || e.key !== n || e.generic) miss.push(n); }
  t.eq(miss, [], `흔한 국·탕·찌개 ${soups.length}가지가 제 이름으로 있음`);
  const dishes = ['제육볶음', '돈가스', '떡볶이', '김밥', '짜장면', '짬뽕', '냉면', '비빔밥', '볶음밥', '칼국수', '족발', '수육', '잡채', '오므라이스', '닭강정', '탕수육', '김치전', '달걀말이', '닭갈비', '찜닭', '양념치킨', '제육덮밥', '돼지국밥'];
  const miss2 = [];
  for (const n of dishes) { const e = await est(n, ''); if (!e || e.key !== n || e.generic) miss2.push(n); }
  t.eq(miss2, [], `흔한 외식 ${dishes.length}가지가 제 이름으로 있음`);

  // ── 이름 끝으로 찾기 ──
  t.eq((await est('엄마표부대찌개', '1그릇'))?.key, '부대찌개', '"엄마표부대찌개" → 부대찌개');
  t.eq((await est('할머니손맛김치', '50g'))?.key, '김치', '"○○김치" → 김치');
  t.eq((await est('김치케이크', '100g'))?.key, '케이크', '이름 가운데 "김치"가 있어도 끝(케이크)으로 잡음');
  const g = await est('우리집특제찌개', '1그릇');
  t.ok(g?.generic && g.key === '찌개', '딱 맞는 이름이 없으면 "찌개" 종류 평균');
  t.eq((await est('사탕', '1개'))?.kcal, 20, '"사탕"은 탕(국물) 평균이 아니라 사탕');
  t.eq((await est('설탕', '1큰술'))?.grams, 12, '"설탕"도');

  // ── 표기 차이 ──
  const same = async (a, b) => {
    const [x, y] = [await est(a, '1그릇'), await est(b, '1그릇')];
    return !!x && !!y && x.kcal === y.kcal && x.protein === y.protein && x.grams === y.grams;
  };
  t.eq((await est('계란말이', '100g'))?.key, '달걀말이', '계란말이 → 달걀말이');
  t.eq((await est('돈까스', '100g'))?.key, '돈가스', '돈까스 → 돈가스');
  t.eq((await est('쭈꾸미볶음', '100g'))?.key, '주꾸미볶음', '쭈꾸미 → 주꾸미');
  t.eq((await est('뼈해장국', '1그릇'))?.key, '뼈해장국', '뼈해장국 (뼈다귀해장국 값)');
  t.ok(await same('뼈해장국', '뼈다귀해장국'), '뼈해장국 = 뼈다귀해장국');
  t.ok(await same('불고기', '소불고기'), '불고기 = 소불고기');
  t.eq((await est('계란', '1개'))?.key, '계란', '"계란"은 원래 표에 있는 대로');

  // ── 말로 적는 양 ──
  const bab = await unit('밥', '공기');
  const amounts = [['밥', '한 공기', bab], ['밥', '반공기', bab / 2], ['밥', '공기반', null], ['밥', '한공기반', bab * 1.5], ['밥', '1/2공기', bab / 2],
    ['계란', '두 개', 100], ['계란', '세개', 150], ['바나나', '반개', 60], ['밥', '1.5공기', bab * 1.5]];
  for (const [n, a, grams] of amounts) {
    const e = await est(n, a);
    if (grams == null) continue;
    t.eq(e?.grams, grams, `${n} "${a}" = ${grams}g`);
  }
  const half = await est('부대찌개', '반');
  t.eq(half.grams, budae.grams / 2, '"반"만 적으면 1인분의 반');
  t.eq((await est('닭가슴살', '200'))?.grams, 200, '숫자만이면 g');

  // ── 화면: 안내 문구 ──
  await tab(page, 'meals');
  await page.fill('#foodName', '도가니탕');
  await page.fill('#foodAmount', '1그릇');
  const hint = await text(page, '#mealHint');
  t.ok(hint.includes('도가니탕') && hint.includes('밥은 따로'), `국물 요리는 "밥은 따로" (${hint})`);
  t.eq(await page.inputValue('#foodKcal'), String(dogani.kcal), '칼로리 칸 자동 채움');
  await page.fill('#foodName', '우리집특제찌개');
  t.ok((await text(page, '#mealHint')).includes("'찌개' 종류 평균으로 추정"), '평균으로 잡았으면 그렇다고 알려줌');

  // ── 고친 칼로리로 기억 (단위는 그대로) ──
  await page.fill('#foodName', '도가니탕');
  await page.fill('#foodAmount', '1그릇');
  await page.fill('#foodKcal', '600');
  await page.dispatchEvent('#foodKcal', 'input');
  t.ok(await page.locator('#rememberFood').isVisible(), '표 값과 다르게 고치면 "고친 칼로리로 기억하기"');
  await page.click('#rememberFood');
  await wait(page, 100);
  const mine = await est('도가니탕', '1그릇');
  t.eq([mine.kcal, mine.grams], [600, dogani.grams], '다음부터 도가니탕 1그릇 = 600kcal (1그릇 무게는 그대로)');
  t.ok((await text(page, '#mealHint')).includes('내가 등록한'), '내가 등록한 값이라고 표시');
  await page.evaluate(() => { delete state.profile.foods['도가니탕']; save(); });

  // ── 자동완성: 이름 칸 아래에 후보 ("자주 먹는 음식" 칩 대신) ──
  await page.evaluate(() => {
    day().meals.push({ id: 'g1', type: '점심', name: '가자미구이', amount: '1토막', kcal: 262, protein: 30 },
      { id: 'g2', type: '저녁', name: '가자미구이', amount: '1토막', kcal: 262 },
      { id: 'z', type: '점심', name: '엄마표부대찌개', amount: '1그릇', kcal: 500 });
    save(); render();
  });
  t.eq(await page.locator('#favFoods, #loadMeals').count(), 0, '"자주 먹는 음식" 칸·"그대로 불러오기" 버튼 없음');
  const sug = () => page.locator('#foodSuggest .suggest-item span').allTextContents();
  const typeIn = async (v) => { await page.fill('#foodName', v); await page.dispatchEvent('#foodName', 'input'); };
  await page.fill('#foodAmount', '');
  await typeIn('');
  await page.focus('#foodName');
  t.ok(await page.locator('#foodSuggest').isHidden(), '빈칸이면 안 띄움');
  await page.locator('#foodName').pressSequentially('가');
  let list = await sug();
  t.eq(list[0], '가자미구이', "'가'만 쳐도 자주 먹은 가자미구이가 맨 위");
  t.ok(list.length > 1 && list.length <= 8, `후보는 8개까지 (${list.length}개)`);
  t.ok((await text(page, '#foodSuggest .suggest-item')).includes('1토막 · 262kcal'), '먹어 본 음식은 지난번 양·칼로리');
  const h = await page.locator('#foodSuggest .suggest-item').first().boundingBox();
  t.ok(h.height >= 44, `후보는 누르기 쉬운 높이 (${h.height}px)`);
  await typeIn('가ㅈ');
  t.eq((await sug())[0], '가자미구이', "치는 중인 자음('가ㅈ')도 가자미구이");
  await typeIn('부대');
  t.eq((await sug()).slice(0, 2), ['엄마표부대찌개', '부대찌개'], '내가 먹은 음식이 먼저, 그다음 음식 표');
  await typeIn('찌개');
  t.ok(!(await sug()).includes('찌개'), '끝말 평균("찌개")은 후보에 안 띄움');
  await typeIn('도가');
  t.ok((await sug()).includes('도가니탕'), '안 먹어 본 음식도 표에서 (도가니탕)');
  await typeIn('가자');
  await page.click('#foodSuggest [data-food-pick="0"]');
  t.eq([await page.inputValue('#foodName'), await page.inputValue('#foodAmount')], ['가자미구이', '1토막'], '누르면 이름과 지난번 양이 채워짐');
  t.ok(Number(await page.inputValue('#foodKcal')) > 0, '칼로리도 채워짐');
  t.ok(await page.locator('#foodSuggest').isHidden(), '고르면 목록이 닫힘');
  t.eq(await page.evaluate(() => document.activeElement.id), 'foodAmount', '양 칸으로 넘어감 (바로 고치거나 추가)');
  await page.fill('#foodAmount', '');
  await page.focus('#foodName');
  await typeIn('도가니');
  const mealsBefore = await page.evaluate(() => day().meals.length);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  t.eq(await page.inputValue('#foodName'), '도가니탕', '키보드 ↓ Enter로도 고름');
  t.eq(await page.evaluate(() => day().meals.length), mealsBefore, '그 Enter로 식단이 추가되진 않음');
  await page.focus('#foodName');
  await typeIn('가');
  await page.keyboard.press('Escape');
  t.ok(await page.locator('#foodSuggest').isHidden(), 'ESC로 닫힘');
  await page.evaluate(() => { day().meals = day().meals.filter((m) => !['g1', 'g2', 'z'].includes(m.id)); resetMealForm(); save(); render(); });

  // ── 파일 크기 ──
  const bytes = statSync(join(ROOT, 'food-db.js')).size;
  t.ok(bytes < 150000, `food-db.js ${Math.round(bytes / 1024)}KB (휴대폰에서 매번 읽는 파일)`);
  t.noErrors(page);
}
