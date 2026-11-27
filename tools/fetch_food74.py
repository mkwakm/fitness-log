"""AI Hub 74 "음식 이미지 및 영양정보 텍스트"(400종) → 음식마다 사진 몇백 장만 골라 담기

**한국에 있는 PC에서 돌릴 것** (AI Hub는 해외 다운로드를 막는다). 사진은 이 PC 밖으로 안 나간다.

    set AIHUB_APIKEY=키
    py -3.12 tools/fetch_food74.py meta      # 영양DB·라벨 (작은 파일) → 코드·이름·칼로리 표
    py -3.12 tools/fetch_food74.py sample    # 이미지 (VAL 7개, 합 177GB) → 음식마다 250장

**받기와 고르기를 나눈다.** 처음엔 받으면서 바로 사진을 줄였는데, 그 사이 소켓을 비우지 않으면
서버가 연결을 끊어 버렸다(4GB 언저리에서 번번이 IncompleteRead). 그래서 ① tar 하나를 **아무 일도
하지 않고 최고 속도로** 내려받아 디스크에 두고 ② 그 파일에서 음식마다 몇백 장만 골라 긴 변 256px
JPEG로 줄여 남긴 뒤 ③ tar를 지운다. 디스크는 한 번에 tar 하나(최대 31GB) + 고른 사진 2~3GB면 된다.

**API는 Range(이어 받기)를 안 받아 준다**(Range를 줘도 200으로 처음부터 준다). 끊기면 그 파일은
처음부터 다시 받는다. 파일 하나를 끝낼 때마다 done.json에 적어 두고, 다시 돌리면 건너뛴다.
zip을 끝까지 읽었는지(중앙 디렉터리 PK\x01\x02를 봤는지)도 확인한다 — 중간에 끊긴 걸 "끝"으로
보고 넘어가면 그 파일의 음식이 통째로 빠진다(실제로 그랬다).

사진은 `tools/aihub/f74/img/<음식코드>/*.jpg`, 코드→이름·중량·칼로리는 `foods74.json`.
"""
import bisect, io, json, os, sys, tarfile, time, urllib.request, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, 'aihub', 'f74')
IMG = os.path.join(WORK, 'img')
DATASET = 74
API = f'https://api.aihub.or.kr/down/0.6/{DATASET}.do?fileSn='
# 2.Validation 원천데이터 — 이름이 대분류 번호라 7개면 400종을 모두 덮는다 (합 177GB)
VAL_FILES = [
    (44885, '11.zip', 15), (44884, '09_10.zip', 18), (44886, '12_13_14_15_16.zip', 25),
    (44880, '01_0422_add.zip', 28), (44881, '02_03_05.zip', 30), (44883, '06_07_08.zip', 30),
    (44882, '04.zip', 31),
]
META_FILES = [(44887, 'nutri.xlsx'), (44878, 'labels_val.zip')]
PER_CLASS = 250
SIDE = 256                      # 긴 변이 아니라 짧은 변 기준 (학습 때 가운데 224를 자른다)


def log(*a):
    print(*a, flush=True)


def api_stream(file_sn):
    key = os.environ.get('AIHUB_APIKEY')
    if not key:
        sys.exit('AIHUB_APIKEY 환경 변수에 AI Hub API 키를 넣어 주세요.')
    req = urllib.request.Request(API + str(file_sn), headers={'apikey': key})
    res = urllib.request.urlopen(req, timeout=120)
    if res.headers.get('Content-Type', '').startswith('text/'):
        sys.exit('받기 실패: ' + res.read(300).decode('utf-8', 'replace'))
    return res


class PartChain(io.RawIOBase):
    """tar 안의 .part0, .part1 … 을 하나의 연속된 바이트 흐름으로 읽는다.

    AI Hub는 큰 파일을 1GB씩 조각내어 tar에 담는다. **조각 이름 끝의 숫자는 순번이 아니라 그 조각이
    시작하는 바이트 위치다**(part0, part1073741824, part2147483648 …). 흘려 읽는 중에는 되감을 수
    없으므로, 다음 조각의 시작 위치가 지금까지 읽은 양과 같은지 확인하고 어긋나면 바로 멈춘다.
    """

    def __init__(self, tar):
        # 반복자를 하나만 쓴다. `for m in tar`를 다시 돌리면 **이미 읽은 조각부터 again** 내놓아서
        # (TarFile.__iter__는 캐시해 둔 members를 먼저 준다) 첫 조각이 두 번 나온다 — 실제로 났다.
        self.tar, self.it, self.cur, self.read_bytes = tar, iter(tar), None, 0

    def _next(self):
        for m in self.it:
            if not m.isfile():
                continue
            tail = m.name.rsplit('.part', 1)
            at = int(tail[1]) if len(tail) > 1 and tail[1].isdigit() else 0
            if at != self.read_bytes:
                sys.exit(f'조각이 순서대로 들어 있지 않아요 ({m.name}, {self.read_bytes}바이트째를 기다림)')
            return self.tar.extractfile(m)
        return None

    def readinto(self, b):
        while True:
            if self.cur is None:
                self.cur = self._next()
                if self.cur is None:
                    return 0
            n = self.cur.readinto(b)
            if n:
                self.read_bytes += n
                return n
            self.cur = None

    def readable(self):
        return True


