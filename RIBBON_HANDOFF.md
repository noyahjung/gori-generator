# Ribbon Loop Generator — 웹 구현 핸드오버

> 리본형 고리(teardrop loop + 교차 꼬리) 파라메트릭 곡선을 웹에서 재현·생성하기 위한 명세.
> C4D Python 제너레이터에서 검증된 알고리즘을 JS로 포팅하고, 2D/3D 렌더링과 제너레이터(변주) 설계를 정리했다.
> 이 문서 하나로 Antigravity / Claude Code가 곡선 생성 → 타일링 → 렌더링까지 구현할 수 있도록 작성했다.

---

## 0. TL;DR (에이전트용 요약)

- **곡선 유닛 1개** = 물방울형 고리(loop) + 아래에서 X자로 교차하는 두 꼬리(tail). 꼬리 끝은 **수평으로 눕고**, 끝점은 **z=0**.
- 유닛은 **가로로 이어붙이면(타일링)** 골짜기에서 매끄럽게 연결된다. 오프셋 = 유닛 폭 `W ≈ 341.03`.
- 좌표계: **X=가로, Y=세로(위가 +), Z=깊이**. (수학/C4D 관례. Canvas 2D는 Y가 아래 → `y`를 뒤집을 것.)
- 핵심 함수 `generateUnit(params) → [[x,y,z], ...]` (§5). 기본값으로 호출 시 자기검증 값은 §9.
- 2D는 §7 (Canvas/SVG, 교차부 over/under), 3D는 §8 (Three.js TubeGeometry).
- 제너레이터 변주 축과 안전 범위는 §10.

---

## 1. 개념

한 유닛은 다음으로 구성된다.

1. **Loop (고리)** — 중심 `(0, cy)`, 반지름 `R`의 원의 일부(약 300°)로 둥근 물방울 모양.
2. **Tail (꼬리) ×2** — 고리 하단의 두 접점(QR, QL)에서 원에 **접선 방향**으로 뻗어 나와, 진행하며 방향을 **수평으로 눕히는** 곡선. 두 꼬리는 중앙 아래에서 **X자로 교차**한다.
3. **Z (깊이)** — 교차부에서 한 가닥은 앞, 한 가닥은 뒤로 지나가도록 z를 부여. 양 끝은 z=0이라 이어붙여도 어긋나지 않는다.

시각적으로는 "리본 배지"나 필기체 `l`의 고리와 같다. 여러 개를 이으면 물결처럼 연속된 고리 패턴이 된다.

---

## 2. 좌표계 규약 (중요)

| 축 | 의미 | 방향 |
|----|------|------|
| X | 가로 | 오른쪽 + |
| Y | 세로 | **위쪽 +** (수학/C4D 관례) |
| Z | 깊이 | 화면 밖으로 + |

- **C4D / Three.js**: Y-up 이므로 그대로 사용.
- **Canvas 2D / SVG**: Y가 **아래로 +** 이므로 그릴 때 `screenY = originY - y` 로 뒤집을 것. (또는 전체 스케일에 `scale(1,-1)`.)
- 단위는 임의(C4D 단위 ≈ cm). 화면에 맞게 스케일링해서 사용.
- 원점: 고리 중심 축이 x=0, 교차부가 대략 원점 근처(y는 음수). 유닛은 x=0에 대해 **좌우 대칭**.

---

## 3. 파라미터 (기본값 = 최종 확정값)

| 이름 | 기본값 | 의미 | 조절 효과 |
|------|--------|------|-----------|
| `R` | 100 | 고리 반지름 | 고리 크기 |
| `cy` | 120 | 고리 중심 높이 | ↑ 교차점이 위로 |
| `beta` | 56 (deg) | 접점 각도 = 꼬리 시작 각 | ↑ 꼬리 폭 좁고 가파름 / ↓ 넓게 벌어짐 |
| `Ltail` | 300 | 꼬리 길이 | ↑ 유닛 폭·고리 간격 넓어짐 |
| `ep` | 1.0 | 꼬리 끝 수평화 이징 | 1=둥근 골짜기, 2~3=평평하게 눕힘 |
| `depth` | 220 | 교차부 z 폭(깊이) | ↑ 두꺼운 sweep 여유↑ (교차 z간격 ≈ depth×0.43) |
| `sigma` | 12 | 곡률 스무딩 강도 | ↑ 고리–꼬리 이음매 더 부드럽게 |
| `N` | 600 | 출력 점 개수 | 해상도 |

