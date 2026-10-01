"""AI Hub 한식 사진 → food-vision.json (사진으로 넣기의 기본 분류기, vision.js의 VISION_HEAD_URL)

**한국에 있는 PC에서 돌릴 것.** AI Hub는 해외에서 받는 걸 막고("해외에서의 데이터 다운로드를 제한"),
이용정책도 데이터를 국외로 옮기지 말라고 한다. 그래서 사진은 이 PC 밖으로 안 나가고(저장소에도 안 올린다),
학습 결과인 food-vision.json(숫자 표, 약 0.6MB)만 저장소에 올린다.

    pip install onnxruntime numpy pillow
    # 키: AI Hub 'AI 허브 오픈 API' 페이지의 API key 발급 (이메일로 온다). 메뉴(AI 개발지원)에 안 보여서
    #     https://www.aihub.or.kr/devsport/apishell/list.do?currMenu=403 로 바로 들어간다. 데이터셋 다운로드 승인도 필요
    set AIHUB_APIKEY=키          (Windows cmd)    /  export AIHUB_APIKEY=키   (macOS·리눅스·Git Bash)
    python tools/train_food_vision.py download     # 한국 이미지(음식) 16GB → tools/aihub/kfood.zip (잠깐 32GB 필요)
    python tools/train_food_vision.py train        # → food-vision.json (음식마다 300장, 1시간 안쪽)

이미 aihubshell 등으로 받은 zip이 있으면 `train --zip 경로`. 받다가 끊기면 다시 `download` — 이어서 받는다.

방식 (vision.js와 같아야 한다):
- 앱과 같은 모델 DINOv2-small(q8)로 사진을 768개 숫자로 바꾼다: [CLS] + 나머지 조각 평균. 줄이기는
  짧은 변 256(bicubic) → 가운데 224. 브라우저와 사진 줄이는 방식이 조금 달라 숫자가 0.97~0.99만큼 닮는데,
  시험해 보니 여기서 학습해 브라우저에서 써도 정확도가 같았다(87.4% ↔ 87.4%).
- 평균을 빼고 길이 1로 맞춘 뒤 softmax 회귀. 앱은 scale × (W_c · q) + b_c 로 확률을 낸다.
- 라벨은 사진이 든 폴더 이름. food-db.js의 음식 이름과 달라야 칼로리가 나오므로 다르면 LABEL_MAP에 적는다.
  tests/vision.test.mjs가 food-vision.json의 라벨이 모두 표에서 찾아지는지 검사한다.
"""
import argparse, base64, io, json, os, random, sys, tarfile, time, urllib.request, zipfile
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
WORK = os.path.join(HERE, 'aihub')               # 받은 데이터·캐시. .gitignore에 있다 — 절대 커밋하지 말 것
MODEL_ID = 'onnx-community/dinov2-small'         # vision.js의 VISION_MODEL과 같아야 한다
MODEL_URL = f'https://huggingface.co/{MODEL_ID}/resolve/main/onnx/model_quantized.onnx'
DATASET, FILE = 79, 50036                        # 한국 이미지(음식) / kfood.zip
DOWN_URL = f'https://api.aihub.or.kr/down/0.6/{DATASET}.do?fileSn={FILE}'
OUT = os.path.join(ROOT, 'food-vision.json')
IMG_EXT = ('.jpg', '.jpeg', '.png', '.bmp', '.webp')
# AI Hub 폴더 이름 → food-db.js 이름 (표기가 다를 때만). 학습 뒤 출력되는 "표에 없는 이름"을 보고 채운다.
# None이면 뺀다: food-db.js에 없는 음식이라 알아봐도 칼로리를 못 낸다. 표에 더하면 여기서 지우고 다시 train.
LABEL_MAP = {
    # 같은 음식을 표에서는 다른 이름으로 적었다 (그대로 두면 "볶음 평균"처럼 끝말 평균으로만 잡히거나 못 찾는다)
    '계란후라이': '달걀부침', '동그랑땡': '완자전', '콩자반': '콩조림', '도토리묵': '도토리묵무침',
    '감자채볶음': '감자볶음', '고추장진미채볶음': '오징어채볶음', '도라지무침': '도라지생채',
    '북엇국': '북어국', '소세지볶음': '소시지볶음', '시래기국': '시래기 된장국',
    # 두 음식을 한 폴더에 묶어 두었다 (밑줄 이름이 화면에 그대로 뜬다)
    '곰탕_설렁탕': '설렁탕', '떡국_만두국': '떡국',
    # 표에 없는 음식
    '과메기': None, '닭계장': None, '떡꼬치': None, '멍게': None, '산낙지': None,
    '수정과': None, '젓갈': None, '편육': None, '한과': None,
}


