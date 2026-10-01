// 식단 사진으로 음식 알아보기.
// 사진은 이 기기 밖으로 나가지 않는다. 작은 AI 모델(DINOv2-small, 약 24MB, Apache 2.0)을 처음 한 번 받아
// 브라우저 안에서 돌린다 — 서버·API 키·비용이 없어서 배포해도 그대로 무료다.
//
// 모델은 사진을 768개 숫자(특징 벡터)로 바꿀 뿐이고, 무슨 음식인지는 "이름이 붙은 사진"과 견줘서 정한다.
//  ① 내 사진: 식단에 사진과 이름을 같이 넣으면 그 사진이 예시가 된다. 이름은 식단 기록에서 읽으므로
//     기록의 이름이 바뀌면 따라 바뀌고, 기록을 지우면 예시에서도 빠진다. 벡터만 IndexedDB에 따로 둔다.
//  ② 기본 분류기(VISION_HEAD_URL): AI Hub 한식 사진으로 미리 학습해 둔 표(tools/train_food_vision.py).
//     AI Hub 이용정책상 한국지능정보사회진흥원의 사업결과임을 밝혀야 해서 동의 화면에 출처를 적는다.
// 확실할 때만 바로 넣고(자동 입력), 애매하면 후보 3개를 보여준다. 기준값은 시험 사진으로 정했다(아래 VISION).
const VISION_LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/dist/transformers.min.js';
const VISION_MODEL = 'onnx-community/dinov2-small';
const VISION_HEAD_URL = self.VISION_HEAD_URL ?? 'food-vision.json';   // 테스트는 data: URL을 심거나 ''로 끈다
const VISION_DB = 'fitness-log-vision';
const VISION_STORE = 'vectors';
const VISION = {
  // 내 사진끼리 견줄 때 (코사인 유사도). 음식 사진은 서로 비슷해서 그대로 견주면 처음 보는 음식도 높게 나온다.
  // 사진이 20장 넘게 모이면 평균을 빼고 견준다 — 같은 정확도(95%)에서 자동으로 넣는 비율이 9% → 33%로 올랐다.
  minForMean: 20,
  centered: { auto: 0.6, gap: 0.12, cand: 0.15 },
  raw: { auto: 0.85, gap: 0.1, cand: 0.5 },
  // 기본 분류기 확률. 0.6 이상만 자동으로 넣으면 시험 사진에서 78%가 자동, 그중 96%가 맞았다.
  headAuto: 0.6,
  headCand: 0.05,
  backlog: 30,          // 한 번에 배우는 지난 사진 수 (모델을 처음 받았을 때 이전 사진들)
};

// ---------- 벡터 저장소 (IndexedDB) ----------
let visionDbPromise = null;
function visionDb() {
  visionDbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(VISION_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(VISION_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return visionDbPromise;
}
// photoTx와 같은 이유로 콜백 안의 예외를 꼭 잡는다
async function visionTx(mode, fn) {
  const db = await visionDb();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(VISION_STORE, mode);
      const out = fn(tx.objectStore(VISION_STORE));
      tx.oncomplete = () => resolve(out?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    } catch (err) {
      reject(err);
    }
  });
}
async function putVector(photoId, v) {
  await visionTx('readwrite', (st) => st.put({ m: VISION_MODEL, v }, photoId));
}
async function dropVector(photoId) {
  try { await visionTx('readwrite', (st) => st.delete(photoId)); } catch { /* 없으면 그만 */ }
}
// 지금 모델로 만든 벡터만 (모델을 바꾸면 옛 벡터는 견줄 수 없다)
async function allVectors() {
  const out = new Map();
  try {
    const db = await visionDb();
    await new Promise((resolve, reject) => {
      try {
        const req = db.transaction(VISION_STORE).objectStore(VISION_STORE).openCursor();
        req.onsuccess = () => {
          const c = req.result;
          if (!c) return resolve();
          if (c.value?.m === VISION_MODEL && c.value.v?.length) out.set(c.key, Float32Array.from(c.value.v));
          c.continue();
        };
        req.onerror = () => reject(req.error);
      } catch (err) { reject(err); }
    });
  } catch { /* IndexedDB를 못 쓰면 내 사진 없이 */ }
  return out;
}