class TarParts(io.RawIOBase):
    """받아 둔 tar 안의 조각들을 이어 붙여 **임의 위치에서 읽히는 한 파일**처럼 보여 준다.

    `zipfile`에 넘기려면 되감기(seek)가 돼야 한다. tar 안 조각마다 "가상 위치 → tar 안 위치"만
    적어 두고, 읽을 때 그 자리로 건너뛴다. 조각이 빈틈 없이 이어지는지 먼저 확인한다.
    """

    def __init__(self, path):
        self.f = open(path, 'rb')
        with tarfile.open(path) as tar:
            members = [m for m in tar.getmembers() if m.isfile()]
        parts = []
        for m in members:
            tail = m.name.rsplit('.part', 1)
            at = int(tail[1]) if len(tail) > 1 and tail[1].isdigit() else 0
            parts.append((at, m.offset_data, m.size))
        parts.sort()
        pos = 0
        for at, _off, size in parts:
            if at != pos:
                raise ValueError(f'조각이 이어지지 않아요 ({at}에서 시작, {pos}바이트째를 기다림)')
            pos += size
        self.parts = parts
        self.starts = [p[0] for p in parts]
        self.size, self.pos = pos, 0

    def seekable(self):
        return True

    def readable(self):
        return True

    def seek(self, off, whence=0):
        if whence == 1:
            off += self.pos
        elif whence == 2:
            off += self.size
        self.pos = max(0, min(self.size, off))
        return self.pos

    def tell(self):
        return self.pos

    def readinto(self, b):
        if self.pos >= self.size:
            return 0
        i = bisect.bisect_right(self.starts, self.pos) - 1
        at, off, size = self.parts[i]
        inner = self.pos - at
        n = min(len(b), size - inner)
        self.f.seek(off + inner)
        got = self.f.readinto(memoryview(b)[:n])
        self.pos += got
        return got

    def close(self):
        try:
            self.f.close()
        finally:
            super().close()


def shrink(raw, dest):
    """긴 사진(7MB)을 학습에 쓸 만큼만 줄여 담는다."""
    from PIL import Image
    im = Image.open(io.BytesIO(raw))
    im = im.convert('RGB')
    w, h = im.size
    s = SIDE / min(w, h)
    if s < 1:
        im = im.resize((max(1, round(w * s)), max(1, round(h * s))), Image.BICUBIC)
    im.save(dest, 'JPEG', quality=88)