def log(*a):
    print(*a, flush=True)


# ---------- 받기 ----------
def fetch(url, dest, headers=None):
    """끊기면 이어 받는다(Range). 진행률을 찍는다."""
    have = os.path.getsize(dest) if os.path.exists(dest) else 0
    req = urllib.request.Request(url, headers={**(headers or {}), **({'Range': f'bytes={have}-'} if have else {})})
    try:
        res = urllib.request.urlopen(req, timeout=60)
    except urllib.error.HTTPError as e:
        if e.code == 416:          # 이미 다 받음
            return
        body = e.read().decode('utf-8', 'replace')[:300]
        sys.exit(f'받기 실패 ({e.code}): {body}')
    if have and res.status != 206:
        have = 0                   # 이어 받기를 안 받아 주면 처음부터
    total = int(res.headers.get('Content-Length') or 0) + have
    ctype = res.headers.get('Content-Type', '')
    if ctype.startswith('text/'):
        sys.exit('받기 실패: ' + res.read(500).decode('utf-8', 'replace'))
    t0, done = time.time(), have
    with open(dest, 'ab' if have else 'wb') as f:
        while chunk := res.read(1 << 20):
            f.write(chunk)
            done += len(chunk)
            if time.time() - t0 > 5:
                t0 = time.time()
                log(f'  {done / 1e9:.1f} / {total / 1e9:.1f} GB' if total else f'  {done / 1e9:.1f} GB')


def download():
    key = os.environ.get('AIHUB_APIKEY')
    if not key:
        sys.exit('AIHUB_APIKEY 환경 변수에 AI Hub API 키를 넣어 주세요 (파일 맨 위 설명 참고).')
    os.makedirs(WORK, exist_ok=True)
    tar_path, zip_path = os.path.join(WORK, 'kfood.tar'), os.path.join(WORK, 'kfood.zip')
    if os.path.exists(zip_path):
        return log('이미 받았어요:', zip_path)
    log('한국 이미지(음식) 받는 중 (16GB, 끊기면 다시 실행하면 이어 받아요)')
    fetch(DOWN_URL, tar_path, {'apikey': key})
    assemble(tar_path, zip_path)
    os.remove(tar_path)
    log('완료:', zip_path)


def assemble(tar_path, zip_path):
    """AI Hub는 tar 안에 zip을 조각(.part0, .part1 …)으로 나눠 담는다. 번호 순서대로 이어 붙인다."""
    with tarfile.open(tar_path) as tar:
        members = [m for m in tar.getmembers() if m.isfile()]
        parts = [m for m in members if '.part' in os.path.basename(m.name)]
        if parts:
            parts.sort(key=lambda m: int(m.name.rsplit('.part', 1)[1] or 0))
        else:
            parts = [m for m in members if m.name.lower().endswith('.zip')]
        if not parts:
            sys.exit('tar 안에 zip이 없어요: ' + ', '.join(m.name for m in members[:5]))
        log(f'조각 {len(parts)}개 이어 붙이는 중')
        with open(zip_path, 'wb') as out:
            for m in parts:
                src = tar.extractfile(m)
                while chunk := src.read(1 << 20):
                    out.write(chunk)


# ---------- 사진 → 숫자 ----------
MEAN = (0.485, 0.456, 0.406)
STD = (0.229, 0.224, 0.225)


def load_model():
    import onnxruntime as ort
    path = os.path.join(WORK, 'dinov2-small-q8.onnx')
    if not os.path.exists(path):
        log('모델 받는 중 (24MB)')
        os.makedirs(WORK, exist_ok=True)
        fetch(MODEL_URL, path)
    return ort.InferenceSession(path, providers=['CPUExecutionProvider'])