**파생 값(기본 파라미터 기준, 자기검증용):**

- 유닛 폭 `W = rightTip.x - leftTip.x ≈ 341.03`
- 왼끝 `≈ (-170.6, -71.3, 0)`, 오른끝 `≈ (+170.6, -71.3, 0)` (정확히 좌우 대칭)
- 고리 최상단 `y ≈ 220`
- 교차부 z 간격 `≈ 95` (depth=220)

---

## 4. 알고리즘 (6단계)

1. **접점 계산** — 원 중심 `C=(0,cy)`, 반지름 `R`. 두 접점 각도 `aR = -90°+beta`, `aL = -90°-beta`.
   `QR = C + R·(cos aR, sin aR)` (우하), `QL = C + R·(cos aL, sin aL)` (좌하).
2. **꼬리 적분** — 각 접점에서 시작해 진행 방향(heading) `phi`를 `phi0`(접선 방향)에서 `phiE`(수평)로 이징 `e=1-(1-t)^ep` 로 회전시키며 스텝 적분.
   - 오른 접점 QR → **왼쪽 끝**: `phi0 = 180°+beta`, `phiE = 180°`.
   - 왼 접점 QL → **오른쪽 끝**: `phi0 = -beta`, `phiE = 0°`.
   (QR 가닥이 왼쪽 끝으로, QL 가닥이 오른쪽 끝으로 가며 중앙에서 교차한다.)
3. **경로 조립** — `reverse(왼쪽꼬리)` → `호(QR→위로 한 바퀴→QL)` → `오른쪽꼬리`. 각도 범위 `-90+beta … 270-beta`.
4. **균일 재샘플** — 누적 호길이 기준으로 N개 균일 간격 점으로 리샘플(간격 급변 제거).
5. **곡률 스무딩 + 재적분** — heading→곡률 계산 → 가우시안(sigma) 스무딩 → 다시 적분. 고리(곡률 1/R)와 꼬리(작은 곡률) 사이의 **곡률 계단**을 없애 sweep이 매끄럽다.
6. **대칭 보정 + Z** —
   - 대칭: `x=(X[i]-X[N-1-i])/2`, `y=(Y[i]+Y[N-1-i])/2` (스무딩 수치오차 제거, 좌우 완전 대칭).
   - `s = 2i/(N-1) - 1` ∈ [-1, 1].
   - `z = depth · s·(1-s²)²` — **양끝 z=0 이고 기울기도 0(평평)** → 이어붙일 때 딱 맞음. 교차부(s≈±0.45)에서 최대 분리.

---

## 5. 레퍼런스 구현 (JavaScript / TypeScript)

> 검증 완료. C4D Python 제너레이터와 동일 결과 + 대칭 보정 포함.
> TS는 반환타입을 `[number,number,number][]` 로 두면 된다.

