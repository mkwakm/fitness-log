// 식단 사진으로 음식 알아보기 (vision.js): 처음 동의 → 모르는 음식은 이름 받기 → 다음엔 자동 입력,
// 틀렸으면 고치기, 애매하면 후보, 기본 분류기, 지난 사진 배우기, 지우면 배운 것도 지우기.
// 진짜 AI 모델(50MB)은 받지 않는다. 사진 색으로 숫자를 만드는 가짜 엔진을 심는다:
//  같은 색 = 같은 음식, 왼쪽·오른쪽 색이 다르면 두 음식이 섞인 애매한 사진.
import { wait } from './lib.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib.mjs';

function fake(arg) {
  const vecOf = (r, g, b) => {
    const k = Math.round(r * 4) * 25 + Math.round(g * 4) * 5 + Math.round(b * 4);
    const v = new Float32Array(768).fill(0.05);
    for (let i = 0; i < 6; i++) v[k * 6 + i] = 1.05;
    return v;
  };
  window.FAKE_VISION = {
    calls: 0,
    fail: false,
    async embed(blob) {
      this.calls += 1;
      if (this.fail) throw new Error('모델을 못 받음');
      const bmp = await createImageBitmap(blob);
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext('2d');
      g.drawImage(bmp, 0, 0);
      const px = (x) => g.getImageData(Math.floor(x), Math.floor(bmp.height / 2), 1, 1).data;
      const a = px(bmp.width / 4), b = px(bmp.width * 3 / 4);
      const va = vecOf(a[0] / 255, a[1] / 255, a[2] / 255), vb = vecOf(b[0] / 255, b[1] / 255, b[2] / 255);
      return va.map((x, i) => x + vb[i]);
    },
  };
  if (arg?.head) {
    // 기본 분류기: 초록 = 비빔밥, 노랑 = 된장찌개
    const rows = [vecOf(0.04, 0.78, 0.04), vecOf(0.86, 0.86, 0.04)].map((v) => {
      const s = Math.hypot(...v);
      return v.map((x) => x / s);
    });
    const W = new Float32Array(2 * 768);
    W.set(rows[0], 0); W.set(rows[1], 768);
    const b64 = btoa(String.fromCharCode(...new Uint8Array(W.buffer)));
    const head = { model: 'onnx-community/dinov2-small', labels: ['비빔밥', '된장찌개'], dim: 768, mean: [], W: b64, b: [0, 0], scale: 30 };
    window.VISION_HEAD_URL = 'data:application/json,' + encodeURIComponent(JSON.stringify(head));
  }
}

const RED = [220, 10, 10], BLUE = [10, 10, 220], GREEN = [10, 200, 10], YELLOW = [220, 220, 10], GRAY = [128, 128, 128];

async function img(page, left, right = left) {
  const b64 = await page.evaluate(([l, r]) => {
    const c = document.createElement('canvas'); c.width = 400; c.height = 300;
    const g = c.getContext('2d');
    g.fillStyle = `rgb(${l})`; g.fillRect(0, 0, 200, 300);
    g.fillStyle = `rgb(${r})`; g.fillRect(200, 0, 200, 300);
    return c.toDataURL('image/png').split(',')[1];
  }, [left.join(','), right.join(',')]);
  return { name: 'food.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') };
}
const until = (p, m) => p.waitForFunction((m) => (visionState?.mode ?? null) === m, m, { timeout: 5000 }).then(() => true, () => false);
const meals = (p) => p.evaluate(() => day().meals.map((m) => ({ name: m.name, amount: m.amount, kcal: m.kcal, photo: m.photo })));
const vectors = (p) => p.evaluate(async () => [...(await allVectors()).keys()]);
// waitForFunction은 promise를 기다려 주지 않아서(promise 자체가 참으로 보인다) 직접 몇 번 물어본다
async function untilVectors(p, ok, ms = 3000) {
  for (const end = Date.now() + ms; Date.now() < end; await wait(p, 100)) if (ok(await vectors(p))) return true;
  return false;
}
async function pickPhoto(p, left, right) {
  await p.setInputFiles('#mealPhoto', await img(p, left, right));
}
async function addNamed(p, name, amount = '') {
  await p.fill('#foodName', name);
  await p.fill('#foodAmount', amount);
  await p.click('#mealForm button[type=submit]');
  await wait(p, 300);
}

