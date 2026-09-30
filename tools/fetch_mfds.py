"""식약처 식품영양정보 표준DB(https://data.mfds.go.kr)에서 '음식' 데이터를 받는다.

    python3 tools/fetch_mfds.py            # → tools/mfds_food.json, tools/mfds_weights.json

- 목록(100g당 에너지·단백질)은 한 번에 500건씩 받는다 (약 2만 건, 1~2분).
- 1인분 무게(식품중량)는 목록에 없어서 음식 이름마다 대표 한 건의 상세 페이지에서 읽는다
  (약 1,200건). 공공 서버라 3개씩만 동시에, 사이사이 쉬면서 받는다 (20~30분).
- 중간에 끊겨도 다시 돌리면 받은 것은 건너뛴다.
- 자주 먹는 음식(국·탕·찌개 전부, 흔한 식사 60가지)은 조사 여러 건의 무게도 받는다(약 1,000건, 20~30분).
  한 건만 보면 1인분이 크게 흔들려서, 표를 만들 때 여러 건의 중간값을 쓴다.
받은 뒤 `python3 tools/build_food_db.py`로 food-db.js를 다시 만든다.
"""
import json, os, re, statistics, subprocess, time
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
LIST_OUT = os.path.join(HERE, 'mfds_food.json')
WEIGHT_OUT = os.path.join(HERE, 'mfds_weights.json')
RECORD_OUT = os.path.join(HERE, 'mfds_record_weights.json')
# 조사 여러 건의 무게를 받아 1인분 중간값을 낼 음식: 국·탕·찌개·전골 전부 + 흔한 식사
SOUP_CATS = {'국 및 탕류', '찌개 및 전골류'}
POPULAR = '''비빔밥 볶음밥 김밥 초밥 카레라이스 오므라이스 짜장면 짬뽕 냉면 물냉면 비빔냉면 칼국수 잔치국수 비빔국수 쫄면 우동 쌀국수 라멘
스파게티 떡볶이 라볶이 제육볶음 소불고기 돼지불고기 갈비찜 돼지갈비찜 족발 수육 돈가스 탕수육 닭강정 닭튀김 오징어볶음 낙지볶음 주꾸미볶음
잡채 김치전 해물파전 달걀말이 달걀찜 삼겹살구이 돼지갈비구이 곱창구이 장어구이 고등어구이 만두 떡국 회덮밥 짜장밥 잡채밥 콩국수 막국수
수제비 햄버거 샌드위치 피자'''.split()
SITE = 'https://data.mfds.go.kr/nsd/obaaa'
NTR = [  # 받을 영양성분: 에너지, 단백질 (100g당)
    {"ntrCpntDivsCd": "01", "ntrCpntItemCd": "NSD0701001", "ntrCpntCrtrUnit": "kcal", "stdNtrCpnm": "에너지(kcal)"},
    {"ntrCpntDivsCd": "01", "ntrCpntItemCd": "NSD0701006", "ntrCpntCrtrUnit": "g", "stdNtrCpnm": "단백질(g)"},
]


def curl(args, jar):
    return subprocess.run(['curl', '-s', '--max-time', '90', '-c', jar, '-b', jar] + args,
                          capture_output=True, text=True).stdout


def base_name(name):
    """'떡볶이_간장' → '떡볶이', '감자 된장국' → '감자 된장국' (같은 음식끼리 묶는 이름)"""
    return re.sub(r'\s+', ' ', re.split(r'[_(]', name)[0]).strip()


def fetch_list():
    jar = os.path.join(HERE, '.cj_list')
    curl([f'{SITE}/stdDbSrchRsltList.do', '-o', os.devnull], jar)
    rows, seen, page = [], set(), 1
    while True:
        params = {'srchFoodNm': '', 'srchDatDivsCd': 'D', 'checkedSrchType': 'checkedRprsFoodNm', 'srchRprsFoodNm': '',
                  'srchManufNm': '', 'sortColumnNm': 'FOOD_NM', 'sortType': 'DESC', 'stdNtrCpnmList': NTR, 'isUsePaging': True}
        body = json.dumps({'page': page, 'perPage': 500, 'stdDbSrchParams': params}, ensure_ascii=False)
        for attempt in range(5):
            try:
                out = curl(['-H', 'Content-Type: application/json', '-H', 'X-Requested-With: XMLHttpRequest',
                            '-H', f'Referer: {SITE}/stdDbSrchRsltList.do', '-X', 'POST',
                            f'{SITE}/getStdDbRsltList.do', '--data', body], jar)
                contents = json.loads(out)['data']['contents']
                break
            except (ValueError, KeyError):
                time.sleep(5)
        else:
            raise SystemExit(f'{page}쪽을 못 받았어요. 잠시 뒤 다시 돌려 주세요.')
        if not contents:
            break
        for r in contents:
            if r['stdDatSn'] not in seen:
                seen.add(r['stdDatSn'])
                rows.append({k: r[k] for k in ('stdDatSn', 'foodNm', 'foodLclsNm', 'nsd0701001', 'nsd0701006')})
        page += 1
        time.sleep(1.2)
    json.dump(rows, open(LIST_OUT, 'w'), ensure_ascii=False)
    print(f'목록 {len(rows)}건')
    return rows


