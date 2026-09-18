# Gori Ribbon

고리 스플라인(`RIBBON_HANDOFF.md`)을 따라 종이띠가 화면을 패턴처럼 채우고, 띠 앞면에 입력한 글자가 반복되는 3D 키네틱 타이포 웹 아트.

## 실행

ES 모듈과 로컬 폰트를 쓰므로 로컬 서버로 연다.

```sh
python3 -m http.server 8080
# → http://localhost:8080
```

## 기능

- 고리 유닛(폭 340) 패턴이 화면 전체를 채움 — 직교 카메라, 고정 각도(yaw 45°)
- 띠 앞면 = 글자, 뒷면 = 단색. 글자는 끝없이 반복되며 흐름
- 타이핑 반응: 입력 즉시 반영 + 글자 폭만큼 밀림 + 새 글자 강조/굵게
- 마우스 반응: 고리 한 줄을 탄성 끈으로 시뮬레이션 — 포인터에 걸렸다 튕김
- SUIT Variable(wght 100–900) 가변 굵기
- "설정 복사" 버튼: 현재 설정을 JSON으로 복사
- PNG 저장, WebM 녹화

## 파일

| 파일 | 내용 |
|---|---|
| `index.html`, `css/style.css` | 페이지·패널 |
| `js/app3d.js` | 3D 리본 제너레이터 (Three.js) |
| `js/ribbon.js` | 고리 곡선 생성 (C4D Python 포팅) |
| `SUIT-Variable.ttf` | 가변 폰트 (SIL OFL) |
| `archive/v1-outline/` | 이전 버전: 글자 외곽선을 따라 고리가 이어지는 2D 제너레이터 |
| `js/app.js`, `js/outline.js` | v1용 스크립트 (현재 페이지에서는 사용 안 함) |