```js
/**
 * 리본 고리 유닛 1개 생성.
 * @returns {number[][]} N개의 [x, y, z] 점 (x=가로, y=세로 위+, z=깊이)
 *   왼끝(index 0)과 오른끝(index N-1)은 좌우대칭, z=0. 이어붙이면 매끄럽게 연결.
 */
export function generateUnit(p = {}) {
  const R = p.R ?? 100, cy = p.cy ?? 120, beta = p.beta ?? 56,
        Ltail = p.Ltail ?? 300, ep = p.ep ?? 1.0, depth = p.depth ?? 220,
        sigma = p.sigma ?? 12, ntail = p.ntail ?? 300, narc = p.narc ?? 400, N = p.N ?? 600;
  const rad = Math.PI / 180;

  // 1) 접점
  const QRx = R * Math.cos((-90 + beta) * rad), QRy = cy + R * Math.sin((-90 + beta) * rad);
  const QLx = R * Math.cos((-90 - beta) * rad), QLy = cy + R * Math.sin((-90 - beta) * rad);

  // 2) 꼬리 적분 (heading을 수평으로 눕힘)
  const tail = (qx, qy, phi0, phiE) => {
    const pts = [[qx, qy]]; let px = qx, py = qy; const step = Ltail / ntail;
    for (let i = 1; i <= ntail; i++) {
      const t = i / ntail, e = 1 - Math.pow(1 - t, ep), phi = phi0 + (phiE - phi0) * e;
      px += Math.cos(phi) * step; py += Math.sin(phi) * step; pts.push([px, py]);
    }
    return pts;
  };
  const tR = tail(QRx, QRy, (180 + beta) * rad, 180 * rad); // -> 왼쪽 끝
  const tL = tail(QLx, QLy, (-beta) * rad, 0);              // -> 오른쪽 끝

  // 3) 경로 조립: 왼꼬리(역순) + 호 + 오른꼬리
  let raw = tR.slice().reverse();
  for (let i = 1; i <= narc; i++) {
    const a = ((-90 + beta) + (360 - 2 * beta) * i / narc) * rad;
    raw.push([R * Math.cos(a), cy + R * Math.sin(a)]);
  }
  raw = raw.concat(tL.slice(1));

  // 4) 균일 호길이 재샘플
  const cum = [0];
  for (let i = 1; i < raw.length; i++)
    cum.push(cum[i - 1] + Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]));
  const ds = cum[cum.length - 1] / (N - 1); const X = [], Y = []; let j = 0;
  for (let i = 0; i < N; i++) {
    const tg = i * ds; while (j < cum.length - 2 && cum[j + 1] < tg) j++;
    const f = cum[j + 1] > cum[j] ? (tg - cum[j]) / (cum[j + 1] - cum[j]) : 0;
    X.push(raw[j][0] + f * (raw[j + 1][0] - raw[j][0]));
    Y.push(raw[j][1] + f * (raw[j + 1][1] - raw[j][1]));
  }

  // 5) 곡률 스무딩 + 재적분
  const th = [];
  for (let i = 0; i < N; i++) { const ip = Math.min(i + 1, N - 1), im = Math.max(i - 1, 0);
    th.push(Math.atan2(Y[ip] - Y[im], X[ip] - X[im])); }
  for (let i = 1; i < N; i++) {
    while (th[i] - th[i - 1] > Math.PI) th[i] -= 2 * Math.PI;
    while (th[i] - th[i - 1] < -Math.PI) th[i] += 2 * Math.PI;
  }
  const k = [];
  for (let i = 0; i < N; i++) { const ip = Math.min(i + 1, N - 1), im = Math.max(i - 1, 0);
    k.push((th[ip] - th[im]) / ((ip - im) * ds)); }
  const rd = Math.round(sigma * 3), ker = [];
  for (let t = -rd; t <= rd; t++) ker.push(Math.exp(-0.5 * (t / sigma) ** 2));
  const ks = [];
  for (let i = 0; i < N; i++) {
    let acc = 0, w = 0;
    for (let m = -rd; m <= rd; m++) { const idx = i + m;
      if (idx >= 0 && idx < N) { acc += ker[m + rd] * k[idx]; w += ker[m + rd]; } }
    ks.push(acc / w);
  }
  const th2 = [th[0]]; for (let i = 1; i < N; i++) th2.push(th2[i - 1] + ks[i] * ds);
  const X2 = [X[0]], Y2 = [Y[0]];
  for (let i = 1; i < N; i++) { X2.push(X2[i - 1] + Math.cos(th2[i]) * ds); Y2.push(Y2[i - 1] + Math.sin(th2[i]) * ds); }

  // 6) 좌우 대칭 보정 + Z(양끝 0·평평)
  const out = [];
  for (let i = 0; i < N; i++) {
    const s = 2 * i / (N - 1) - 1;
    const x = (X2[i] - X2[N - 1 - i]) / 2;
    const y = (Y2[i] + Y2[N - 1 - i]) / 2;
    const z = depth * s * (1 - s * s) ** 2;
    out.push([x, y, z]);
  }
  return out;
}
```