// ---------- 모델 ----------
let visionEngine = null;
let visionLoading = null;
let visionProgress = null;   // (0~1) => void, 받는 중 화면에 퍼센트를 띄운다

// [CLS] 벡터 + 나머지 조각 평균을 이어 붙인다 (DINOv2를 분류에 쓸 때의 표준 방식, 384+384)
function poolDino(h) {
  const [, n, d] = h.dims;
  const a = h.data;
  const v = new Float32Array(2 * d);
  for (let k = 0; k < d; k++) v[k] = a[k];
  for (let t = 1; t < n; t++) for (let k = 0; k < d; k++) v[d + k] += a[t * d + k] / (n - 1);
  return v;
}
function loadVision() {
  if (visionEngine) return Promise.resolve(visionEngine);
  visionLoading ??= (async () => {
    if (self.FAKE_VISION) return (visionEngine = self.FAKE_VISION);   // 테스트는 가짜 엔진을 심는다
    const T = await import(VISION_LIB);
    const files = new Map();
    const progress_callback = (p) => {
      if (p.status !== 'progress' || !p.total) return;
      files.set(p.file, [p.loaded, p.total]);
      let got = 0, all = 0;
      files.forEach(([g, a]) => { got += g; all += a; });
      visionProgress?.(got / all);
    };
    const proc = await T.AutoProcessor.from_pretrained(VISION_MODEL, { progress_callback });
    const model = await T.AutoModel.from_pretrained(VISION_MODEL, { dtype: 'q8', progress_callback });
    // 한 모델을 동시에 여러 번 돌리면 실패할 수 있어서 한 장씩 차례로 (사진을 연달아 넣을 때)
    let queue = Promise.resolve();
    visionEngine = {
      embed(blob) {
        const run = queue.then(async () => {
          const out = await model(await proc(await T.RawImage.fromBlob(blob)));
          return poolDino(out.last_hidden_state);
        });
        queue = run.catch(() => {});
        return run;
      },
    };
    return visionEngine;
  })().catch((err) => { visionLoading = null; throw err; });
  return visionLoading;
}
async function photoVector(photoId) {
  const blob = await photoTx('readonly', (st) => st.get(photoId));
  if (!blob) return null;
  const v = await (await loadVision()).embed(blob);
  await putVector(photoId, v);
  return v;
}

// 기본 분류기: { model, labels: [음식 이름], dim, mean: [dim], W: base64 Float32(labels×dim), b: [labels], scale }
let visionHead;   // undefined = 아직 안 읽음, null = 없음
async function loadHead() {
  if (visionHead !== undefined) return visionHead;
  visionHead = null;
  if (!VISION_HEAD_URL) return null;
  try {
    const h = await (await fetch(VISION_HEAD_URL)).json();
    if (h.model !== VISION_MODEL || !Array.isArray(h.labels)) return null;
    const raw = Uint8Array.from(atob(h.W), (c) => c.charCodeAt(0));
    const W = new Float32Array(raw.buffer);
    if (W.length !== h.labels.length * h.dim) return null;
    visionHead = { ...h, W, mean: Float32Array.from(h.mean || []) };
  } catch { /* 못 읽으면 내 사진만으로 */ }
  return visionHead;
}

// ---------- 견주기 ----------
function unit(v, mean) {
  const out = Float32Array.from(v);
  if (mean?.length === out.length) for (let i = 0; i < out.length; i++) out[i] -= mean[i];
  let s = 0;
  for (let i = 0; i < out.length; i++) s += out[i] * out[i];
  s = Math.sqrt(s) || 1;
  for (let i = 0; i < out.length; i++) out[i] /= s;
  return out;
}
function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