def sample_zip(path, counts, per_class):
    """받아 둔 tar(안에 zip 하나)에서 부족한 음식의 사진만 골라 줄여 담는다.

    한 음식의 사진이 수백 장이면 **고르게 건너뛰며** 뽑는다 — 앞에서부터 250장만 가져오면 같은
    식당·같은 각도만 담길 수 있다.
    """
    kept = 0
    with TarParts(path) as view, zipfile.ZipFile(view) as z:
        by_code = {}
        for info in z.infolist():
            if info.is_dir() or not info.filename.lower().endswith(('.jpg', '.jpeg', '.png')):
                continue
            code = next((c for c in info.filename.split('/') if len(c) == 8 and c.isdigit()), None)
            if code:
                by_code.setdefault(code, []).append(info)
        log(f'  zip 안: 음식 {len(by_code)}종 · 사진 {sum(len(v) for v in by_code.values())}장')
        last = time.time()
        for code, infos in sorted(by_code.items()):
            need = per_class - counts.get(code, 0)
            if need <= 0:
                continue
            step = max(1, len(infos) // need)
            dest_dir = os.path.join(IMG, code)
            os.makedirs(dest_dir, exist_ok=True)
            for info in infos[::step][:need]:
                dest = os.path.join(dest_dir, os.path.basename(info.filename).rsplit('.', 1)[0] + '.jpg')
                try:
                    with z.open(info) as src:
                        shrink(src.read(), dest)
                except Exception as e:
                    log('  건너뜀:', info.filename, e)
                    continue
                counts[code] = counts.get(code, 0) + 1
                kept += 1
                if time.time() - last > 60:
                    last = time.time()
                    log(f'  {code} … 남긴 사진 {kept}장 · 음식 {len(counts)}종')
    return kept


def download_tar(file_sn, dest, total_gb):
    """아무 처리도 하지 않고 최고 속도로 내려받는다 (중간에 느려지면 서버가 끊는다)."""
    res = api_stream(file_sn)
    got = 0
    t0 = last = time.time()
    with open(dest, 'wb') as f:
        while (c := res.read(1 << 23)):
            f.write(c)
            got += len(c)
            if time.time() - last > 60:
                last = time.time()
                speed = got / 1e6 / max(1, time.time() - t0)
                log(f'  받는 중 {got / 1e9:.1f}/{total_gb}GB · {speed:.1f}MB/s · '
                    f'남은 시간 약 {(total_gb * 1e3 - got / 1e6) / max(0.1, speed) / 60:.0f}분')
    log(f'  받기 끝 {got / 1e9:.1f}GB · {(time.time() - t0) / 60:.0f}분')


def state_path():
    return os.path.join(WORK, 'done.json')


def load_state():
    try:
        with open(state_path(), encoding='utf-8') as f:
            s = json.load(f)
            return s.get('done', []), s.get('counts', {})
    except Exception:
        return [], {}


def save_state(done, counts):
    with open(state_path(), 'w', encoding='utf-8') as f:
        json.dump({'done': done, 'counts': counts}, f)


def sample(per_class=PER_CLASS, only=None):
    os.makedirs(IMG, exist_ok=True)
    done, counts = load_state()
    # 중간에 끊겼으면 done.json이 모를 수 있다. 이미 담아 둔 사진을 세어 거기서 이어 간다.
    for code in os.listdir(IMG):
        have = len(os.listdir(os.path.join(IMG, code)))
        counts[code] = max(counts.get(code, 0), have)
    todo = [x for x in VAL_FILES if x[1] not in done and (not only or x[1] in only)]
    log(f'받을 파일 {len(todo)}개 (끝낸 것 {len(done)}개는 건너뜀), 음식마다 {per_class}장까지')
    for file_sn, label, gb in todo:
        log(f'\n── {label} ({gb}GB) ──')
        t0 = time.time()
        tar_path = os.path.join(WORK, 'cur.tar')
        for attempt in range(1, 9):
            try:
                if not os.path.exists(tar_path):
                    download_tar(file_sn, tar_path, gb)
                kept = sample_zip(tar_path, counts, per_class)
                break
            except Exception as e:
                save_state(done, counts)
                if os.path.exists(tar_path):
                    os.remove(tar_path)
                if attempt == 8:
                    sys.exit(f'{label}: 여덟 번 시도했는데 계속 끊겨요 — {type(e).__name__}: {e}')
                log(f'  실패 ({type(e).__name__}: {e}) — {attempt}번째, 30초 뒤 처음부터 다시 받습니다')
                time.sleep(30)
        os.remove(tar_path)
        done.append(label)
        save_state(done, counts)
        full = sum(1 for v in counts.values() if v >= per_class)
        log(f'{label} 끝: 남긴 사진 {kept}장 · {(time.time() - t0) / 60:.0f}분 · '
            f'지금까지 음식 {len(counts)}종, 다 채운 음식 {full}종')
    log('\n모두 끝났어요. 사진:', IMG)


def meta():
    """영양DB(xlsx)와 라벨(zip)을 받아 코드→이름·중량·칼로리 표(foods74.json)를 만든다."""
    import zipfile
    os.makedirs(WORK, exist_ok=True)
    for file_sn, out in META_FILES:
        path = os.path.join(WORK, out)
        if os.path.exists(path):
            continue
        log('받는 중:', out)
        res = api_stream(file_sn)
        with tarfile.open(fileobj=res, mode='r|') as tar, open(path, 'wb') as f:
            chain = PartChain(tar)
            while (c := chain.read(1 << 20)):
                f.write(c)
    import openpyxl
    ws = openpyxl.load_workbook(os.path.join(WORK, 'nutri.xlsx'), data_only=True).worksheets[0]
    rows = [r for r in ws.iter_rows(min_row=2, values_only=True) if r and r[0]]
    z = zipfile.ZipFile(os.path.join(WORK, 'labels_val.zip'))
    codes = sorted({n.split('/')[1] for n in z.namelist() if n.count('/') > 1 and n.endswith('.txt')})
    if len(codes) != len(rows):
        sys.exit(f'코드 {len(codes)}개와 영양표 {len(rows)}줄이 안 맞아요 — 짝짓기를 다시 봐야 합니다.')
    # 음식 코드는 분류 순서대로 붙어 있고 영양표도 같은 순서다 (밥 → 면 → 죽 … 한과).
    table = {c: {'name': str(r[0]).strip(), 'g': round(float(r[1])), 'kcal': round(float(r[2]), 1),
                 'protein': round(float(r[6]), 1)} for c, r in zip(codes, rows)}
    out = os.path.join(WORK, 'foods74.json')
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(table, f, ensure_ascii=False, indent=1)
    log(f'→ {out} ({len(table)}종)')


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'sample'
    if cmd == 'meta':
        meta()
    elif cmd == 'sample':
        n = int(sys.argv[2]) if len(sys.argv) > 2 else PER_CLASS
        sample(n)
    else:
        sys.exit(__doc__)
