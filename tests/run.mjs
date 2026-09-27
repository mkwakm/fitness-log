// 모든 *.test.mjs를 차례로 돌린다.  사용법:  node tests/run.mjs [이름 일부...]
//   예) node tests/run.mjs sync      → sync가 들어간 파일만
//       VERBOSE=1 node tests/run.mjs → 통과한 항목도 전부 출력
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { launch, makeT } from './lib.mjs';

const dir = dirname(fileURLToPath(import.meta.url));
const filters = process.argv.slice(2);
const files = readdirSync(dir).filter((f) => f.endsWith('.test.mjs'))
  .filter((f) => !filters.length || filters.some((q) => f.includes(q))).sort();

const browser = await launch();
let pass = 0, fail = 0;
const failed = [];
const started = Date.now();
for (const f of files) {
  const t0 = Date.now();
  const t = makeT(browser, f);
  process.stdout.write(`▶ ${f}\n`);
  try {
    const mod = await import(pathToFileURL(join(dir, f)).href);
    await mod.default(t);
  } catch (e) {
    t.results.push({ ok: false, msg: `예외: ${e.message.split('\n')[0]}` });
    console.log(`    ❌ 예외: ${e.stack?.split('\n').slice(0, 3).join('\n       ')}`);
  }
  await t.closeAll();
  const p = t.results.filter((r) => r.ok).length;
  const q = t.results.length - p;
  pass += p; fail += q;
  if (q) failed.push(`${f} (${q})`);
  console.log(`  ${q ? '❌' : '✅'} ${p}/${t.results.length} · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
await browser.close();
console.log(`\n${fail ? '❌' : '✅'} ${files.length}개 파일 · ${pass}개 통과 · ${fail}개 실패 · ${((Date.now() - started) / 1000).toFixed(0)}s`);
if (failed.length) console.log('실패한 파일: ' + failed.join(', '));
process.exit(fail ? 1 : 0);
