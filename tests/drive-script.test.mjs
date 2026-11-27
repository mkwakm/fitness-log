// tools/drive-apps-script.gs (구글 Apps Script)를 가짜 DriveApp·DocumentApp 위에서 돌려 본다.
// 실제 구글에서 돌 코드라 브라우저 테스트로는 못 본다 — 비밀번호 확인·파일을 하나만 두는지·제목 처리.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { ROOT } from './lib.mjs';

function makeEnv() {
  const files = [];
  const folders = [];
  const docs = new Map();
  const props = new Map();
  let n = 0;
  let locked = false;
  const iter = (arr) => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
  const mkFile = (name, content, mime, parent) => {
    const f = {
      id: `f${++n}`, name, content, mime, parent,
      getId() { return this.id; },
      getUrl() { return `https://drive.google.com/file/d/${this.id}/view`; },
      setContent(c) { this.content = c; },
      moveTo(folder) { this.parent = folder.id; },
    };
    files.push(f);
    return f;
  };
  const mkFolder = (name) => {
    const f = {
      id: `d${++n}`, name,
      getFilesByName: (nm) => iter(files.filter((x) => x.parent === f.id && x.name === nm)),
      createFile: (nm, c, mime) => mkFile(nm, c, mime, f.id),
    };
    folders.push(f);
    return f;
  };
  const mkDoc = (file) => {
    const body = {
      paras: [],
      setText(s) { this.paras = s.split('\n').map((x) => ({ text: x, heading: 'NORMAL' })); },
      getParagraphs() { return this.paras.map((p) => ({ getText: () => p.text, setText: (s) => { p.text = s; }, setHeading: (h) => { p.heading = h; } })); },
    };
    const d = { body, saved: 0, getId: () => file.id, getUrl: () => `https://docs.google.com/document/d/${file.id}/edit`, getBody: () => body, saveAndClose() { d.saved += 1; } };
    docs.set(file.id, d);
    return d;
  };
  const env = {
    LockService: { getScriptLock: () => ({ tryLock: () => (locked ? false : (locked = true)), releaseLock: () => { locked = false; } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props.get(k) ?? null, setProperty: (k, v) => props.set(k, v), deleteProperty: (k) => props.delete(k) }) },
    DriveApp: {
      getFoldersByName: (nm) => iter(folders.filter((f) => f.name === nm)),
      createFolder: mkFolder,
      getFileById: (id) => files.find((f) => f.id === id),
    },
    DocumentApp: {
      create: (nm) => mkDoc(mkFile(nm, '', 'doc', null)),
      openById: (id) => docs.get(id),
      ParagraphHeading: { HEADING1: 'H1', HEADING2: 'H2', HEADING3: 'H3' },
    },
    ContentService: { createTextOutput: (s) => ({ s, mime: null, setMimeType(m) { this.mime = m; return this; } }), MimeType: { JSON: 'json' } },
  };
  vm.createContext(env);
  vm.runInContext(readFileSync(join(ROOT, 'tools/drive-apps-script.gs'), 'utf8'), env);
  return { env, files, folders, docs, props, lock: (v) => { locked = v; } };
}

export default async function (t) {
  const g = makeEnv();
  const post = (body) => {
    const r = g.env.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } });
    t.ok(r.mime === 'json', 'JSON으로 답함');
    return JSON.parse(r.s);
  };
  const docFiles = () => g.files.filter((f) => f.name === '운동 기록 (fitness-log)');
  const jsonFiles = () => g.files.filter((f) => f.name === 'fitness-log.json');

  const r1 = post({ key: 'pw-1', text: '# 운동 기록\n첫 줄\n## 요약\n- 가슴\n### 2026-11-25 (수)\n- 벤치', json: '{"days":{}}' });
  t.ok(r1.ok && r1.docUrl.startsWith('https://docs.google.com/'), '처음 저장 → 문서 주소를 돌려줌');
  t.eq(g.folders.map((f) => f.name), ['fitness-log'], 'fitness-log 폴더를 만듦');
  t.eq(docFiles().length, 1, '문서 하나');
  t.eq(docFiles()[0].parent, g.folders[0].id, '문서를 폴더 안으로 옮김');
  const paras = () => g.docs.get(docFiles()[0].id).body.paras;
  t.eq(paras().map((p) => [p.text, p.heading]), [['운동 기록', 'H1'], ['첫 줄', 'NORMAL'], ['요약', 'H2'], ['- 가슴', 'NORMAL'], ['2026-11-25 (수)', 'H3'], ['- 벤치', 'NORMAL']],
    '#·##·### 줄은 제목으로, # 기호는 뗌');
  t.eq(jsonFiles().map((f) => [f.content, f.parent]), [['{"days":{}}', g.folders[0].id]], '기록 파일을 폴더에');
  t.eq(g.props.get('KEY'), 'pw-1', '처음 보낸 비밀번호를 기억');

  const r2 = post({ key: 'pw-1', text: '# 운동 기록\n바뀐 내용', json: '{"days":{"a":1}}' });
  t.ok(r2.ok, '같은 비밀번호로 다시 저장');
  t.eq([g.folders.length, docFiles().length, jsonFiles().length], [1, 1, 1], '폴더·문서·파일을 새로 만들지 않고 덮어씀');
  t.eq(paras().map((p) => p.text), ['운동 기록', '바뀐 내용'], '문서 내용이 바뀜');
  t.eq(jsonFiles()[0].content, '{"days":{"a":1}}', '파일 내용이 바뀜');

  t.eq(post({ key: 'other', text: '# 남의 글', json: '{}' }), { ok: false, error: 'key' }, '비밀번호가 다르면 거절');
  t.eq(paras().map((p) => p.text), ['운동 기록', '바뀐 내용'], '거절하면 안 건드림');
  t.eq(post({ key: 'ab', text: 'x' }).error, 'key', '너무 짧은 비밀번호 거절');
  t.eq(post('이건 JSON이 아님').error, 'format', '형식이 틀리면 거절');
  t.ok(post({ key: 'pw-1', text: '# 운동 기록\n또' }).ok, '거절한 뒤에도 잠금이 풀려 있음');
  t.eq(jsonFiles()[0].content, '{"days":{"a":1}}', 'json 없이 보내면 파일은 그대로');

  g.lock(true);
  t.eq(post({ key: 'pw-1', text: 'x' }).error, 'busy', '다른 기기가 쓰는 중이면 busy');
  g.lock(false);

  g.env.resetPassword();
  t.ok(post({ key: 'new-pass', text: '# 운동 기록' }).ok && g.props.get('KEY') === 'new-pass', 'resetPassword 뒤엔 새 비밀번호를 기억');
  t.eq(JSON.parse(g.env.doGet().s), { ok: true, app: 'fitness-log' }, '주소 확인용 doGet은 기록을 안 돌려줌');
}