def prep(data):
    import numpy as np
    from PIL import Image
    im = Image.open(io.BytesIO(data)).convert('RGB')
    w, h = im.size
    s = 256 / min(w, h)
    im = im.resize((max(1, round(w * s)), max(1, round(h * s))), Image.BICUBIC)
    w, h = im.size
    l, t = (w - 224) // 2, (h - 224) // 2
    a = (np.asarray(im.crop((l, t, l + 224, t + 224)), np.float32) / 255 - np.array(MEAN, np.float32)) / np.array(STD, np.float32)
    return a.transpose(2, 0, 1)


def embed_all(sess, items, cache_path):
    """items: [(label, 읽기 함수)] → (N, 768). 중간에 끊겨도 다시 돌리면 이어서 (cache)."""
    import numpy as np
    done = {}
    if os.path.exists(cache_path):
        z = np.load(cache_path, allow_pickle=False)
        done = dict(zip(z['keys'].tolist(), z['vecs']))
    todo = [(k, read) for k, read in items if k not in done]
    log(f'사진 {len(items)}장 중 {len(todo)}장을 숫자로 바꾸는 중')
    t0, last = time.time(), time.time()
    for i in range(0, len(todo), 16):
        batch, keys = [], []
        for k, read in todo[i:i + 16]:
            try:
                batch.append(prep(read()))
                keys.append(k)
            except Exception as e:          # 깨진 사진은 건너뛴다
                log('  건너뜀:', k, e)
        if batch:
            hs = sess.run(None, {'pixel_values': np.stack(batch)})[0]
            for k, h in zip(keys, hs):
                done[k] = np.concatenate([h[0], h[1:].mean(0)]).astype(np.float32)
        if time.time() - last > 30 or i + 16 >= len(todo):
            last = time.time()
            np.savez(cache_path, keys=np.array(list(done.keys())), vecs=np.stack(list(done.values())))
            n = min(i + 16, len(todo))
            log(f'  {n}/{len(todo)} · 남은 시간 약 {(time.time() - t0) / n * (len(todo) - n) / 60:.0f}분')
    return done


# ---------- 학습 ----------
def softmax_train(X, y, C, scale=20.0, iters=800, lr=0.5, wd=1e-3):
    import numpy as np
    W = np.zeros((X.shape[1], C), np.float32)
    b = np.zeros(C, np.float32)
    Y = np.eye(C, dtype=np.float32)[y]
    for _ in range(iters):
        L = scale * X @ W + b
        L -= L.max(1, keepdims=True)
        P = np.exp(L)
        P /= P.sum(1, keepdims=True)
        G = (P - Y) / len(y)
        W -= lr * (scale * X.T @ G + wd * W)
        b -= lr * G.sum(0)
    return W, b


def probs(X, W, b, scale):
    import numpy as np
    L = scale * X @ W + b
    L -= L.max(1, keepdims=True)
    P = np.exp(L)
    return P / P.sum(1, keepdims=True)


def unit(X, mean):
    import numpy as np
    Z = X - mean
    return Z / np.linalg.norm(Z, axis=1, keepdims=True)


