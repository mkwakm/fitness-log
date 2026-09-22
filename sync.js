// 기기 간 동기화. 서버가 없어서 파일을 주고받는 방식이 기본이다.
//  ① 파일 자동 저장 — 클라우드 드라이브 폴더의 파일 하나에 자동으로 써 둔다 (PC, 토큰 불필요)
//  ② 휴대폰은 내보내기/공유 → 드라이브에 올리고, 가져오기로 합친다 (토큰 불필요)
//  ③ GitHub Gist — 토큰이 필요해서 기본에서 내렸다. 자동 동기화를 원할 때만 쓴다.
// 셋 다 아래 mergeState()로 항목 단위 병합을 한다.
//
// ⚠️ 토큰은 state가 아니라 별도 키(SYNC_KEY)에 둔다. 백업 JSON 내보내기에 절대 섞이지 않게 하기 위함.
const SYNC_KEY = 'fitness-log-sync';
const GIST_FILE = 'fitness-log.json';
const AUTO_SAVE_DELAY = 2000;

let sync = { token: '', gistId: '', lastGist: 0, lastFile: 0 };
let fileHandle = null;
let autoSaveTimer = null;
let syncMsg = '';
let advOpen = false;      // 'GitHub Gist' 섹션을 펼쳐 뒀는지 (다시 그려도 유지)

function loadSync() {
  try {
    sync = { ...sync, ...(JSON.parse(localStorage.getItem(SYNC_KEY)) || {}) };
  } catch { /* 값이 깨졌으면 기본값으로 */ }
}
function saveSync() {
  localStorage.setItem(SYNC_KEY, JSON.stringify(sync));
}

// ---------- 병합 ----------
// 날짜 통째로 덮으면 "집 PC에서 점심, 휴대폰에서 저녁"을 적었을 때 한쪽이 사라진다.
// 그래서 식단·운동은 id 기준으로 합치고, 지운 항목은 day.deleted에 남겨 삭제도 따라가게 한다.
function mergeList(mine, theirs, theirsNewer, deleted) {
  const map = new Map(mine.map((x) => [x.id, x]));
  theirs.forEach((x) => {
    if (!map.has(x.id) || theirsNewer) map.set(x.id, x);   // 없던 건 추가, 겹치면 최근 쪽
  });
  return [...map.values()].filter((x) => !deleted.has(x.id));
}

function mergeDay(mine, theirs) {
  const deleted = new Set([...(mine.deleted || []), ...(theirs.deleted || [])]);
  const theirsNewer = (theirs.updatedAt || 0) > (mine.updatedAt || 0);
  const newer = theirsNewer ? theirs : mine;
  return {
    ...mine,
    ...newer,                       // note·체중처럼 값이 하나뿐인 건 최근에 고친 쪽
    meals: mergeList(mine.meals || [], theirs.meals || [], theirsNewer, deleted),
    workouts: mergeList(mine.workouts || [], theirs.workouts || [], theirsNewer, deleted),
    deleted: [...deleted],
    updatedAt: Math.max(mine.updatedAt || 0, theirs.updatedAt || 0),
  };
}

function mergeState(remote) {
  if (!remote || typeof remote !== 'object' || !remote.days) throw new Error('형식 오류');
  let changed = 0;
  for (const [date, rd] of Object.entries(remote.days)) {
    if (!rd || typeof rd !== 'object') continue;
    const mine = state.days[date];
    if (!mine) {
      state.days[date] = { meals: [], workouts: [], note: '', ...rd };
      changed += 1;
      continue;
    }
    const before = JSON.stringify(mine);
    const merged = mergeDay(mine, rd);
    if (JSON.stringify(merged) !== before) {
      state.days[date] = merged;
      changed += 1;
    }
  }
  if ((remote.profile?.updatedAt || 0) > (state.profile.updatedAt || 0)) {
    state.profile = { ...DEFAULT_PROFILE, ...remote.profile };
  }
  return changed;
}

function afterMerge(changed, where) {
  save();
  seedStamps();
  applyTheme();
  render();
  toastSync(changed ? `${where}에서 ${changed}일치를 가져왔어요.` : `${where}와 이미 같아요.`);
}
function toastSync(msg) {
  syncMsg = msg;
  renderSync();
  setTimeout(() => { if (syncMsg === msg) { syncMsg = ''; renderSync(); } }, 6000);
}