---

## 6. 타일링 & 연결 규약

- 유닛은 왼끝 `(-W/2, y0, 0)` ~ 오른끝 `(+W/2, y0, 0)`, 폭 `W ≈ 341.03` (파라미터 바뀌면 `pts[N-1].x - pts[0].x` 로 재측정).
- **k번째 복제 = X로 `k·W` 이동.** 인접 유닛의 끝점이 정확히 겹치고(둘 다 z=0, 같은 y, 접선 수평) 이음매가 매끄럽다.
- **하나의 연속 폴리라인**으로 만들려면: 복제들을 이어붙이되 공유 끝점(중복) 하나를 제거.
  ```js
  function tile(count, params) {
    const u = generateUnit(params);
    const W = u[u.length - 1][0] - u[0][0];
    const all = [];
    for (let k = 0; k < count; k++)
      for (let i = (k === 0 ? 0 : 1); i < u.length; i++)   // 중복 끝점 skip
        all.push([u[i][0] + k * W, u[i][1], u[i][2]]);
    return all;
  }
  ```
- 스케일·회전·상하 반전 등 유닛별 변형을 줄 때도 **끝점 z=0 규칙만 지키면** 연결은 유지된다.

---

## 7. 2D 렌더링 (Canvas / SVG)

기본은 `[x, y]` 만 사용(정면도). **Y 뒤집기** 잊지 말 것.

```js
function drawUnit2D(ctx, pts, { originX, originY, scale = 1, lineWidth = 12 }) {
  ctx.lineWidth = lineWidth; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.beginPath();
  pts.forEach(([x, y], i) => {
    const sx = originX + x * scale, sy = originY - y * scale; // y 뒤집기
    i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy);
  });
  ctx.stroke();
}
```

**교차부 over/under 표현** — 2D에선 두 가닥이 겹친다. 입체감을 주려면 z로 앞/뒤를 구분:
- 점 순서대로 그리되, 교차 지점에서 **뒤 가닥(z가 작은 쪽)**을 먼저 그리고 **앞 가닥(z 큰 쪽)**을 위에 덧그린다.
- 더 확실히: 앞 가닥이 지나갈 때 뒤 가닥에 배경색으로 짧은 간격(gap)을 내면 "위로 지나감"이 보인다.
- z 값(`pts[i][2]`)은 이미 각 점에 있으므로, 교차 구간에서 z 부호로 레이어를 나누면 된다.

SVG로 쓸 경우 `pts` 를 `path d="M … L …"`(y 뒤집어) 문자열로 변환. 라인 그라디언트는 `stroke`에 `linearGradient` 적용.

---

## 8. 3D 렌더링 (Three.js — TubeGeometry)

Three.js는 Y-up 이라 좌표 그대로 사용.

```js
import * as THREE from 'three';

function buildTube(pts, { radius = 30, radialSegments = 24 } = {}) {
  const v = pts.map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const curve = new THREE.CatmullRomCurve3(v, false, 'centripetal');
  const geo = new THREE.TubeGeometry(curve, pts.length, radius, radialSegments, false);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.1 });
  return new THREE.Mesh(geo, mat);
}
```

- **튜브 반지름**: 교차 z간격 `≈ depth×0.43` 보다 작게. 기본 depth=220 → 간격 ≈95 → **반지름 ≤ ~40** 이면 교차부에서 겹치지 않는다. 더 두꺼우면 `depth`를 키울 것.
- 끝을 뾰족하게(연필 흑심 등) 하려면 `TubeGeometry` 대신 반지름을 경로 파라미터 `s`에 따라 변조하는 커스텀 지오메트리를 쓰거나, 양 끝 `radius→0` 로 테이퍼.
- 여러 유닛: §6 `tile()` 로 이은 점들을 하나의 curve로 만들면 연속 튜브. 또는 유닛 Mesh를 `W` 간격으로 인스턴싱.
- 조명: `DirectionalLight` + `AmbientLight`. z 깊이가 있으므로 살짝 측면광이 교차부 입체감을 살린다.

