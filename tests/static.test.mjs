// 브라우저 없이 파일만 보고 확인하는 것들
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib.mjs';

export default async function (t) {
  const read = (f) => readFileSync(join(ROOT, f), 'utf8');
  const html = read('index.html'), app = read('app.js'), css = read('style.css'),
    sync = read('sync.js'), photos = read('photos.js'), sw = read('sw.js');

  // $('#id')로 찾는 요소가 index.html에 다 있어야 한다 (오타 하나면 그 기능이 통째로 죽는다)
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  const missing = [...new Set([app, sync, photos].flatMap((s) => [...s.matchAll(/\$\('#([\w-]+)'\)/g)].map((m) => m[1])))]
    .filter((id) => !ids.has(id));
  t.eq(missing, [], "$('#id')로 찾는 요소가 index.html에 다 있음");

  const files = [...sw.match(/const FILES = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  t.eq(files.filter((f) => f !== './' && !existsSync(join(ROOT, f))), [], 'sw.js가 캐시하는 파일이 다 있음');
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  t.ok(scripts.every((f) => files.includes(f)), 'index.html이 읽는 스크립트가 전부 오프라인 캐시에 들어 있음');
  t.ok(scripts.indexOf('sync.js') < scripts.indexOf('app.js'), 'sync.js가 app.js보다 먼저 읽힘');

  const man = JSON.parse(read('manifest.json'));
  t.eq(man.icons.filter((i) => !existsSync(join(ROOT, i.src))).map((i) => i.src), [], 'manifest 아이콘 파일이 다 있음');

  for (const n of [1, 2, 3, 4, 5]) t.ok(css.includes(`--chart-${n}:`), `--chart-${n} 정의됨`);
  const varsOf = (block) => new Set([...block.matchAll(/(--[\w-]+):/g)].map((m) => m[1]));
  const dark = varsOf(css.match(/:root \{([\s\S]*?)\}/)[1]);
  const light = varsOf(css.match(/:root\[data-theme="light"\] \{([\s\S]*?)\}/)[1]);
  t.eq([...dark].filter((v) => !light.has(v)), [], '밝은 테마에 어두운 테마 변수가 다 있음');

  // iOS 사파리는 16px 미만 입력칸을 누르면 화면을 확대한다
  const small = [...css.matchAll(/([^{}]*(?:input|select|textarea)[^{}]*)\{[^}]*font-size:\s*([^;]+);/g)]
    .map((m) => [m[1].trim().split('\n').pop(), m[2].trim()])
    .filter(([, size]) => !((/rem$/.test(size) ? parseFloat(size) * 16 : parseFloat(size)) >= 16));
  t.eq(small, [], '입력칸 글자를 16px 밑으로 내리는 CSS 없음');

  t.ok(/const SYNC_KEY = 'fitness-log-sync'/.test(sync), '토큰은 별도 키(fitness-log-sync)에 둠');
  t.ok(!/state\.\w*token/i.test(app + sync), 'state에 토큰을 넣는 코드 없음');
  t.eq([...(app + sync + photos).matchAll(/console\.(log|debug)\(|debugger\b/g)].map((m) => m[0]), [], '디버그 흔적 없음');
  t.ok(/const CACHE = 'fitness-log-v\d+'/.test(sw), 'sw.js 캐시 이름에 버전이 붙어 있음');
}