// ---------- ① GitHub Gist ----------
async function gistFetch(path, options = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${sync.token}`,
      Accept: 'application/vnd.github+json',
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) throw new Error('토큰이 잘못됐거나 만료됐어요.');
  if (res.status === 404) throw new Error('Gist를 찾을 수 없어요. 연결을 해제하고 다시 연결해 주세요.');
  if (!res.ok) throw new Error(`GitHub 오류 (${res.status})`);
  return res.json();
}

async function gistPush() {
  const body = { files: { [GIST_FILE]: { content: JSON.stringify(state) } } };
  if (sync.gistId) {
    await gistFetch(`/gists/${sync.gistId}`, { method: 'PATCH', body: JSON.stringify(body) });
  } else {
    const made = await gistFetch('/gists', {
      method: 'POST',
      body: JSON.stringify({ ...body, description: '식단·운동 기록 백업', public: false }),
    });
    sync.gistId = made.id;
  }
  sync.lastGist = Date.now();
  saveSync();
}

async function gistPull() {
  if (!sync.gistId) return 0;
  const g = await gistFetch(`/gists/${sync.gistId}`);
  const f = g.files?.[GIST_FILE];
  if (!f) throw new Error('Gist에 기록 파일이 없어요.');
  // 큰 파일은 내용이 잘려 오므로 raw_url로 다시 받는다
  const text = f.truncated ? await (await fetch(f.raw_url)).text() : f.content;
  return mergeState(JSON.parse(text));
}

// 내려받아 합치고 → 다시 올린다. 양쪽 기기가 각각 눌러도 결국 같아진다.
async function gistSync() {
  if (!sync.token) return;
  setSyncBusy(true);
  try {
    const changed = await gistPull();
    await gistPush();
    afterMerge(changed, 'GitHub');
  } catch (err) {
    toastSync(`⚠️ ${err.message}`);
  } finally {
    setSyncBusy(false);
  }
}

async function connectGist() {
  const token = prompt(
    'GitHub 개인 토큰을 붙여넣으세요.\n\n' +
    'github.com → Settings → Developer settings → Personal access tokens\n' +
    '→ Tokens (classic) → Generate new token → gist 권한만 체크\n\n' +
    '※ 토큰은 이 기기 브라우저에만 저장되고, 백업 JSON에는 들어가지 않아요.'
  );
  if (!token) return;
  sync.token = token.trim();
  saveSync();
  // 다른 기기에서 이미 만들어 둔 Gist가 있으면 그걸 쓴다
  if (!sync.gistId) {
    try {
      const list = await gistFetch('/gists?per_page=100');
      const found = list.find((g) => g.files?.[GIST_FILE]);
      if (found) sync.gistId = found.id;
      saveSync();
    } catch (err) {
      toastSync(`⚠️ ${err.message}`);
      return;
    }
  }
  gistSync();
}

function disconnectGist() {
  if (!confirm('이 기기에서 GitHub 연결을 끊을까요?\n(Gist에 올라간 기록은 그대로 남습니다)')) return;
  sync = { ...sync, token: '', gistId: '', lastGist: 0 };
  saveSync();
  toastSync('연결을 해제했어요.');
}

// ---------- ② 파일 자동 저장 ----------
const canUseFile = () => typeof window !== 'undefined' && 'showSaveFilePicker' in window;

// 파일 핸들은 JSON으로 저장할 수 없어서 IndexedDB에 넣는다.
function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('fitness-log-sync', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('handles');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      // 여기서 난 예외는 이벤트 핸들러 밖으로 새어나가 promise가 영영 안 끝난다. 꼭 잡아서 reject.
      try {
        const tx = req.result.transaction('handles', mode);
        const out = fn(tx.objectStore('handles'));
        tx.oncomplete = () => resolve(out?.result);
        tx.onerror = () => reject(tx.error);
      } catch (err) {
        reject(err);
      }
    };
  });
}

async function pickSyncFile() {
  let handle;
  try {
    handle = await window.showSaveFilePicker({
      suggestedName: 'fitness-log.json',
      types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
    });
  } catch {
    return;                       // 사용자가 취소한 경우 — 아무 말 없이 돌아간다
  }
  fileHandle = handle;
  let remembered = true;
  try {
    await idb('readwrite', (st) => st.put(handle, 'file'));
  } catch {
    remembered = false;           // 시크릿 창 등에서 IndexedDB를 못 쓰는 경우
  }
  // 다른 기기에서 쓰던 파일을 고른 경우가 있으니, 덮어쓰기 전에 먼저 읽어서 합친다.
  await readSyncFile({ quiet: true });
  await writeSyncFile();
  if (!syncMsg) {
    toastSync(remembered
      ? '이제 기록이 이 파일에 자동 저장돼요.'
      : '⚠️ 이 창에서는 자동 저장되지만, 브라우저를 닫으면 파일을 다시 지정해야 해요.');
  }
  renderSync();
}

async function writeSyncFile() {
  if (!fileHandle) return;
  try {
    if ((await fileHandle.queryPermission?.({ mode: 'readwrite' })) === 'denied') return;
    const w = await fileHandle.createWritable();
    await w.write(JSON.stringify(state, null, 2));
    await w.close();
    sync.lastFile = Date.now();
    saveSync();
  } catch { /* 드라이브가 잠깐 잠겨 있을 수 있다. 다음 저장 때 다시 쓴다 */ }
}

function scheduleAutoSave() {
  if (!fileHandle) return;
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(writeSyncFile, AUTO_SAVE_DELAY);
}

async function readSyncFile({ quiet = false } = {}) {
  if (!fileHandle) return;
  try {
    if ((await fileHandle.requestPermission?.({ mode: 'readwrite' })) === 'denied') {
      if (!quiet) toastSync('⚠️ 파일 권한이 없어요.');
      return;
    }
    const text = await (await fileHandle.getFile()).text();
    if (!text.trim()) return;
    const changed = mergeState(JSON.parse(text));
    if (changed || !quiet) afterMerge(changed, '파일');
  } catch (err) {
    if (!quiet) toastSync(`⚠️ 파일을 읽지 못했어요. ${err.message}`);
  }
}

async function forgetSyncFile() {
  if (!confirm('파일 자동 저장을 끌까요?\n(이미 저장된 파일은 그대로 남습니다)')) return;
  fileHandle = null;
  await idb('readwrite', (st) => st.delete('file'));
  sync.lastFile = 0;
  saveSync();
  toastSync('자동 저장을 껐어요.');
  renderSync();
}

// ---------- ③ 휴대폰: 파일로 내보내 공유 ----------
function backupFile() {
  return new File([JSON.stringify(state, null, 2)], 'fitness-log.json', { type: 'application/json' });
}
const canShare = () => typeof navigator !== 'undefined'
  && !!navigator.canShare?.({ files: [new File([''], 'x.json', { type: 'application/json' })] });

async function shareBackup() {
  try {
    await navigator.share({ files: [backupFile()], title: '식단·운동 기록' });
  } catch { /* 사용자가 취소했거나 공유할 앱이 없는 경우 */ }
}

// ---------- 화면 ----------
function fmtAgo(ts) {
  if (!ts) return '아직 없음';
  const min = Math.floor((Date.now() - ts) / 60000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  if (min < 1440) return `${Math.floor(min / 60)}시간 전`;
  return `${Math.floor(min / 1440)}일 전`;
}
function setSyncBusy(on) {
  const btn = document.querySelector('#gistSyncBtn');
  if (btn) { btn.disabled = on; btn.textContent = on ? '동기화 중…' : '지금 동기화'; }
}

function renderSync() {
  const el = document.querySelector('#syncCard');
  if (!el) return;
  el.innerHTML = `
    <h3>🔄 다른 기기와 동기화</h3>
    ${syncMsg ? `<p class="sync-msg">${esc(syncMsg)}</p>` : ''}
    <p class="hint">기록은 기기마다 따로 저장돼요. 아래 방법으로 맞출 수 있고, <b>어느 쪽이든 합칠 때 기록이 사라지지 않아요.</b>
      같은 날에 이 PC에서 점심을, 휴대폰에서 저녁을 적었어도 둘 다 남습니다.</p>

    <div class="sync-row">
      <div>
        <strong>💻 PC · 파일 자동 저장 <span class="tag">토큰 없음</span></strong>
        <p class="hint">${canUseFile()
          ? `OneDrive·구글드라이브 폴더에 파일을 한 번 지정해 두면 이후 자동으로 저장돼요.
             다른 PC에서 같은 파일을 지정하면 합쳐집니다.<br>
             ${fileHandle ? `마지막 저장: ${fmtAgo(sync.lastFile)}` : '아직 지정 안 함'}`
          : '이 브라우저는 지원하지 않아요. 아래 휴대폰 방법을 쓰거나 크롬·엣지 PC에서 열어 주세요.'}</p>
      </div>
      <div class="sync-btns">
        ${!canUseFile() ? ''
          : fileHandle
            ? `<button id="fileReadBtn" class="primary">파일에서 불러오기</button>
               <button id="fileOffBtn">끄기</button>`
            : '<button id="filePickBtn" class="primary">파일 지정</button>'}
      </div>
    </div>

    <div class="sync-row">
      <div>
        <strong>📱 휴대폰 <span class="tag">토큰 없음</span></strong>
        <p class="hint">휴대폰은 브라우저 제약으로 자동 저장이 안 돼요.
          ${canShare() ? '<b>내보내 공유</b>를 눌러 드라이브 앱에 저장하고' : '아래 <b>내보내기</b>로 파일을 드라이브에 올리고'},
          다른 기기에선 <b>가져오기</b>로 그 파일을 고르면 합쳐집니다.</p>
      </div>
      <div class="sync-btns">
        ${canShare() ? '<button id="shareBtn" class="primary">내보내 공유</button>' : ''}
        <button id="jumpBackup">내보내기 / 가져오기</button>
      </div>
    </div>

    <details class="sync-adv"${advOpen ? ' open' : ''}>
      <summary>자동으로 맞추고 싶다면 — GitHub Gist <span class="tag warn">토큰 필요</span></summary>
      <div class="sync-row">
        <div>
          <p class="hint">휴대폰까지 자동으로 맞출 수 있는 유일한 방법이지만, GitHub 개인 토큰을 이 기기 브라우저에 저장해야 해요.
            (<code>gist</code> 권한만 준 토큰을 쓰고, 공용 PC에서는 쓰지 마세요. 토큰은 백업 파일에 들어가지 않아요.)<br>
            ${sync.token ? `마지막 동기화: ${fmtAgo(sync.lastGist)}` : '연결 안 됨'}</p>
        </div>
        <div class="sync-btns">
          ${sync.token
            ? `<button id="gistSyncBtn" class="primary">지금 동기화</button>
               <button id="gistOffBtn">연결 해제</button>`
            : '<button id="gistOnBtn">연결하기</button>'}
        </div>
      </div>
    </details>`;

  // 다시 그릴 때마다 접히지 않도록 펼침 상태를 기억한다
  const adv = el.querySelector('.sync-adv');
  if (adv) adv.addEventListener('toggle', () => { advOpen = adv.open; });
}

// ---------- 시작 ----------
async function initSync() {
  loadSync();
  advOpen = advOpen || !!sync.token;   // 이미 쓰고 있으면 펼쳐 둔다 (사용자가 먼저 펼쳤으면 그대로)
  document.addEventListener('click', (e) => {
    const id = e.target.closest('button')?.id;
    if (id === 'gistOnBtn') connectGist();
    else if (id === 'gistSyncBtn') gistSync();
    else if (id === 'gistOffBtn') disconnectGist();
    else if (id === 'filePickBtn') pickSyncFile();
    else if (id === 'fileReadBtn') readSyncFile();
    else if (id === 'fileOffBtn') forgetSyncFile();
    else if (id === 'shareBtn') shareBackup();
    else if (id === 'jumpBackup') document.querySelector('.card.backup')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  if (canUseFile()) {
    try {
      fileHandle = await idb('readonly', (st) => st.get('file'));
      // 이미 허락받은 상태면 조용히 최신 내용을 가져온다
      if (fileHandle && (await fileHandle.queryPermission?.({ mode: 'readwrite' })) === 'granted') {
        await readSyncFile({ quiet: true });
      }
    } catch { /* 핸들이 없거나 IndexedDB를 못 쓰는 경우 */ }
  }
  renderSync();
  if (sync.token) gistSync();     // 열 때 한 번 맞춰 둔다
}