---

## 9. 자기검증 (구현 후 반드시 확인)

`generateUnit()` 를 **기본값**으로 호출한 뒤:

| 항목 | 기대값(±소수 오차) |
|------|------|
| `pts.length` | 600 |
| 왼끝 `pts[0]` | `[-170.58, -71.28, 0]` |
| 오른끝 `pts[599]` | `[ 170.58, -71.28, 0]` |
| 좌우 대칭 | `pts[0].x ≈ -pts[599].x`, 같은 y, z=0 |
| 유닛 폭 W | `≈ 341.03` |
| 고리 최상단 y | `≈ 220` |
| 교차부 z 간격 | `≈ 95` |

이 값이 나오면 포팅이 정확한 것이다. (검증 스크립트: `node`에서 위 함수 호출 → 끝점/폭 출력.)

---

## 10. 제너레이터(아트) 설계 — 변주 축

무엇을 랜덤/슬라이더로 노출할지. 괄호는 **안전 범위**.

### 10.1 곡선 형태
| 파라미터 | 범위 | 효과 |
|----------|------|------|
| `R` | 80 ~ 140 | 고리 크기 |
| `cy` | 100 ~ 160 | 교차점 높이 |
| `beta` | 46 ~ 64 | 꼬리 폭/기울기 |
| `Ltail` | 240 ~ 420 | 고리 간격·유닛 폭 |
| `ep` | 1.0 ~ 2.5 | 골짜기 둥긂 ↔ 평평 |
| `depth` | 120 ~ 300 | z 깊이(3D감·sweep 여유) |

### 10.2 타일링·배치
- 유닛 개수, 유닛별 **스케일 지터**(0.85~1.15), 미세 **회전**, **상하 반전**(고리가 아래로), 베이스라인 웨이브.
- 규칙: 끝점 z=0 유지 → 연결 보장. 스케일을 바꾸면 이웃과 폭(W)이 달라지니 **각 유닛의 실제 끝점으로 이어붙일 것**(오프셋을 W 고정이 아니라 endpoint-to-endpoint로).

### 10.3 컬러·머티리얼
- `s`(0→1) 따라 라인 그라디언트, 팔레트 스와핑, 배경/블렌드.
- 라인 두께 변조(속도·곡률 기반), 3D는 메탈/러프니스·환경맵.

### 10.4 애니메이션
- **Draw-on**: 호길이 비율로 점 개수를 늘려 그려지는 연출.
- 흐름(flow): 타일 오프셋을 시간에 따라 스크롤 → 무한히 흐르는 리본.
- 깊이 호흡: `depth` 를 sin으로 미세 변조, 전체 회전.

---

## 11. 통합 순서 제안 (Antigravity / Claude Code)

1. `generateUnit()` 포팅 → §9 자기검증 통과 확인.
2. `tile()` + 2D Canvas 뷰(§7)로 형태·연결 눈으로 확인.
3. Three.js 튜브(§8)로 3D 뷰 추가, 반지름·depth 관계 확인.
4. 파라미터를 UI(슬라이더/랜덤 시드)로 노출(§10) → 제너레이터 완성.
5. 컬러/애니메이션 레이어.

---

## 부록 A. 원본 C4D Python (참조)

동일 알고리즘. 웹 포팅의 진실 소스(단, C4D는 Y-up, 대칭 보정은 JS에만 추가했으니 필요시 Python에도 §4-6 대칭식 적용).

```python
# R=100, cy=120, beta=56, Ltail=300, ep=1.0, depth=220, sigma=12, N=600
# 1) 접점 QR,QL  2) 꼬리 heading 180+beta→180 / -beta→0 로 적분
# 3) 왼꼬리(rev)+호(-90+beta..270-beta)+오른꼬리  4) 균일 재샘플
# 5) 곡률 가우시안 스무딩 후 재적분  6) z = depth*s*(1-s^2)^2  (s=-1..1)
```

(전체 파이썬 코드는 대화 마지막 버전을 그대로 사용. JS(§5)가 1:1 포팅이다.)
