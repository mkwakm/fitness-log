// 오운완 카드: 그 날 운동을 이미지 한 장으로 그려 인스타 스토리·카톡에 공유하거나 저장한다.
// 서버 없이 canvas로 그린다. app.js 뒤에 읽힌다($·esc·countedSets·volumeOf·personalBest… 를 쓴다).

const SHARE_W = 1080;
const SHARE_H = 1350;        // 4:5 — 인스타 피드에 꽉 차고 스토리에도 잘 들어간다
const SHARE_ROWS = 7;        // 운동이 많으면 7개까지 그리고 "+ N개 더"

let shareDate = '';
let shareUrl = '';           // 미리보기 blob URL (다시 그릴 때 정리한다)
let shareFile = null;

// 카드에 들어갈 숫자. 화면(달력·집중 모드 마무리)과 같은 집계 함수만 쓴다.
function shareCardData(date) {
  const d = state.days[date];
  const ws = d?.workouts || [];
  const sets = ws.reduce((n, w) => n + countedSets(w).length, 0);
  const vol = Math.round(ws.reduce((v, w) => v + volumeOf(w), 0));
  // 시간을 쟀으면 그 시간, 안 쟀으면 세트로 추정한 시간 ("0분"이라고 적으면 틀린 말이 된다)
  const session = Math.floor(sessionSeconds(d) / 60);
  const min = session || Math.round(ws.reduce((m, w) => m + minutesOf(w), 0));
  const exercises = ws.map((w) => {
    const counted = countedSets(w);
    // 그 날 가장 센 세트(1RM 기준). 맨몸이면 가장 많이 한 횟수
    let top = null;
    for (const s of counted) {
      const weight = nonNeg(s.weight);
      const reps = nonNeg(s.reps);
      if (!weight && !reps) continue;
      const rm = oneRM(weight, reps);
      if (!top || rm > top.rm || (rm === top.rm && (weight > top.weight || (!weight && reps > top.reps)))) top = { weight, reps, rm };
    }
    const best = !top ? (Number(w.minutes) > 0 ? `${w.minutes}분` : '')
      : top.weight ? `${top.weight}kg × ${top.reps}` : `${top.reps}회`;
    // 신기록은 예전 기록을 넘긴 것만 (처음 해 본 운동은 비교할 게 없다)
    const pr = personalBest(w.name)?.date === date && !!lastRecord(w.name, date);
    return { name: w.name, sets: counted.length, best, pr };
  });
  return {
    date,
    title: d?.split || dayParts(d || { workouts: [] }).map(partLabel).join('·'),
    sets, vol, min, burn: dayBurn(date),
    exercises,
    prs: exercises.filter((e) => e.pr).length,
  };
}

function shareColors() {
  const css = getComputedStyle(document.documentElement);
  const v = (k, fb) => css.getPropertyValue(k).trim() || fb;
  return {
    bg: v('--bg', '#15191b'), card: v('--card', '#1e2427'), text: v('--text', '#e6ebe8'),
    muted: v('--muted', '#98a3a0'), line: v('--line', '#2f3739'), accent: v('--accent', '#34d399'),
    onAccent: '#0d1412',
  };
}

// 글자가 칸보다 길면 …으로 자른다
function fitText(ctx, text, max) {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1);
  return t + '…';
}