// 식단 기록에서 "사진 → 이름"을 모은다. 같은 사진이 여러 번이면 나중 기록의 이름.
function labeledPhotos() {
  const byPhoto = new Map();
  Object.keys(state.days).sort().forEach((date) => (state.days[date].meals || []).forEach((m) => {
    if (m.photo && foodName(m.name)) byPhoto.set(m.photo, String(m.name).trim());
  }));
  return byPhoto;
}

// 사진 벡터 v → { auto: 이름|null, cands: [이름…] (최대 3) }
// examples: [{ name, v }] (내 사진), head: 기본 분류기. skip: 빼고 볼 이름(방금 틀렸다고 한 것)
function rankFoods(v, examples, head, skip = []) {
  const skipKeys = new Set(skip.map(foodName));
  const mine = [];   // [{ name, key, score }] 이름마다 가장 닮은 사진 하나
  let mineAuto = null;
  const use = examples.filter((e) => !skipKeys.has(foodName(e.name)));
  if (use.length) {
    let mean = null;
    if (examples.length >= VISION.minForMean) {
      mean = new Float32Array(v.length);
      examples.forEach((e) => e.v.forEach((x, i) => { mean[i] += x / examples.length; }));
    }
    const th = mean ? VISION.centered : VISION.raw;
    const q = unit(v, mean);
    const best = new Map();
    use.forEach((e) => {
      const key = foodName(e.name);
      const s = dot(q, unit(e.v, mean));
      if (!best.has(key) || s > best.get(key).score) best.set(key, { name: e.name, key, score: s });
    });
    mine.push(...[...best.values()].sort((a, b) => b.score - a.score));
    const [t1, t2] = mine;
    if (t1.score >= th.auto && t1.score - (t2?.score ?? 0) >= th.gap) mineAuto = t1.name;
    for (let i = mine.length - 1; i >= 0; i--) if (mine[i].score < th.cand) mine.splice(i, 1);
  }
  const base = [];
  if (head) {
    const q = unit(v, head.mean);
    const logits = head.labels.map((_, c) => head.scale * dot(q, head.W.subarray(c * head.dim, (c + 1) * head.dim)) + (head.b[c] || 0));
    const mx = Math.max(...logits);
    const ex = logits.map((z) => Math.exp(z - mx));
    const sum = ex.reduce((a, b) => a + b, 0);
    head.labels.forEach((name, c) => { if (!skipKeys.has(foodName(name))) base.push({ name, key: foodName(name), p: ex[c] / sum }); });
    base.sort((a, b) => b.p - a.p);
  }
  // 내 사진이 확실하면 그게 먼저다 (내가 먹는 음식은 내 사진이 제일 잘 안다)
  let auto = mineAuto;
  if (!auto && base[0]?.p >= VISION.headAuto) {
    // 내 사진이 다른 음식을 꽤 닮았다고 하면 자동으로 넣지 않는다
    const rival = mine[0] && mine[0].key !== base[0].key && mine[0].score >= (examples.length >= VISION.minForMean ? VISION.centered : VISION.raw).auto;
    if (!rival) auto = base[0].name;
  }
  const cands = [];
  const seen = new Set();
  const add = (name) => {
    const key = foodName(name);
    if (!seen.has(key) && cands.length < 3) { seen.add(key); cands.push(name); }
  };
  if (auto) add(auto);
  for (let i = 0; i < 3; i++) {
    if (mine[i]) add(mine[i].name);
    if (base[i] && base[i].p >= VISION.headCand) add(base[i].name);
  }
  return { auto, cands };
}

async function recognize(photoId, skip = []) {
  const v = (await allVectors()).get(photoId) ?? await photoVector(photoId);
  if (!v) return { auto: null, cands: [] };
  const vecs = await allVectors();
  const examples = [];
  labeledPhotos().forEach((name, id) => {
    if (id !== photoId && vecs.has(id)) examples.push({ name, v: vecs.get(id) });
  });
  return rankFoods(v, examples, await loadHead(), skip);
}

