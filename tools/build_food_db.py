"""tools/mfds_food.json + tools/mfds_weights.json → food-db.js의 '식약처 표' 부분을 다시 쓴다.

    python3 tools/build_food_db.py

food-db.js의 손으로 적은 표(FOOD_DB)와 단위(DEFAULT_UNITS)는 건드리지 않고,
`// ── 식약처 표 시작 ──` ~ `// ── 식약처 표 끝 ──` 사이만 바꾼다.

- 같은 이름(‘떡볶이_간장’ → ‘떡볶이’)끼리 묶어 100g당 에너지·단백질의 **중간값**을 쓴다.
  같은 음식도 조사(가정식·외식·급식 등)마다 값이 달라서, 평균보다 튀는 값에 덜 흔들리는 중간값이 낫다.
- 1인분 무게는 중간값에 가장 가까운 한 건의 '식품중량'. 없으면 같은 분류의 중간값.
- 끝말 평균(GENERIC): 이름이 딱 맞지 않을 때 '○○찌개' → '찌개' 평균으로 잡는다.
"""
import json, os, re, statistics
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
rows = json.load(open(os.path.join(HERE, 'mfds_food.json')))
weights = json.load(open(os.path.join(HERE, 'mfds_weights.json')))
# 자주 먹는 음식(국·탕·찌개 전부, 흔한 식사 60가지)은 조사 여러 건의 식품중량을 받아 두었다: {식품코드: {name, w}}
# 한 건만 보면 그 건이 가정식 작은 그릇이냐 외식 뚝배기냐에 따라 1인분이 크게 흔들린다(부대찌개 270g ↔ 순두부찌개 912g).
rec_path = os.path.join(HERE, 'mfds_record_weights.json')
record_w = {}
for v in (json.load(open(rec_path)) if os.path.exists(rec_path) else {}).values():
    if v.get('w'):
        record_w.setdefault(v['name'], []).append(v['w'])

# 분류 → 종류. 종류마다 붙는 단위는 food-db.js의 KIND_UNITS에 있다.
#  s: 국·탕·찌개 (밥 제외)  b: 그릇 음식(밥·면·죽)  p: 요리 한 접시  m: 반찬  d: 마실 것  k: 빵·과자·간식
KIND = {
    '국 및 탕류': 's', '찌개 및 전골류': 's',
    '밥류': 'b', '면 및 만두류': 'b', '죽 및 스프류': 'b',
    '구이류': 'p', '볶음류': 'p', '찜류': 'p', '튀김류': 'p', '전·적 및 부침류': 'p', '조림류': 'p', '수·조·어·육류': 'p',
    '생채·무침류': 'm', '나물·숙채류': 'm', '김치류': 'm', '장아찌·절임류': 'm', '젓갈류': 'm', '장류, 양념류': 'm',
    '음료 및 차류': 'd', '유제품류 및 빙과류': 'd',
    '빵 및 과자류': 'k', '곡류, 서류 제품': 'k', '두류, 견과 및 종실류': 'k', '과일류': 'k', '채소, 해조류': 'k',
}

# 흔히 쓰는 이름 → 식약처 이름 (식약처 표에 그 이름이 따로 없을 때만 쓴다)
ALIASES = {
    '불고기': '소불고기', '보쌈': '수육', '곱창': '곱창구이', '막창': '막창구이', '뼈해장국': '뼈다귀해장국',
    '감자탕뼈해장국': '감자탕', '카레밥': '카레라이스', '떡만둣국': '떡만두국', '제육': '제육볶음',
}

# 이름이 딱 맞는 게 없을 때 끝말로 잡는 평균 ('김치부대찌개' → '부대찌개'가 먼저, 없으면 '찌개')
GENERIC = ['찌개', '전골', '탕', '국', '국밥', '덮밥', '볶음밥', '비빔밥', '김밥', '볶음', '구이', '조림', '찜',
           '무침', '나물', '전', '튀김', '죽', '국수', '냉면', '우동', '만두', '김치', '샐러드', '스프', '까스', '가스']

base = lambda n: re.sub(r'\s+', ' ', re.split(r'[_(]', n)[0]).strip()
norm = lambda n: n.lower().replace(' ', '')

groups = {}
for r in rows:
    try:
        k, p = float(r['nsd0701001']), float(r['nsd0701006'] or 0)
    except (TypeError, ValueError):
        continue
    groups.setdefault(base(r['foodNm']), []).append((k, p, r['foodLclsNm']))

