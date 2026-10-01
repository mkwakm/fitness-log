// 토큰 없는 동기화: PC 파일 자동 저장(File System Access), 휴대폰 공유, 백업 가져오기(합치기)
import { tab, text, wait } from './lib.mjs';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 클라우드 드라이브의 같은 파일을 두 PC가 보는 상황. 파일 내용은 노드 쪽에 둔다.
function fakeFileSystem() {
  const handle = {
    name: 'fitness-log.json',
    queryPermission: async () => window.__perm ?? 'granted',
    requestPermission: async () => { window.__perm = 'granted'; return 'granted'; },
    getFile: async () => ({ text: async () => window.cloudRead() }),
    createWritable: async () => { let buf = ''; return { write: async (x) => { buf = x; }, close: async () => window.cloudWrite(buf) }; },
  };
  window.showSaveFilePicker = async () => handle;
  window.showOpenFilePicker = async () => [handle];
  // 가짜 핸들은 IndexedDB에 구조화 복제가 안 되므로 메모리 저장소로 바꿔 둔다
  const store = new Map();
  Object.defineProperty(window, 'indexedDB', { configurable: true, value: { open() {
    const req = {};
    setTimeout(() => {
      req.result = {
        objectStoreNames: { contains: () => true },
        createObjectStore() {},
        transaction() {
          const tx = {};
          setTimeout(() => tx.oncomplete?.(), 0);
          return {
            objectStore: () => ({ put: (v, k) => store.set(k, v), get: (k) => { const r = { result: store.get(k) }; setTimeout(() => r.onsuccess?.(), 0); return r; },
              delete: (k) => store.delete(k), getAllKeys: () => { const r = { result: [...store.keys()] }; setTimeout(() => r.onsuccess?.(), 0); return r; } }),
            get oncomplete() { return tx.oncomplete; }, set oncomplete(f) { tx.oncomplete = f; },
          };
        },
      };
      req.onsuccess?.();
    }, 0);
    return req;
  } } });
}

export default async function (t) {
  let cloud = '';
  const openPC = async () => {
    const p = await t.open({ init: fakeFileSystem, viewport: { width: 420, height: 900 } });
    await p.exposeFunction('cloudRead', () => cloud).catch(() => {});
    await p.exposeFunction('cloudWrite', (x) => { cloud = x; }).catch(() => {});
    await p.reload();
    await p.waitForSelector('#mealList', { state: 'attached' });
    await tab(p, 'history');
    return p;
  };
  const addMeal = (p, n) => p.evaluate((n) => { day().meals.push({ id: uid(), type: '점심', name: n, amount: '', kcal: 100 }); save(); render(); }, n);
  const meals = (p) => p.evaluate(() => day().meals.map((m) => m.name).sort());

  // ── 화면 순서: 토큰 없는 방법이 위 ──
  const A = await openPC();
  const card = await text(A, '#syncCard');
  t.ok(card.indexOf('파일') < card.indexOf('Gist'), '파일 방식이 Gist보다 위');

  // ── 파일 자동 저장 ──
  await A.click('#filePickBtn');
  await wait(A, 300);
  t.ok(cloud.length > 0, '파일을 지정하면 바로 씀');
  await addMeal(A, 'PC1_점심');
  await wait(A, 2400);
  t.ok(cloud.includes('PC1_점심'), '기록하면 잠시 뒤 파일에 자동 저장');

  // ── 다른 PC가 같은 파일을 고르면: 읽고 나서 쓴다 ──
  const B = await openPC();
  await addMeal(B, 'PC2_저녁');
  await B.click('#filePickBtn');
  await wait(B, 500);
  t.eq(await meals(B), ['PC1_점심', 'PC2_저녁'], '다른 PC가 쓰던 파일을 고르면 먼저 합침 (덮어쓰지 않음)');
  await wait(B, 2400);
  t.ok(cloud.includes('PC1_점심') && cloud.includes('PC2_저녁'), '파일에 둘 다');
  await tab(A, 'history');
  await A.click('#fileReadBtn');
  await wait(A, 400);
  t.eq(await meals(A), ['PC1_점심', 'PC2_저녁'], 'PC1이 불러오면 합쳐짐');

  // ── 권한이 풀리면 조용히 넘어가지 않는다 ──
  await A.evaluate(() => { window.__perm = 'prompt'; });
  await addMeal(A, '권한풀린뒤');
  await wait(A, 2400);
  t.ok(!cloud.includes('권한풀린뒤'), '권한이 없으면 못 씀');
  t.ok((await text(A, '#syncCard')).includes('저장되지 않고'), '못 쓰고 있다고 경고');
  t.eq(await A.locator('#fileRelinkBtn').count(), 1, '"다시 연결" 버튼');
  await A.click('#fileRelinkBtn');
  await wait(A, 2600);
  t.ok(cloud.includes('권한풀린뒤'), '다시 연결하면 밀린 기록까지 저장');
  t.eq(await A.locator('#fileRelinkBtn').count(), 0, '경고가 사라짐');

  // ── 끄기 ──
  await A.click('#fileOffBtn');
  await wait(A, 200);
  await addMeal(A, '끈뒤');
  await wait(A, 2400);
  t.ok(!cloud.includes('끈뒤'), '끄면 파일에 안 씀');

  // ── 휴대폰: 공유 ──
  const P = await t.open({ init: () => {
    delete window.showSaveFilePicker;
    navigator.canShare = () => true;
    navigator.share = async (d) => { window.__shared = d.files[0].name; };
  } });
  await addMeal(P, '폰_아침');
  await tab(P, 'history');
  t.ok(!(await text(P, '#syncCard')).includes('파일 지정'), '파일 방식을 못 쓰는 폰에선 안 보임');
  await P.click('#shareBtn');
  await wait(P, 200);
  t.ok(/\.json$/.test(await P.evaluate(() => window.__shared) || ''), '내보내 공유로 JSON 파일을 넘김');
  // 윈도우 크롬·엣지는 실제로 공유를 지원하므로 못 하는 브라우저를 직접 흉내 낸다
  const P2 = await t.open({ init: () => { delete window.showSaveFilePicker; navigator.canShare = () => false; } });
  await tab(P2, 'history');
  t.eq(await P2.locator('#shareBtn').count(), 0, '공유를 못 하는 브라우저면 버튼을 숨김');

  // ── 백업 가져오기는 합친다 ──
  const dir = mkdtempSync(join(tmpdir(), 'fl-'));
  const file = join(dir, 'backup.json');
  const pcState = await A.evaluate(() => { day().meals.push({ id: 'pc1', type: '점심', name: 'PC_점심', amount: '', kcal: 1 }); return JSON.stringify(state); });
  writeFileSync(file, pcState);
  await addMeal(P, '폰_저녁');
  const before = await meals(P);
  await P.setInputFiles('#importFile', file);
  await wait(P, 400);
  const after = await meals(P);
  t.ok(before.every((m) => after.includes(m)) && after.includes('PC_점심'), '가져오면 지금 기록에 합쳐짐 (덮어쓰지 않음)');
  await P.click('#undoBtn');
  t.eq(await meals(P), before, '가져오기도 되돌릴 수 있음');
  await P.setInputFiles('#importFile', file);
  await wait(P, 300);
  t.ok((await meals(P)).includes('PC_점심'), '같은 파일을 다시 골라도 동작 (input 값을 먼저 비움)');
  t.noErrors(A, 'PC1');
  t.noErrors(B, 'PC2');
  t.noErrors(P, '폰');
}