def train(zip_path, per_class, out=OUT, seed=0):
    import numpy as np
    if not os.path.exists(zip_path):
        sys.exit(f'{zip_path}가 없어요. 먼저 download를 하거나 --zip으로 받은 파일을 알려 주세요.')
    zf = zipfile.ZipFile(zip_path)
    # kfood.zip은 분류별 zip(구이.zip, 국.zip …)을 압축 없이 한 번 더 담고 있다. 16GB를 또 풀지 않고 그 자리에서 연다
    zips = [zf] + [zipfile.ZipFile(zf.open(n)) for n in zf.namelist() if n.lower().endswith('.zip')]
    by_label, src = defaultdict(list), {}
    for z in zips:
        for name in z.namelist():
            if name.lower().endswith(IMG_EXT) and '/' in name:
                label = name.rstrip('/').split('/')[-2].strip()
                label = LABEL_MAP.get(label, label)
                if label:
                    by_label[label].append(name)
                    src[name] = z
    least = min(20, per_class)
    labels = sorted(l for l, v in by_label.items() if len(v) >= least)
    log(f'음식 {len(labels)}가지 (사진 {least}장 미만은 뺌)')
    if not labels:
        sys.exit('zip 안에서 음식 폴더를 못 찾았어요: ' + ', '.join(zf.namelist()[:5]))
    rnd = random.Random(seed)
    items, val = [], set()
    for l in labels:
        names = sorted(by_label[l])
        rnd.shuffle(names)
        names = names[:per_class]
        val.update(names[:max(5, len(names) // 10)])          # 10%는 시험용으로 남긴다
        items += [((l, n), n) for n in names]
    sess = load_model()
    vecs = embed_all(sess, [(n, (lambda n=n: src[n].read(n))) for _, n in items], os.path.join(WORK, 'kfood-emb.npz'))
    rows = [(l, n) for (l, n), _ in items if n in vecs]
    X = np.stack([vecs[n] for _, n in rows])
    y = np.array([labels.index(l) for l, _ in rows])
    is_val = np.array([n in val for _, n in rows])
    mean = X[~is_val].mean(0)
    scale = 20.0
    W, b = softmax_train(unit(X[~is_val], mean), y[~is_val], len(labels), scale)

    P = probs(unit(X[is_val], mean), W, b, scale)
    yt = y[is_val]
    top = P.argsort(1)[:, ::-1]
    ok = top[:, 0] == yt
    log(f'\n시험 사진 {len(yt)}장: 첫 추측 {ok.mean():.1%}, 후보 3개 안에 {np.mean([yt[i] in top[i, :3] for i in range(len(yt))]):.1%}')
    conf = P.max(1)
    for th in (0.4, 0.5, 0.6, 0.7, 0.8):
        m = conf >= th
        log(f'  확신도 {th} 이상만 자동: {m.mean():.0%}가 자동, 그중 {ok[m].mean() if m.any() else 0:.1%} 정답')

    # 다 쓰고 나서 전체(시험용 포함)로 다시 학습해 내보낸다
    mean = X.mean(0)
    W, b = softmax_train(unit(X, mean), y, len(labels), scale)
    head = {
        'model': MODEL_ID,
        'source': 'AI Hub 한국 이미지(음식)',
        'trained': time.strftime('%Y-%m-%d'),
        'images': int(len(y)),
        'valAccuracy': round(float(ok.mean()), 4),
        'labels': labels,
        'dim': int(X.shape[1]),
        'mean': [round(float(v), 5) for v in mean],
        # 음식마다 한 줄(labels × dim), Float32를 base64로
        'W': base64.b64encode(np.ascontiguousarray(W.T, dtype='<f4').tobytes()).decode(),
        'b': [round(float(v), 5) for v in b],
        'scale': scale,
    }
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(head, f, ensure_ascii=False, separators=(',', ':'))
    log(f'\n→ {out} ({os.path.getsize(out) / 1e6:.1f}MB)')
    db = open(os.path.join(ROOT, 'food-db.js'), encoding='utf-8').read()
    missing = [l for l in labels if f"'{l}'" not in db and f'"{l}"' not in db and f'{l}:' not in db]
    if missing:
        log('표에서 이름 그대로는 못 찾은 음식 (끝말로 잡힐 수도 있음, 다르면 LABEL_MAP에 적고 다시 train):')
        log('  ' + ', '.join(missing))
    log('다음: vision.js의 VISION_HEAD_URL을 \'food-vision.json\'으로, sw.js FILES에 food-vision.json 추가 → node tests/run.mjs')


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('step', choices=['download', 'train'])
    ap.add_argument('--zip', default=os.path.join(WORK, 'kfood.zip'), help='받아 둔 kfood.zip 경로')
    ap.add_argument('--per-class', type=int, default=300, help='음식마다 쓸 사진 수 (많을수록 정확하지만 오래 걸림)')
    ap.add_argument('--out', default=OUT, help='결과 파일 (기본: 저장소의 food-vision.json)')
    a = ap.parse_args()
    download() if a.step == 'download' else train(a.zip, a.per_class, a.out)