# 식약처 '식품중량'은 대부분 1인분이지만, 일부는 조리한 전체 양이다(게조림 800g, 곰치국 1000g 등).
# 종류마다 1인분으로 말이 되는 범위를 두고, 벗어나면 같은 분류의 중간값을 쓴다.
PLAUSIBLE = {'s': (250, 1100), 'b': (200, 900), 'p': (80, 600), 'm': (20, 150), 'd': (100, 600), 'k': (10, 300)}   # 삼계탕은 1kg 가까이
def ok_weight(w, kind):
    lo, hi = PLAUSIBLE[kind]
    return w and lo <= w <= hi

main_cat = {name: Counter(x[2] for x in g).most_common(1)[0][0] for name, g in groups.items()}
cat_w = {}
for name in groups:
    w, cat = (weights.get(name) or {}).get('w'), main_cat[name]
    if ok_weight(w, KIND.get(cat, 'p')):
        cat_w.setdefault(cat, []).append(w)
cat_w = {c: statistics.median(v) for c, v in cat_w.items()}
replaced = 0

foods = []   # [표시 이름, kcal/100g, 단백질/100g, 1인분 g, 종류]
for name in sorted(groups):
    g = groups[name]
    cat = Counter(x[2] for x in g).most_common(1)[0][0]
    kind = KIND.get(cat, 'p')
    kcal = round(statistics.median(x[0] for x in g))
    prot = round(statistics.median(x[1] for x in g), 1)
    many = [x for x in record_w.get(name, []) if ok_weight(x, kind)]
    # 무게가 딱 100g인 기록은 1인분이 아니라 "100g 기준"으로 분석한 것일 때가 많다 (돈가스 7건 중 5건이 100g).
    # 다른 무게가 있으면 빼고 본다.
    if any(x != 100 for x in many):
        many = [x for x in many if x != 100]
    w = statistics.median(many) if len(many) >= 2 else (weights.get(name) or {}).get('w')
    if not ok_weight(w, kind):
        w = cat_w.get(cat) or sum(PLAUSIBLE[kind]) / 2
        replaced += 1
    for part in name.split('/'):                     # '리소토/리조또' → 둘 다
        part = part.strip()
        if part:
            foods.append([part, kcal, prot, round(w), kind])

keys = {norm(f[0]) for f in foods}
aliases = [[a, t] for a, t in ALIASES.items() if norm(a) not in keys and norm(t) in keys]

generic = []
for suf in GENERIC:
    if norm(suf) in keys:
        continue
    hit = [f for f in foods if norm(f[0]).endswith(suf) and norm(f[0]) != suf]
    if len(hit) < 3:
        continue
    kind = Counter(f[4] for f in hit).most_common(1)[0][0]
    generic.append([suf, round(statistics.median(f[1] for f in hit)), round(statistics.median(f[2] for f in hit), 1),
                    round(statistics.median(f[3] for f in hit)), kind])

rows_js = lambda xs: ',\n'.join('  ' + json.dumps(x, ensure_ascii=False) for x in xs)
block = f"""// ── 식약처 표 시작 ── (tools/build_food_db.py가 만든다. 손으로 고치지 말 것)
// 출처: 식품의약품안전처 식품영양정보 표준DB '음식' {len(rows):,}건 (https://data.mfds.go.kr).
// 같은 이름끼리 묶어 100g당 에너지·단백질의 중간값. 1인분은 자주 먹는 음식은 여러 건의 식품중량 중간값,
// 나머지는 대표 한 건의 식품중량
// (1인분으로 말이 안 되는 무게는 같은 분류의 중간값으로 바꿈 — build_food_db.py의 PLAUSIBLE).
// [이름, 100g당 kcal, 100g당 단백질(g), 1인분(g), 종류]
const MFDS_FOODS = [
{rows_js(foods)},
];
// 흔히 쓰는 이름 → 식약처 이름
const FOOD_ALIASES = [
{rows_js(aliases)},
];
// 이름이 딱 맞지 않을 때 끝말로 잡는 평균 (예: '엄마표김치찌개' → '김치찌개', '무슨무슨찌개' → '찌개')
const GENERIC_FOODS = [
{rows_js(generic)},
];
// ── 식약처 표 끝 ──"""

path = os.path.join(ROOT, 'food-db.js')
src = open(path, encoding='utf-8').read()
pat = re.compile(r'// ── 식약처 표 시작 ──.*?// ── 식약처 표 끝 ──', re.S)
if not pat.search(src):
    raise SystemExit('food-db.js에 "식약처 표 시작/끝" 표시가 없어요.')
open(path, 'w', encoding='utf-8').write(pat.sub(lambda _: block, src))
print(f'음식 {len(foods)}개 · 별칭 {len(aliases)}개 · 끝말 평균 {len(generic)}개 · 1인분 무게를 분류 중간값으로 바꾼 것 {replaced}개')
