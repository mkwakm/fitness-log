// 식단 사진: 줄여 담기, 표시, 지우기·되돌리기, 사진까지 내보내기·가져오기, 정리
import { tab, wait } from './lib.mjs';
import { readFileSync, statSync } from 'node:fs';

export default async function (t) {
  const alerts = [];
  const A = await t.open({ context: { acceptDownloads: true }, dialog: (d) => { alerts.push(d.message()); d.accept(); } });

  // 폰 카메라 원본 흉내: 2400×1800 PNG (용량이 큼)
  const b64 = await A.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 2400; c.height = 1800;
    const g = c.getContext('2d');
    for (let i = 0; i < 400; i++) { g.fillStyle = `hsl(${i * 37 % 360},70%,50%)`; g.fillRect((i * 97) % 2400, (i * 53) % 1800, 180, 140); }
    return c.toDataURL('image/png').split(',')[1];
  });
  const photo = { name: 'food.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') };
  const count = (p) => p.evaluate(async () => (await photoTx('readonly', (st) => st.getAllKeys())).length);
  const has = (p, id) => p.evaluate(async (id) => !!(await photoTx('readonly', (st) => st.get(id))), id);
  const shown = (p) => p.evaluate(() => !!document.querySelector('#mealList img[data-photo]')?.src.startsWith('blob:'));

  await A.setInputFiles('#mealPhoto', photo);
  await wait(A, 800);
  const id = await A.evaluate(() => pendingPhoto);
  t.ok(!!id, '사진을 고르면 담김');
  const info = await A.evaluate(async (id) => {
    const blob = await photoTx('readonly', (st) => st.get(id));
    const img = new Image(); const url = URL.createObjectURL(blob);
    await new Promise((r) => { img.onload = r; img.src = url; });
    URL.revokeObjectURL(url);
    return { type: blob.type, long: Math.max(img.width, img.height), kb: blob.size / 1024 };
  }, id);
  t.eq([info.type, info.long], ['image/jpeg', 900], '긴 변 900px JPEG로 줄임');
  t.ok(info.kb < 400, `한 장 400KB 안쪽 (${Math.round(info.kb)}KB) — 원본 폰 사진은 5MB가 넘는다`);

  await A.fill('#foodName', '밥'); await A.fill('#foodAmount', '1공기');
  await A.click('#mealForm button[type=submit]');
  await wait(A, 500);
  t.eq(await A.evaluate(() => day().meals[0].photo), id, '식단에 사진 id가 붙음');
  t.eq(await A.evaluate(() => pendingPhoto), null, '폼은 비워짐');
  t.ok(await shown(A), '목록에 사진이 뜸');
  await A.click('#mealList img[data-photo]');
  t.ok(await A.locator('#photoView').isVisible(), '누르면 크게 보기');
  await A.click('#photoView');
  t.ok(await A.locator('#photoView').isHidden(), '다시 누르면 닫힘');
  t.ok(!(await A.evaluate(() => JSON.stringify(state))).includes('data:image'), '기록(JSON)엔 id만, 사진 데이터는 안 섞임');
  await A.reload();
  await wait(A, 600);
  t.ok(await shown(A), '새로고침 뒤에도 사진이 남음');

  // ── 지우면: 되돌리기 시간 동안은 보관, 지나면 삭제 ──
  await A.click('[data-del-meal]');
  await wait(A, 200);
  t.ok(await has(A, id), '지운 직후엔 사진을 보관 (되돌릴 수 있게)');
  await A.click('#undoBtn');
  await wait(A, 400);
  t.ok(await has(A, id) && await shown(A), '되돌리면 사진도 그대로');
  await A.click('[data-del-meal]');
  await A.evaluate(() => hideUndo());
  await wait(A, 400);
  t.ok(!(await has(A, id)), '되돌리기 창이 닫히면 사진도 지움');

  // ── 사진 2장짜리 기록을 사진까지 내보내기 ──
  for (const [n, a] of [['밥', '1공기'], ['닭가슴살', '200g']]) {
    await A.setInputFiles('#mealPhoto', photo);
    await wait(A, 700);
    await A.fill('#foodName', n); await A.fill('#foodAmount', a);
    await A.click('#mealForm button[type=submit]');
    await wait(A, 300);
  }
  t.eq(await count(A), 2, '사진 2장 저장');
  await tab(A, 'history');
  const [dl] = await Promise.all([A.waitForEvent('download'), A.click('#exportPhotoBtn')]);
  const path = await dl.path();
  const json = JSON.parse(readFileSync(path, 'utf8'));
  t.eq(Object.keys(json.photos || {}).length, 2, '사진까지 내보내기에 2장');
  t.ok(String(Object.values(json.photos)[0]).startsWith('data:image/'), '사진은 data URL로');
  const [dl2] = await Promise.all([A.waitForEvent('download'), A.click('#exportBtn')]);
  const plainPath = await dl2.path();
  t.ok(JSON.parse(readFileSync(plainPath, 'utf8')).photos === undefined, '평소 내보내기엔 사진 없음');
  t.ok(statSync(plainPath).size < statSync(path).size / 5, '평소 파일은 훨씬 가벼움');

  // ── 다른 기기에서 가져오기 ──
  const B = await t.open({ dialog: (d) => { alerts.push(d.message()); d.accept(); } });
  await B.setInputFiles('#importFile', path);
  await wait(B, 1200);
  t.eq(await count(B), 2, '다른 기기로 사진 2장이 옮겨감');
  t.ok(await shown(B), '가져온 쪽 화면에도 사진');
  await B.setInputFiles('#importFile', path);
  await wait(B, 1000);
  t.eq(await count(B), 2, '또 가져와도 중복 안 생김');

  // ── 안 쓰는 사진 정리 ──
  await B.evaluate(() => { day().meals = day().meals.slice(0, 1); save(); render(); });
  await tab(B, 'history');
  await B.click('#prunePhotoBtn');
  await wait(B, 600);
  t.eq(await count(B), 1, '안 쓰는 사진 1장 정리');
  t.ok(await has(B, await B.evaluate(() => day().meals[0].photo)), '쓰는 사진은 남음');

  // ── 사진을 담는 중엔 추가를 못 누른다 (누르면 버리는 중인 앞 사진이 기록에 붙었다) ──
  await tab(B, 'meals');
  await B.fill('#foodName', '김밥');
  await B.evaluate(() => {
    const orig = savePhoto;
    savePhoto = (f) => new Promise((r) => { window.releaseSave = () => r(orig(f)); });
  });
  await B.setInputFiles('#mealPhoto', photo);
  await B.waitForFunction(() => window.releaseSave);
  t.ok(await B.locator('#mealForm button[type=submit]').isDisabled(), '담는 동안 추가 버튼은 잠김');
  await B.evaluate(() => releaseSave());
  await B.waitForFunction(() => pendingPhoto);
  t.ok(await B.locator('#mealForm button[type=submit]').isEnabled(), '다 담으면 다시 눌림');
  t.noErrors(A, '폰');
  t.noErrors(B, 'PC');
}
