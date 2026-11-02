# 2026 미국 중간선거 개표 특보

2026년 11월 3일 미국 중간선거(상원·하원·주지사) 개표 현황을 한국어로 보여주는 사이트입니다.
방송 개표 그래픽 느낌의 디자인, 라이트/다크 테마, 하원 435석 육각형 카토그램.

## 데이터 (자동)

1. **Poliwave Results API** (1순위) — 키가 있어야 하고 키는 브라우저에 노출하면 안 되므로,
   GitHub Actions(`.github/workflows/poliwave.yml`)가 키로 받아서 `live` 브랜치의 `live.json`에 올리고, 사이트는 그 파일을 읽습니다.
   - 키 받기: https://www.poliwave.com/about/api 의 안내대로 Poliwave에 이메일로 신청
   - 키 넣기: 저장소 Settings → Secrets and variables → Actions → New repository secret → 이름 `POLIWAVE_KEY`
   - 개표 기간(한국시간 11/4 07시 ~ 11/7 09시)에는 30초마다, 그 외에는 15분마다 받습니다.
2. **civicAPI** (자동 대체) — Poliwave 데이터가 없거나 15분 넘게 멈추면 사이트가 civicAPI 공개 피드를 직접 받습니다.

## 파일

| 파일 | 내용 |
|---|---|
| `index.html`, `style.css`, `app.js` | 사이트 |
| `data/races.json` | 후보 한국어·영문 이름, 정당, 현직 여부, 공지(`notice`), 수동 당선 지정(`winner`) |
| `data/states.json` | 미국 지도 (us-atlas) |
| `data/house-grid.json` | 하원 육각형 카토그램 배치 |
| `scripts/poliwave.mjs` | Poliwave → live.json 변환 (Actions에서 실행) |
