/**
 * 식단·운동 기록 앱 → 구글 드라이브 (Claude 연결)
 *
 * 앱이 기록을 고칠 때마다 이 스크립트로 보내면, 내 드라이브의 'fitness-log' 폴더에
 *   - 운동 기록 (fitness-log)   Claude가 읽기 좋은 정리 (구글 문서)
 *   - fitness-log.json          앱 기록 전체 (백업 — 앱의 '가져오기'로 되살릴 수 있다)
 * 를 덮어써 둔다. Claude(claude.ai)에 구글 드라이브를 연결해 두면 "드라이브의 운동 기록 읽어줘"로 바로 읽는다.
 *
 * 만드는 법 (PC에서 하면 편하다)
 *   1. script.google.com → 새 프로젝트 → 원래 있던 코드를 지우고 이 파일 전체를 붙여넣기 → 저장
 *   2. 배포 → 새 배포 → 톱니바퀴에서 '웹 앱' → 실행: 나 / 액세스 권한: 모든 사용자 → 배포
 *   3. 권한 허용 ('확인되지 않은 앱' 화면이 나오면 고급 → 이동 — 내가 만든 스크립트라 그렇다)
 *   4. 나온 '웹 앱 URL'(…/exec)을 앱 기록 탭 '🤖 Claude 연결'에 붙여넣고 비밀번호를 정한다
 *
 * 비밀번호는 처음 저장할 때 이 스크립트가 기억하고, 그 뒤로는 같은 비밀번호만 받는다
 * (주소를 누가 알아도 못 쓰게). 다른 기기에서도 같은 주소·비밀번호를 넣으면 된다.
 * 비밀번호를 잊었으면 위 메뉴에서 resetPassword를 골라 한 번 실행한 뒤 다시 연결한다.
 */
const FOLDER_NAME = 'fitness-log';
const DOC_NAME = '운동 기록 (fitness-log)';
const JSON_NAME = 'fitness-log.json';

function doPost(e) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return reply({ ok: false, error: 'busy' });   // 두 기기가 동시에 보내면 파일이 둘 생긴다
  try {
    let req;
    try {
      req = JSON.parse(e.postData.contents);
    } catch (err) {
      return reply({ ok: false, error: 'format' });
    }
    if (!req || typeof req.key !== 'string' || req.key.length < 4) return reply({ ok: false, error: 'key' });
    const props = PropertiesService.getScriptProperties();
    const saved = props.getProperty('KEY');
    if (!saved) props.setProperty('KEY', req.key);          // 처음 보낸 비밀번호를 기억한다
    else if (saved !== req.key) return reply({ ok: false, error: 'key' });
    const folder = folderOf();
    const out = { ok: true, at: Date.now() };
    if (typeof req.text === 'string') out.docUrl = writeDoc(folder, req.text);
    if (typeof req.json === 'string') out.fileUrl = writeFile(folder, req.json);
    return reply(out);
  } finally {
    lock.releaseLock();
  }
}

// 주소가 맞는지 브라우저로 열어 볼 때 (기록은 돌려주지 않는다)
function doGet() {
  return reply({ ok: true, app: 'fitness-log' });
}

function folderOf() {
  const it = DriveApp.getFoldersByName(FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
}

function writeDoc(folder, text) {
  const it = folder.getFilesByName(DOC_NAME);
  let doc;
  if (it.hasNext()) {
    doc = DocumentApp.openById(it.next().getId());
  } else {
    doc = DocumentApp.create(DOC_NAME);
    DriveApp.getFileById(doc.getId()).moveTo(folder);
  }
  const body = doc.getBody();
  body.setText(text);
  // '#'으로 시작하는 줄은 제목으로 (문서 앱에서 볼 때 목차가 생긴다)
  const heads = [DocumentApp.ParagraphHeading.HEADING1, DocumentApp.ParagraphHeading.HEADING2, DocumentApp.ParagraphHeading.HEADING3];
  body.getParagraphs().forEach((p) => {
    const m = /^(#{1,3}) (.*)$/.exec(p.getText());
    if (!m) return;
    p.setText(m[2]);
    p.setHeading(heads[m[1].length - 1]);
  });
  doc.saveAndClose();
  return doc.getUrl();
}

function writeFile(folder, content) {
  const it = folder.getFilesByName(JSON_NAME);
  const file = it.hasNext() ? it.next() : folder.createFile(JSON_NAME, '', 'application/json');
  file.setContent(content);
  return file.getUrl();
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function resetPassword() {
  PropertiesService.getScriptProperties().deleteProperty('KEY');
}