// 모델을 처음 받았거나 다른 기기에서 사진을 가져왔으면, 이름이 붙은 지난 사진들도 배운다
let backlogRunning = false;
async function learnBacklog() {
  if (backlogRunning || !visionEngine) return;
  backlogRunning = true;
  try {
    const have = await allVectors();
    const todo = [...labeledPhotos().keys()].filter((id) => !have.has(id)).slice(-VISION.backlog);
    for (const id of todo) {
      try { await photoVector(id); } catch { /* 이 기기에 없는 사진 */ }
    }
  } finally {
    backlogRunning = false;
  }
}
// 식단에 사진이 붙어 저장되면 그 사진을 배운다 (모델을 켜 둔 기기에서만)
function learnPhoto(photoId) {
  if (!photoId || !visionOn()) return;
  loadVision().then(async () => {
    if (!(await allVectors()).has(photoId)) await photoVector(photoId);
  }).catch(() => { /* 다음에 learnBacklog가 채운다 */ });
}

// ---------- 화면 ----------
// 상태: ask(처음 동의) · loading · done(자동으로 넣음) · pick(후보) · new(모르는 음식) · error
let visionState = null;   // { mode, photo, meal?, cands?, pct?, skip? }
function visionOn() { return readUi().vision === 'on'; }

function usualAmount(name) {
  // 그 음식을 마지막으로 먹은 양 (늘 먹던 양이 1인분보다 정확하다)
  const key = foodName(name);
  const dates = Object.keys(state.days).sort().reverse();
  for (const d of dates) {
    const m = [...state.days[d].meals].reverse().find((x) => foodName(x.name) === key && x.amount);
    if (m) return m;
  }
  return null;
}
function mealFromPhoto(name, photo) {
  const last = usualAmount(name);
  const amount = last?.amount || '1인분';
  const est = estimateKcal(name, amount);
  return {
    id: uid(), type: $('#mealType').value, name, amount,
    kcal: est ? est.kcal : (last?.kcal ?? null),
    protein: est ? est.protein : (last?.protein ?? null),
    photo,
  };
}

function renderVision() {
  const box = $('#visionBox');
  const s = visionState;
  box.hidden = !s;
  if (!s) { box.innerHTML = ''; return; }
  const chips = (list) => `<div class="chips">${list.map((n, i) => `<button type="button" class="chip" data-vision-pick="${i}">${esc(n)}</button>`).join('')}</div>`;
  if (s.mode === 'ask') {
    box.innerHTML = `<p><strong>📷 사진으로 음식을 알아볼까요?</strong></p>
      <p class="hint">처음 한 번 AI 모델(약 50MB)을 받아요. 와이파이에서 받는 걸 권해요. 사진은 이 기기 밖으로 나가지 않아요.</p>
      ${VISION_HEAD_URL ? '<p class="hint">기본 음식 분류는 한국지능정보사회진흥원의 사업결과인 AI 허브 「한국 이미지(음식)」 데이터로 학습했어요.</p>' : ''}
      <div class="vision-btns"><button type="button" class="primary" data-vision="on">받고 알아보기</button>
      <button type="button" data-vision="skip">직접 적을게요</button></div>`;
  } else if (s.mode === 'loading') {
    box.innerHTML = `<p>🤖 ${s.pct != null ? `AI 모델 받는 중… ${Math.round(s.pct * 100)}%` : '사진 보는 중…'}</p>`;
  } else if (s.mode === 'done') {
    const m = s.meal;
    box.innerHTML = `<p>✅ <strong>${esc(m.name)}</strong>(으)로 넣었어요 <span class="muted">${esc(m.amount)}${m.kcal ? ` · ${m.kcal} kcal` : ''}</span></p>
      <div class="vision-btns"><button type="button" data-vision="wrong">다른 음식이에요</button>
      <button type="button" data-vision="close">확인</button></div>`;
  } else if (s.mode === 'pick') {
    box.innerHTML = `<p><strong>🤔 어떤 음식인가요?</strong> <span class="hint">누르면 바로 넣어요</span></p>${chips(s.cands)}
      <p class="hint">목록에 없으면 이름을 적어 추가해 주세요. 다음부터 이 사진으로 알아봐요.</p>`;
  } else if (s.mode === 'new') {
    box.innerHTML = `<p><strong>📝 아직 모르는 음식이에요.</strong></p>
      <p class="hint">이름을 적어 추가하면 다음부터 이 사진으로 알아봐요.</p>`;
  } else if (s.mode === 'error') {
    box.innerHTML = `<p>⚠️ AI를 불러오지 못했어요. 인터넷 연결을 확인하거나 이름을 직접 적어 주세요.</p>`;
  }
}
function setVision(next) {
  visionState = next;
  renderVision();
}