function drawShareCard(canvas, data) {
  const c = shareColors();
  const font = getComputedStyle(document.body).fontFamily || 'sans-serif';
  const ctx = canvas.getContext('2d');
  canvas.width = SHARE_W;
  canvas.height = SHARE_H;
  const P = 84;                       // 바깥 여백
  const F = (size, weight = 400) => `${weight} ${size}px ${font}`;
  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, SHARE_W, SHARE_H);
  ctx.textBaseline = 'alphabetic';

  // 머리: 오운완 + 날짜, 그 아래 분할(또는 부위)
  ctx.fillStyle = c.accent;
  ctx.fillRect(P, P, 14, 92);
  ctx.fillStyle = c.text;
  ctx.font = F(92, 800);
  ctx.fillText('오운완', P + 38, P + 82);
  const [y, m, dd] = data.date.split('-').map(Number);
  ctx.font = F(40, 600);
  ctx.fillStyle = c.muted;
  ctx.textAlign = 'right';
  ctx.fillText(`${y}.${m}.${dd} ${WEEKDAYS[weekdayOf(data.date)]}`, SHARE_W - P, P + 40);
  if (data.prs) {
    ctx.font = F(34, 800);
    const tag = `신기록 ${data.prs}`;
    const tw = ctx.measureText(tag).width + 36;
    ctx.fillStyle = c.accent;
    ctx.fillRect(SHARE_W - P - tw, P + 58, tw, 50);
    ctx.fillStyle = c.onAccent;
    ctx.fillText(tag, SHARE_W - P - 18, P + 96);
  }
  ctx.textAlign = 'left';
  let top = P + 150;
  if (data.title) {
    ctx.font = F(44, 600);
    ctx.fillStyle = c.muted;
    ctx.fillText(fitText(ctx, data.title, SHARE_W - P * 2), P, top + 30);
    top += 70;
  }

  // 숫자 넷: 시간 · 볼륨 · 세트 · 소모
  const vol = data.vol >= 10000 ? [(data.vol / 1000).toFixed(1), 't'] : [data.vol.toLocaleString(), 'kg'];
  const tiles = [[String(data.min), '분', '시간'], [vol[0], vol[1], '볼륨'], [String(data.sets), '세트', '본 세트'], [data.burn.toLocaleString(), 'kcal', '소모']];
  const tileW = (SHARE_W - P * 2) / 4;
  const tileH = 170;
  ctx.fillStyle = c.card;
  ctx.fillRect(P, top, SHARE_W - P * 2, tileH);
  tiles.forEach(([val, unit, label], i) => {
    const x = P + tileW * i + 30;
    if (i) { ctx.fillStyle = c.line; ctx.fillRect(P + tileW * i, top + 30, 2, tileH - 60); }
    // 숫자 + 단위가 칸보다 길면(볼륨 4,047kg 같은) 글자를 줄인다 — 옆 칸 경계선을 넘지 않게
    let size = 58;
    const fits = () => {
      ctx.font = F(size, 800);
      const vw = ctx.measureText(val).width;
      ctx.font = F(Math.round(size * 0.48), 600);
      return vw + 6 + ctx.measureText(unit).width <= tileW - 52;
    };
    while (size > 34 && !fits()) size -= 2;
    ctx.fillStyle = c.text;
    ctx.font = F(size, 800);
    ctx.fillText(val, x, top + 88);
    const w = ctx.measureText(val).width;
    ctx.font = F(Math.round(size * 0.48), 600);
    ctx.fillStyle = c.muted;
    ctx.fillText(unit, x + w + 6, top + 88);
    ctx.font = F(28, 500);
    ctx.fillText(label, x, top + 134);
  });
  top += tileH + 56;

  // 운동 목록: 이름(+신기록) · 세트 수 | 그 날 가장 센 세트
  const rows = data.exercises.slice(0, data.exercises.length > SHARE_ROWS ? SHARE_ROWS - 1 : SHARE_ROWS);
  const rowH = 104;
  rows.forEach((e, i) => {
    const yy = top + i * rowH;
    ctx.fillStyle = c.line;
    ctx.fillRect(P, yy, SHARE_W - P * 2, 2);
    ctx.textAlign = 'right';
    ctx.font = F(44, 700);
    ctx.fillStyle = c.text;
    ctx.fillText(e.best, SHARE_W - P, yy + 66);
    const bestW = ctx.measureText(e.best).width;
    ctx.textAlign = 'left';
    const prW = e.pr ? 104 : 0;
    ctx.font = F(42, 600);
    const name = fitText(ctx, e.name, SHARE_W - P * 2 - bestW - prW - 160);
    ctx.fillText(name, P, yy + 62);
    let x = P + ctx.measureText(name).width + 16;
    if (e.pr) {
      ctx.fillStyle = c.accent;
      ctx.fillRect(x, yy + 26, 84, 46);
      ctx.fillStyle = c.onAccent;
      ctx.font = F(28, 800);
      ctx.fillText('PR', x + 22, yy + 60);
      x += prW;
    }
    ctx.fillStyle = c.muted;
    ctx.font = F(30, 500);
    ctx.fillText(e.sets ? `${e.sets}세트` : '', x, yy + 62);
  });
  const more = data.exercises.length - rows.length;
  if (more > 0) {
    const yy = top + rows.length * rowH;
    ctx.fillStyle = c.line;
    ctx.fillRect(P, yy, SHARE_W - P * 2, 2);
    ctx.fillStyle = c.muted;
    ctx.font = F(36, 600);
    ctx.fillText(`+ ${more}개 더`, P, yy + 64);
  }

  // 바닥: 앱 이름
  ctx.fillStyle = c.accent;
  ctx.fillRect(P, SHARE_H - P - 26, 26, 26);
  ctx.fillStyle = c.muted;
  ctx.font = F(30, 600);
  ctx.fillText('fitness-log', P + 42, SHARE_H - P - 2);
}

// 창은 바로 연다. 그림(toBlob)은 비동기라 다 그린 뒤에 열면, 그 사이 누른 ✕·뒤로가기가 먼저 와서
// 닫힌 줄 알았던 창이 뒤늦게 떠 버린다(테스트에서 실제로 났다).
async function openShare(date = currentDate) {
  shareDate = date;
  shareFile = null;
  const img = $('#shareImg');
  img.removeAttribute('src');
  delete img.dataset.date;
  $('#shareSend').disabled = $('#shareSave').disabled = true;
  $('#shareSheet').hidden = false;
  layerOpened('share');
  const canvas = document.createElement('canvas');
  drawShareCard(canvas, shareCardData(date));
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  if (shareDate !== date) return;                       // 그리는 사이 다른 날 카드를 열었다
  if (shareUrl.startsWith('blob:')) URL.revokeObjectURL(shareUrl);
  shareUrl = blob ? URL.createObjectURL(blob) : canvas.toDataURL('image/png');
  shareFile = blob ? new File([blob], `오운완-${date}.png`, { type: 'image/png' }) : null;
  img.src = shareUrl;
  img.dataset.date = date;
  const can = !!shareFile && !!navigator.canShare?.({ files: [shareFile] });
  $('#shareSend').hidden = !can;
  $('#shareSave').classList.toggle('primary', !can);
  $('#shareSend').disabled = $('#shareSave').disabled = false;
}
function closeShare(fromPop = false) {
  if ($('#shareSheet').hidden) return;
  $('#shareSheet').hidden = true;
  layerClosed('share', fromPop);
}
async function sendShare() {
  if (!shareFile) return;
  try {
    await navigator.share({ files: [shareFile], title: '오운완' });
  } catch (err) {
    if (err?.name !== 'AbortError') saveShare();   // 공유가 막히면 저장이라도
  }
}
function saveShare() {
  const a = document.createElement('a');
  a.href = shareUrl;
  a.download = `오운완-${shareDate}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

$('#shareSend').addEventListener('click', sendShare);
$('#shareSave').addEventListener('click', saveShare);
$('#shareClose').addEventListener('click', () => closeShare());
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-share-day]');
  if (b) openShare(b.dataset.shareDay || currentDate);
});