export default async function (t) {
  // ── 처음: 동의를 받고 나서야 모델을 부른다 ──
  const A = await t.open({ init: { fn: fake } });
  t.ok(await A.locator('#visionBox').isHidden(), '처음엔 결과 칸이 숨어 있음');
  await pickPhoto(A, RED);
  t.ok(await until(A, 'ask'), '이름 없이 사진을 고르면 먼저 물어봄 (모델이 50MB라서)');
  t.ok((await A.textContent('#visionBox')).includes('이 기기 밖으로 나가지 않아요'), '사진이 밖으로 안 나간다고 알려줌');
  t.eq(await A.evaluate(() => FAKE_VISION.calls), 0, '동의 전엔 모델을 안 부름');
  await A.click('[data-vision="on"]');
  t.ok(await until(A, 'new'), '배운 게 없으면 "아직 모르는 음식"');
  t.eq(await A.evaluate(() => readUi().vision), 'on', '동의는 이 기기 화면 상태에 기억');
  t.ok(!(await A.evaluate(() => JSON.stringify(state))).includes('vision'), '동의는 기록(동기화·백업)엔 안 들어감');
  t.eq(await A.evaluate(() => document.activeElement?.id), 'foodName', '이름 칸으로 커서를 옮김');
  const firstPhoto = await A.evaluate(() => pendingPhoto);
  await addNamed(A, '부대찌개', '1그릇');
  t.ok(await A.locator('#visionBox').isHidden(), '이름을 적어 넣으면 결과 칸은 닫힘');
  t.ok(await untilVectors(A, (v) => v.includes(firstPhoto)), '이름이 붙은 사진을 배움 (벡터 저장)');

  // ── 다음엔 같은 음식 사진이면 바로 들어간다 ──
  await pickPhoto(A, RED);
  t.ok(await until(A, 'done'), '같은 음식 사진은 자동으로 넣음');
  const est = await A.evaluate(() => estimateKcal('부대찌개', '1그릇'));
  let list = await meals(A);
  t.eq(list.length, 2, '식단이 하나 늘어남 (누를 것 없이)');
  t.eq([list[1].name, list[1].amount, list[1].kcal], ['부대찌개', '1그릇', est.kcal], '이름·늘 먹던 양·식약처 칼로리로');
  t.ok(list[1].photo && list[1].photo !== firstPhoto, '새 사진이 붙음');
  t.eq(await A.evaluate(() => pendingPhoto), null, '폼은 비워짐');
  t.ok((await A.textContent('#visionBox')).includes('부대찌개'), '무엇으로 넣었는지 알려줌');

  // ── 틀렸으면: 빼고, 사진은 폼에 다시 붙이고, 그 음식은 빼고 다시 찾는다 ──
  const wrongId = await A.evaluate(() => visionState.meal.id);
  const wrongPhoto = list[1].photo;
  await A.click('[data-vision="wrong"]');
  t.ok(await until(A, 'new'), '다른 후보가 없으면 이름을 적게 함');
  list = await meals(A);
  t.eq(list.length, 1, '자동으로 넣은 기록을 뺌');
  t.ok(await A.evaluate((id) => day().deleted?.includes(id), wrongId), '뺀 것은 다른 기기에도 전달되게 삭제 표시');
  t.eq(await A.evaluate(() => pendingPhoto), wrongPhoto, '사진은 폼에 다시 붙음');
  await addNamed(A, '김치찌개');
  t.eq((await meals(A)).at(-1), { name: '김치찌개', amount: '', kcal: (await A.evaluate(() => estimateKcal('김치찌개', '').kcal)), photo: wrongPhoto }, '고친 이름으로 사진과 함께 들어감');

  // ── 처음 보는 음식 ──
  await pickPhoto(A, BLUE);
  t.ok(await until(A, 'new'), '전혀 다른 사진은 억지로 안 넣음');
  await addNamed(A, '도가니탕', '1그릇');

  // ── 애매한 사진: 후보를 보여주고, 누르면 바로 들어간다 ──
  const before = (await meals(A)).length;
  await pickPhoto(A, BLUE, RED);
  t.ok(await until(A, 'pick'), '두 음식이 섞인 듯 애매하면 후보를 보여줌');
  const cands = await A.evaluate(() => visionState.cands);
  t.ok(cands.includes('도가니탕') && cands.length <= 3, `후보에 닮은 음식 (${cands.join(', ')})`);
  t.eq((await meals(A)).length, before, '후보만 보여주고 아직 안 넣음');
  await A.click(`[data-vision-pick="${cands.indexOf('도가니탕')}"]`);
  t.ok(await until(A, 'done'), '후보를 누르면 바로 들어감');
  t.eq((await meals(A)).at(-1).name, '도가니탕', '고른 음식으로');
  t.eq((await meals(A)).at(-1).amount, '1그릇', '양은 그 음식을 마지막으로 먹은 양');
  await A.click('[data-vision="close"]');
  t.ok(await A.locator('#visionBox').isHidden(), '확인을 누르면 닫힘');

  // ── 이름을 먼저 적었으면: 알아보지 않고 붙이기만 (그리고 배운다) ──
  await A.fill('#foodName', '현미밥');
  const calls = await A.evaluate(() => FAKE_VISION.calls);
  await pickPhoto(A, GRAY);
  await wait(A, 400);
  t.ok(await A.locator('#visionBox').isHidden(), '이름을 적어 뒀으면 결과 칸이 안 뜸');
  const grayPhoto = await A.evaluate(() => pendingPhoto);
  await A.click('#mealForm button[type=submit]');
  t.ok(await untilVectors(A, (v) => v.includes(grayPhoto)), '넣을 때 그 사진을 배움');
  t.ok((await A.evaluate(() => FAKE_VISION.calls)) > calls, '배우느라 모델을 한 번 부름');

  // ── 한 번 동의했으면 다시 안 묻는다 ──
  await A.reload();
  await A.waitForSelector('#mealList', { state: 'attached' });
  await pickPhoto(A, GRAY);
  t.ok(await until(A, 'done'), '새로고침해도 동의는 그대로 (안 묻고 바로)');
  t.eq((await meals(A)).at(-1).name, '현미밥', '이름을 적어 넣었던 사진으로도 알아봄');

  // ── 지우면 배운 것도 지운다 (되돌리기 시간이 지난 뒤) ──
  const lastPhoto = (await meals(A)).at(-1).photo;
  t.ok((await vectors(A)).includes(lastPhoto), '지우기 전엔 벡터가 있음');
  await A.locator('[data-del-meal]').last().click();
  await A.evaluate(() => hideUndo());
  await wait(A, 400);
  t.ok(!(await vectors(A)).includes(lastPhoto), '사진을 지우면 배운 벡터도 지움');

  // ── 휴대폰 화면 ──
  await pickPhoto(A, BLUE, RED);
  await until(A, 'pick');
  for (const w of [375, 320]) {
    await A.setViewportSize({ width: w, height: 800 });
    const r = await A.evaluate(() => ({
      over: document.documentElement.scrollWidth - innerWidth,
      small: [...document.querySelectorAll('#visionBox button')].filter((b) => b.getBoundingClientRect().height < 40).length,
    }));
    t.ok(r.over <= 0, `${w}px 가로 스크롤 없음`);
    t.eq(r.small, 0, `${w}px 결과 칸 버튼 40px 이상`);
  }
  t.noErrors(A);

  // ── 안 받겠다고 하면 ──
  const B = await t.open({ init: { fn: fake } });
  await pickPhoto(B, RED);
  await until(B, 'ask');
  await B.click('[data-vision="skip"]');
  t.ok(await B.locator('#visionBox').isHidden(), '"직접 적을게요"면 닫힘');
  t.eq([await B.evaluate(() => readUi().vision ?? null), await B.evaluate(() => FAKE_VISION.calls)], [null, 0], '동의 안 함 · 모델 안 부름');
  t.eq(await B.evaluate(() => pendingPhoto != null), true, '사진은 그대로 붙어 있음');

  // ── 모델을 못 받으면 ──
  await B.evaluate(() => { FAKE_VISION.fail = true; });
  await pickPhoto(B, RED);
  await until(B, 'ask');
  await B.click('[data-vision="on"]');
  t.ok(await until(B, 'error'), '못 받으면 알려줌');
  t.ok((await B.textContent('#visionBox')).includes('직접 적어'), '직접 적으라고 안내');
  t.noErrors(B);

  // ── 지난 사진 배우기: 모델을 켜기 전에 이름과 함께 넣은 사진들 ──
  const C = await t.open({ init: { fn: fake } });
  await pickPhoto(C, RED);
  await until(C, 'ask');
  await C.click('[data-vision="skip"]');
  await addNamed(C, '부대찌개', '1그릇');
  t.eq((await vectors(C)).length, 0, '켜기 전엔 배우지 않음 (모델을 안 받았으니)');
  await pickPhoto(C, RED);
  await until(C, 'ask');
  await C.click('[data-vision="on"]');
  await until(C, 'new');
  t.ok(await untilVectors(C, (v) => v.length >= 2), '켜고 나면 지난 사진도 배움');
  await C.click('#mealForm button[type=submit]').catch(() => {});   // 이름 칸이 비어 제출 안 됨 — 그대로 둔다
  await C.evaluate(() => { resetMealForm(); setVision(null); });
  await pickPhoto(C, RED);
  t.ok(await until(C, 'done'), '그래서 지난 사진의 음식을 바로 알아봄');
  t.noErrors(C);

  // ── 기본 분류기 (AI Hub로 학습해 둘 표) ──
  const D = await t.open({ init: { fn: fake, arg: { head: true } } });
  await D.evaluate(() => saveUi({ vision: 'on' }));
  await pickPhoto(D, GREEN);
  t.ok(await until(D, 'done'), '기본 분류기가 확실하면 내 사진이 없어도 자동');
  t.eq((await meals(D))[0].name, '비빔밥', '기본 분류기의 이름으로');
  t.eq((await meals(D))[0].kcal, await D.evaluate(() => estimateKcal('비빔밥', '1인분').kcal), '처음 먹는 음식은 1인분으로');
  await D.click('[data-vision="wrong"]');
  await D.waitForFunction(() => ['pick', 'new'].includes(visionState?.mode), null, { timeout: 3000 });
  t.ok(!(await D.evaluate(() => visionState.cands ?? [])).includes('비빔밥'), '틀렸다고 한 음식은 후보에서 뺌');
  t.eq((await meals(D)).length, 0, '틀린 기록은 빠짐');
  await D.evaluate(() => { resetMealForm(); setVision(null); });
  await pickPhoto(D, GREEN, YELLOW);
  t.ok(await until(D, 'pick'), '기본 분류기도 반반이면 자동 대신 후보');
  t.eq((await D.evaluate(() => visionState.cands)).slice().sort(), ['된장찌개', '비빔밥'], '후보는 두 음식');
  t.noErrors(D);

  // ── 견주는 규칙 (rankFoods) ──
  const r = await D.evaluate(() => {
    const v = (k, base = 0.05) => { const x = new Float32Array(768).fill(base); for (let i = 0; i < 6; i++) x[k * 6 + i] = 1.05; return x; };
    const mix = (a, b, w) => a.map((x, i) => x * w + b[i] * (1 - w));
    const ex = [{ name: '김밥', v: v(1) }, { name: '라면', v: v(2) }];
    const out = {};
    out.same = rankFoods(v(1), ex, null);
    out.far = rankFoods(v(9), ex, null);
    out.half = rankFoods(mix(v(1), v(2), 0.5), ex, null);
    out.skip = rankFoods(v(1), ex, null, ['김밥']);
    // 20장이 넘으면 평균을 빼고 견준다: 모든 사진이 공통으로 닮은 부분(배경 0.6)이 빠져 구별이 된다
    const many = Array.from({ length: 24 }, (_, i) => ({ name: `음식${i % 12}`, v: v(10 + (i % 12), 0.6) }));
    out.rawSim = (() => { const a = v(10, 0.6), b = v(11, 0.6); return dot(unit(a), unit(b)); })();
    out.centered = rankFoods(v(10, 0.6), many, null);
    out.centeredNew = rankFoods(v(40, 0.6), many, null);
    return out;
  });
  t.eq(r.same.auto, '김밥', '똑같은 사진은 자동');
  t.eq([r.far.auto, r.far.cands.length], [null, 0], '닮은 게 없으면 자동도 후보도 없음');
  t.ok(r.half.auto === null && r.half.cands.length === 2, '반반 닮았으면 자동 대신 후보 둘');
  t.ok(r.skip.auto !== '김밥' && !r.skip.cands.includes('김밥'), '틀렸다고 한 음식은 빼고 봄');
  t.ok(r.rawSim > 0.85, `평균을 안 빼면 서로 다른 음식도 닮아 보임 (${r.rawSim.toFixed(2)})`);
  t.eq(r.centered.auto, '음식0', '사진이 많으면 평균을 빼고 견줘서 맞힘');
  t.eq(r.centeredNew.auto, null, '평균을 뺀 뒤엔 처음 보는 음식을 억지로 안 넣음');

  // ── 오프라인: AI 라이브러리 캐시는 앱을 고쳐도 안 지운다 ──
  const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
  t.ok(/k !== CACHE && k !== AI_CACHE/.test(sw), '앱 새 버전이 깔려도 AI 캐시는 남김 (50MB를 다시 받지 않게)');
  t.ok(/'vision\.js'/.test(sw), 'vision.js도 오프라인 캐시에 들어감');
}
