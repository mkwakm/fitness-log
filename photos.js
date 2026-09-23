// 식단 사진 저장소.
// 사진은 localStorage에 못 넣는다(5MB 한도라 몇 장이면 꽉 찬다). IndexedDB에 따로 둔다.
// 그래서 사진은 기기 간 동기화·백업 JSON에 포함되지 않는다 — 기록에는 id만 남는다.
const PHOTO_DB = 'fitness-log-photos';
const PHOTO_STORE = 'photos';
const PHOTO_MAX = 900;          // 긴 변 기준 px
const PHOTO_QUALITY = 0.72;

let photoDbPromise = null;
function photoDb() {
  photoDbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(PHOTO_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(PHOTO_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return photoDbPromise;
}
// idb()와 같은 이유로 콜백 안의 예외를 꼭 잡아야 한다 (안 잡으면 promise가 안 끝난다)
async function photoTx(mode, fn) {
  const db = await photoDb();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(PHOTO_STORE, mode);
      const out = fn(tx.objectStore(PHOTO_STORE));
      tx.oncomplete = () => resolve(out?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    } catch (err) {
      reject(err);
    }
  });
}

// 원본 그대로 두면 한 장에 5MB도 넘는다. 긴 변 900px, JPEG로 줄여서 담는다.
function shrinkPhoto(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, PHOTO_MAX / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('변환 실패'))), 'image/jpeg', PHOTO_QUALITY);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('사진을 읽지 못했어요.')); };
    img.src = url;
  });
}

async function savePhoto(file) {
  const blob = await shrinkPhoto(file);
  const id = uid();
  await photoTx('readwrite', (st) => st.put(blob, id));
  return id;
}
async function getPhotoUrl(id) {
  const blob = await photoTx('readonly', (st) => st.get(id));
  return blob ? URL.createObjectURL(blob) : null;
}
async function deletePhoto(id) {
  try { await photoTx('readwrite', (st) => st.delete(id)); } catch { /* 없으면 그만 */ }
}

// 화면에 붙은 <img data-photo="id">를 실제 사진으로 채운다.
// 만든 URL은 다시 그릴 때 정리해야 메모리가 샌다.
let photoUrls = [];
function releasePhotoUrls() {
  photoUrls.forEach((u) => URL.revokeObjectURL(u));
  photoUrls = [];
}
async function fillPhotos(root = document) {
  releasePhotoUrls();
  for (const img of root.querySelectorAll('img[data-photo]')) {
    try {
      const url = await getPhotoUrl(img.dataset.photo);
      if (url) { photoUrls.push(url); img.src = url; }
      else img.closest('.photo-wrap')?.classList.add('missing');
    } catch { /* 이 기기에 없는 사진 (동기화로 넘어온 기록) */ }
  }
}