def fetch_weights(rows):
    groups = {}
    for r in rows:
        try:
            groups.setdefault(base_name(r['foodNm']), []).append((float(r['nsd0701001']), r))
        except (TypeError, ValueError):
            continue
    done = json.load(open(WEIGHT_OUT)) if os.path.exists(WEIGHT_OUT) else {}
    todo = [n for n in sorted(groups) if not (done.get(n) or {}).get('w')]
    print(f'1인분 무게: {len(todo)}건 남음')

    def work(arg):
        wid, names = arg
        jar = os.path.join(HERE, f'.cj_w{wid}')
        res = {}
        for name in names:
            g = groups[name]
            mid = statistics.median(x[0] for x in g)
            rep = min(g, key=lambda x: abs(x[0] - mid))[1]   # 중간값에 가장 가까운 한 건
            wt = None
            for attempt in range(3):
                html = curl(['-G', f'{SITE}/stdDbSrchRsltDtl.do', '--data-urlencode', f"stdDatSn={rep['stdDatSn']}"], jar)
                m = re.search(r'식품중량\s*([\d.]+)(?:&nbsp;|\s)*(g|ml|mL)', html)
                if m:
                    wt = float(m.group(1))
                    break
                time.sleep(2)
            res[name] = {'w': wt, 'sn': rep['stdDatSn']}
            time.sleep(0.3)
        return res

    with ThreadPoolExecutor(3) as ex:
        for res in ex.map(work, [(i, todo[i::3]) for i in range(3)]):
            done.update(res)
            json.dump(done, open(WEIGHT_OUT, 'w'), ensure_ascii=False)
    print(f'1인분 무게 {sum(1 for v in done.values() if v.get("w"))}/{len(done)}건')


def fetch_record_weights(rows):
    by = {}
    for r in rows:
        by.setdefault(base_name(r['foodNm']), []).append(r)
    pick = []
    for name, rs in by.items():
        main = max(set(r['foodLclsNm'] for r in rs), key=[r['foodLclsNm'] for r in rs].count)
        cap = 10 if main in SOUP_CATS else 8 if name in POPULAR else 0
        if cap and len(rs) >= 2:
            step = max(1, len(rs) // cap)
            pick += [(name, r['stdDatSn']) for r in rs[::step][:cap]]
    done = json.load(open(RECORD_OUT)) if os.path.exists(RECORD_OUT) else {}
    todo = [(n, sn) for n, sn in pick if not (done.get(sn) or {}).get('w')]
    print(f'여러 건 무게: {len(todo)}건 남음')

    def work(arg):
        wid, items = arg
        jar = os.path.join(HERE, f'.cj_r{wid}')
        res = {}
        for name, sn in items:
            html = curl(['-G', f'{SITE}/stdDbSrchRsltDtl.do', '--data-urlencode', f'stdDatSn={sn}'], jar)
            m = re.search(r'식품중량\s*([\d.]+)(?:&nbsp;|\s)*(g|ml|mL)', html)
            res[sn] = {'name': name, 'w': float(m.group(1)) if m else None}
            time.sleep(0.3)
        return res

    with ThreadPoolExecutor(3) as ex:
        for res in ex.map(work, [(i, todo[i::3]) for i in range(3)]):
            done.update(res)
            json.dump(done, open(RECORD_OUT, 'w'), ensure_ascii=False)


if __name__ == '__main__':
    rows = json.load(open(LIST_OUT)) if os.path.exists(LIST_OUT) else fetch_list()
    fetch_weights(rows)
    fetch_record_weights(rows)
