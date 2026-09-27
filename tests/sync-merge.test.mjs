// 기기 두 대 사이의 병합 규칙 (어떤 동기화 방법이든 같은 mergeState를 쓴다)
import { wait } from './lib.mjs';

export default async function (t) {
  const pc = await t.open(), phone = await t.open();
  const dump = (p) => p.evaluate(() => JSON.parse(JSON.stringify(state)));
  const merge = async (p, from) => p.evaluate((d) => { const n = mergeState(d); save(); render(); return n; }, await dump(from));
  const today = (p) => p.evaluate(() => ({ meals: day().meals.map((m) => m.name).sort(), ex: day().workouts.map((w) => w.name).sort(),
    note: day().note, weight: day().weight }));

  // ── 같은 날 따로 적은 건 둘 다 남는다 ──
  await pc.evaluate(() => {
    state.days[todayStr()] = { meals: [{ id: 'a', type: '점심', name: 'PC점심', amount: '1', kcal: 500 }],
      workouts: [{ id: 'w1', name: '스쿼트', sets: [{ weight: 80, reps: 8, done: true }] }], note: '', weight: 72 };
    save();
  });
  await phone.evaluate(() => {
    state.days[todayStr()] = { meals: [{ id: 'b', type: '저녁', name: '폰저녁', amount: '1', kcal: 700 }],
      workouts: [{ id: 'w2', name: '벤치프레스', sets: [{ weight: 60, reps: 10, done: true }] }], note: '' };
    save();
  });
  await merge(pc, phone);
  await merge(phone, pc);
  for (const [label, p] of [['PC', pc], ['폰', phone]]) {
    const d = await today(p);
    t.eq([d.meals, d.ex], [['PC점심', '폰저녁'], ['벤치프레스', '스쿼트']], `${label}: 양쪽 식단·운동이 다 있음`);
  }
  t.eq((await today(phone)).weight, 72, '체중도 넘어감');

  // ── 되풀이해도 수정시각이 안 밀림 ──
  const stamps = () => pc.evaluate(() => JSON.stringify(Object.entries(state.days).map(([d, v]) => [d, v.updatedAt])));
  await merge(pc, phone);
  const s1 = await stamps();
  await merge(pc, phone);
  await merge(pc, phone);
  t.eq(await stamps(), s1, '같은 걸 여러 번 합쳐도 수정시각 그대로 (밀리면 남의 최신 메모를 덮어씀)');
  t.eq(await pc.evaluate((d) => mergeState(d), await dump(phone)), 0, '바뀐 게 없으면 0일 (→ "이미 같아요")');
  t.eq(await pc.evaluate(() => Object.values(state.days).filter((v) => Array.isArray(v.deleted) && !v.deleted.length).length), 0,
    '빈 deleted가 안 생김');

  // ── 삭제가 전달되고 되살아나지 않음 ──
  await pc.evaluate(() => { day().meals = day().meals.filter((m) => m.id !== 'b'); markDeleted('b'); save(); });
  await merge(phone, pc);
  t.eq((await today(phone)).meals, ['PC점심'], '한쪽에서 지우면 다른 쪽도 지워짐');
  await merge(pc, phone);
  await merge(phone, pc);
  t.eq([(await today(pc)).meals, (await today(phone)).meals], [['PC점심'], ['PC점심']], '몇 번을 주고받아도 되살아나지 않음');

  // ── 하나뿐인 값은 나중에 고친 쪽 ──
  await pc.evaluate(() => { day().note = 'PC가 먼저'; save(); });
  await wait(phone, 20);
  await phone.evaluate(() => { day().note = '폰이 나중'; day().weight = 71.2; save(); });
  await merge(pc, phone);
  t.eq([(await today(pc)).note, (await today(pc)).weight], ['폰이 나중', 71.2], '메모·체중은 나중에 고친 쪽');

  // ── 운동 메모·볼륨 목표 같은 새 값도 따라감 ──
  await phone.evaluate(() => {
    day().workouts.find((w) => w.id === 'w2').note = '폰에서 적은 메모';
    state.profile.volGoals = { 가슴: 6000 };
    state.profile.updatedAt = Date.now() + 5000;
    save();
  });
  await merge(pc, phone);
  t.eq(await pc.evaluate(() => day().workouts.find((w) => w.id === 'w2').note), '폰에서 적은 메모', '운동 메모도 넘어감');
  t.eq(await pc.evaluate(() => state.profile.volGoals), { 가슴: 6000 }, '설정(볼륨 목표)도 넘어감');

  // ── 망가진 데이터 ──
  for (const junk of [{}, { days: null }, { days: { x: 'junk' } }, { days: { '2026-01-01': { meals: 'no', workouts: null } } }]) {
    const before = await pc.evaluate(() => Object.keys(state.days).length);
    await pc.evaluate((d) => { try { mergeState(d); } catch { /* 형식 오류는 던져도 된다 */ } }, junk);
    const alive = await pc.evaluate(() => { try { render(); return Array.isArray(day().meals); } catch { return false; } });
    t.ok(alive && (await pc.evaluate(() => Object.keys(state.days).length)) >= before, `망가진 파일 ${JSON.stringify(junk).slice(0, 30)} → 기록 안 잃고 앱 살아있음`);
  }

  // ── 1년치 병합 속도 ──
  for (const p of [pc, phone]) await p.evaluate(() => {
    for (let i = 1; i < 365; i++) state.days[shiftDate(todayStr(), -i)] = { note: '', updatedAt: Date.now() - i * 1000,
      meals: [{ id: `m${i}`, type: '점심', name: '밥', amount: '1', kcal: 300 }],
      workouts: [{ id: `w${i}`, name: '스쿼트', sets: [{ weight: 80, reps: 8, done: true }] }] };
    save();
  });
  const ms = await pc.evaluate((d) => { const t0 = performance.now(); mergeState(d); return performance.now() - t0; }, await dump(phone));
  t.ok(ms < 1000, `1년치 병합 ${Math.round(ms)}ms`);
  t.noErrors(pc, 'PC');
  t.noErrors(phone, '폰');
}