// 폼에서 사진을 골랐는데 음식 이름이 비어 있으면 알아본다
async function visionStart(photoId) {
  if (!visionOn()) return setVision({ mode: 'ask', photo: photoId });
  setVision({ mode: 'loading', photo: photoId, pct: visionEngine ? null : 0 });
  visionProgress = (pct) => {
    if (visionState?.mode === 'loading' && visionState.photo === photoId) setVision({ ...visionState, pct: pct >= 1 ? null : pct });
  };
  let res;
  try {
    await loadVision();
    if (visionState?.photo !== photoId) return;
    setVision({ mode: 'loading', photo: photoId, pct: null });
    res = await recognize(photoId);
  } catch {
    if (visionState?.photo === photoId) setVision({ mode: 'error', photo: photoId });
    return;
  }
  if (visionState?.photo !== photoId || pendingPhoto !== photoId) return;   // 그사이 다른 사진을 골랐다
  learnBacklog();
  if (res.auto && !$('#foodName').value.trim()) {
    const meal = mealFromPhoto(res.auto, photoId);
    day().meals.push(meal);
    save();
    resetMealForm();
    render();
    setVision({ mode: 'done', photo: photoId, meal, cands: res.cands });
  } else if (res.cands.length) {
    setVision({ mode: 'pick', photo: photoId, cands: res.cands });
  } else {
    setVision({ mode: 'new', photo: photoId });
    $('#foodName').focus();
  }
}

// 후보를 고르면 그 이름으로 바로 넣는다 (양·칼로리는 늘 먹던 양 → 1인분)
function visionPick(name) {
  const photo = visionState?.photo;
  if (!photo || pendingPhoto !== photo) return;
  const meal = mealFromPhoto(name, photo);
  day().meals.push(meal);
  save();
  resetMealForm();
  render();
  setVision({ mode: 'done', photo, meal, cands: visionState.cands });
}

// 자동으로 넣은 게 틀렸다: 그 기록을 빼고 사진은 폼에 다시 붙인 뒤 다른 후보를 보여준다
async function visionWrong() {
  const s = visionState;
  if (s?.mode !== 'done') return;
  const date = Object.keys(state.days).find((d) => state.days[d].meals.some((m) => m.id === s.meal.id));
  if (date) {
    state.days[date].meals = state.days[date].meals.filter((m) => m.id !== s.meal.id);
    markDeleted(s.meal.id, date);
    save();
    render();
  }
  if (pendingPhoto && pendingPhoto !== s.photo) await deletePhoto(pendingPhoto);
  pendingPhoto = s.photo;
  $('#photoName').textContent = '✓ 첨부됨';
  const skip = [...(s.skip || []), s.meal.name];
  let cands = [];
  try { cands = (await recognize(s.photo, skip)).cands; } catch { /* 후보 없이 이름만 적게 */ }
  setVision(cands.length ? { mode: 'pick', photo: s.photo, cands, skip } : { mode: 'new', photo: s.photo, skip });
  if (!cands.length) $('#foodName').focus();
}

$('#visionBox').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || !visionState) return;
  const { vision, visionPick: pick } = b.dataset;
  if (pick != null) visionPick(visionState.cands[Number(pick)]);
  else if (vision === 'on') { saveUi({ vision: 'on' }); visionStart(visionState.photo); }
  else if (vision === 'skip') { setVision(null); $('#foodName').focus(); }
  else if (vision === 'wrong') visionWrong();
  else if (vision === 'close') setVision(null);
});
