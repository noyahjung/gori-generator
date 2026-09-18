/**
 * Gori Generator — 글자 외곽선을 따라 리본 고리가 이어지며 그려지는 제너레이터.
 *
 * 파이프라인
 *  1) Outline.textContours : 텍스트 → 닫힌 윤곽(래스터 px, 법선 = 잉크 바깥)
 *  2) buildUnit            : generateUnit() → (u, v, z) 정규화 + 다운샘플
 *  3) buildLayout          : 윤곽마다 유닛 개수를 정수로 맞춰(끝점이 정확히 닫힘) 배치 준비
 *  4) render               : 유닛을 윤곽 위로 워핑 — 윤곽 = 베이스라인, 법선 = 유닛의 y축
 */
(function () {
  const { generateUnit, normalizeUnit } = window.Ribbon;
  const { textContours, smoothClosed, normalsOf } = window.Outline;

  // ───────────────────────── 설정 ─────────────────────────
  const FONTS = [
    { name: 'Black Han Sans', weights: [400] },
    { name: 'Noto Sans KR', weights: [300, 500, 700, 900] },
    { name: 'Noto Serif KR', weights: [400, 700, 900] },
    { name: 'Do Hyeon', weights: [400] },
    { name: 'Jua', weights: [400] },
    { name: 'Gowun Batang', weights: [400, 700] },
    { name: 'Nanum Pen Script', weights: [400] },
    { name: 'Archivo Black', weights: [400] },
    { name: 'Playfair Display', weights: [400, 700, 900] },
    { name: 'Pacifico', weights: [400] },
    { name: 'Bungee', weights: [400] },
  ];

  const PALETTES = {
    paper:  { label: 'Paper',  bg: '#f2eee6', c: ['#161616', '#c8412f', '#2d5f8b'] },
    ink:    { label: 'Ink',    bg: '#121212', c: ['#f3efe6', '#e0b25a', '#8fb3c9'] },
    candy:  { label: 'Candy',  bg: '#fff3ea', c: ['#ff5a5f', '#ffb400', '#00a6a6'] },
    neon:   { label: 'Neon',   bg: '#0a0a12', c: ['#00e5ff', '#ff2bd6', '#fff200'] },
    ocean:  { label: 'Ocean',  bg: '#0d1b2a', c: ['#8ecae6', '#ffb703', '#fb8500'] },
    forest: { label: 'Forest', bg: '#e8e9de', c: ['#1f3d2b', '#5a8f3c', '#c9a227'] },
    blush:  { label: 'Blush',  bg: '#1c1a1b', c: ['#ffc2d1', '#fb6f92', '#ffe5ec'] },
  };

  const S = {
    text: '고리', font: 'Black Han Sans', weight: 400, tracking: 0.02, smooth: 3,
    size: 8, height: 1.0, dir: 'out', follow: 0.5,
    R: 100, cy: 120, beta: 56, Ltail: 300, ep: 1.0, depth: 220,
    lw: 2.2, gap: 2.0, depthWidth: 0.35, depthShade: 0.3,
    palette: 'paper', bg: '#f2eee6', c1: '#161616', c2: '#c8412f', c3: '#2d5f8b', colorMode: 'solid',
    anim: 'drawflow', order: 'parallel', speed: 6, flowSpeed: 0.35, pen: true, guide: false,
  };

  // 컨트롤 스키마: [key, type, label, ...]
  const GROUPS = [
    ['텍스트', [
      { k: 'text', t: 'textarea', label: '글자 (줄바꿈 가능)' },
      { k: 'font', t: 'select', label: '폰트', options: FONTS.map(f => [f.name, f.name]), rebuild: 'outline' },
      { k: 'weight', t: 'select', label: '굵기', options: [], rebuild: 'outline' },
      { k: 'tracking', t: 'range', label: '자간', min: -0.1, max: 0.6, step: 0.01, rebuild: 'outline' },
      { k: 'smooth', t: 'range', label: '윤곽 부드럽게', min: 0, max: 20, step: 0.5, rebuild: 'outline' },
    ]],
    ['고리 배치', [
      { k: 'size', t: 'range', label: '고리 크기', min: 4, max: 40, step: 0.5, unit: '%', rebuild: 'layout' },
      { k: 'height', t: 'range', label: '고리 높이', min: 0.3, max: 2, step: 0.05, rebuild: 'layout' },
      { k: 'dir', t: 'select', label: '방향', options: [['out', '바깥으로'], ['in', '안쪽으로'], ['alt', '번갈아']], rebuild: 'layout' },
      { k: 'follow', t: 'range', label: '윤곽 밀착도', min: 0, max: 1, step: 0.05, rebuild: 'layout' },
    ]],
    ['고리 형태', [
      { k: 'R', t: 'range', label: '고리 반지름 R', min: 80, max: 140, step: 1, rebuild: 'unit' },
      { k: 'cy', t: 'range', label: '교차 높이 cy', min: 100, max: 160, step: 1, rebuild: 'unit' },
      { k: 'beta', t: 'range', label: '꼬리 각도 β', min: 46, max: 64, step: 0.5, rebuild: 'unit' },
      { k: 'Ltail', t: 'range', label: '꼬리 길이', min: 240, max: 420, step: 5, rebuild: 'unit' },
      { k: 'ep', t: 'range', label: '골짜기 평평함', min: 1, max: 2.5, step: 0.05, rebuild: 'unit' },
      { k: 'depth', t: 'range', label: '깊이 (z)', min: 120, max: 300, step: 5, rebuild: 'unit' },
    ]],
    ['선', [
      { k: 'lw', t: 'range', label: '두께', min: 0.4, max: 14, step: 0.1 },
      { k: 'gap', t: 'range', label: '교차 틈 (over/under)', min: 0, max: 8, step: 0.1 },
      { k: 'depthWidth', t: 'range', label: '깊이→두께', min: 0, max: 0.9, step: 0.05 },
      { k: 'depthShade', t: 'range', label: '깊이→명암', min: 0, max: 0.9, step: 0.05 },
    ]],
    ['색', [
      { k: 'palette', t: 'select', label: '팔레트', options: Object.entries(PALETTES).map(([k, p]) => [k, p.label]) },
      { k: 'colorMode', t: 'select', label: '칠하기', options: [['solid', '단색'], ['gradient', '윤곽 그라디언트'], ['unit', '고리마다'], ['letter', '윤곽마다']] },
      { k: 'colors', t: 'colors', label: '배경 · 색 1 · 2 · 3' },
    ]],
    ['애니메이션', [
      { k: 'anim', t: 'select', label: '모드', options: [['drawflow', '그리기 → 흐르기'], ['draw', '그리기'], ['flow', '흐르기'], ['static', '정지']] },
      { k: 'order', t: 'select', label: '그리는 순서', options: [['parallel', '모든 윤곽 동시에'], ['sequential', '윤곽 하나씩']] },
      { k: 'speed', t: 'range', label: '그리기 속도 (고리/초)', min: 1, max: 40, step: 0.5 },
      { k: 'flowSpeed', t: 'range', label: '흐르기 속도', min: -2, max: 2, step: 0.05 },
      { k: 'pen', t: 'check', label: '펜 끝 표시' },
      { k: 'guide', t: 'check', label: '글자 윤곽 가이드' },
    ]],
  ];

  // ───────────────────────── 상태 ─────────────────────────
  let OUT = null;     // textContours 결과
  let UNIT = null;    // 정규화 유닛
  let LAY = null;     // 레이아웃(윤곽별 배치)
  let drawT = 0;      // 그리기 진행 (고리 수)
  let phase = 0;      // 흐르기 위상 (고리 수)
  let playing = true;
  let dirty = true;

  const M = 150; // 렌더용 유닛 해상도

  // ───────────────────────── 1) 유닛 ─────────────────────────
  function buildUnit() {
    const pts = generateUnit({ R: S.R, cy: S.cy, beta: S.beta, Ltail: S.Ltail, ep: S.ep, depth: S.depth });
    const nu = normalizeUnit(pts);
    // M개로 다운샘플 (sigma가 N=600 인덱스 기준이라 원본 해상도로 생성 후 추림)
    const idx = []; for (let i = 0; i < M; i++) idx.push(Math.round(i * (nu.N - 1) / (M - 1)));
    const u = new Float64Array(M), v = new Float64Array(M), z = new Float64Array(M);
    let zMax = 1e-9, arc = 0;
    idx.forEach((j, i) => { u[i] = nu.u[j]; v[i] = nu.v[j]; z[i] = nu.z[j]; zMax = Math.max(zMax, Math.abs(z[i])); });
    for (let i = 1; i < M; i++) arc += Math.hypot(u[i] - u[i - 1], v[i] - v[i - 1]);
    const zn = z.map(q => q / zMax);
    const cross = Math.round(nu.cross * (M - 1) / (nu.N - 1));
    UNIT = { u, v, zn, cross, maxV: nu.maxV, arc };
  }

  // ───────────────────────── 2) 윤곽 ─────────────────────────
  let outlineReq = 0;
  async function buildOutline() {
    const req = ++outlineReq;
    const fontSpec = `${S.weight} 300px "${S.font}"`;
    try { await document.fonts.load(fontSpec, S.text || ' '); } catch (e) { /* 폴백 폰트 사용 */ }
    if (req !== outlineReq) return;
    OUT = textContours(S.text || ' ', { font: S.font, weight: S.weight, tracking: S.tracking, smooth: S.smooth });
    buildLayout();
  }

  // ───────────────────────── 3) 레이아웃 ─────────────────────────
  function buildLayout() {
    if (!OUT || !UNIT) return;
    const target = (S.size / 100) * OUT.em;          // 유닛 폭(래스터 px)
    const Hh = target * S.height;                    // 유닛 높이 스케일
    const frameSigma = Math.max(1, Hh * (1 - S.follow) * 0.9);
    const reach = UNIT.maxV * Hh;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const cs = OUT.contours.map((c, ci) => {
      // 실제 길이 재측정 (스무딩으로 약간 줄어듦)
      let L = 0;
      for (let i = 0; i < c.n; i++) { const j = (i + 1) % c.n; L += Math.hypot(c.x[j] - c.x[i], c.y[j] - c.y[i]); }
      const h = L / c.n;
      // 법선용 프레임: 고리 크기에 비례해 더 부드럽게 → 고리가 뒤틀리지 않음
      const fx = smoothClosed(c.x, c.n, frameSigma / h), fy = smoothClosed(c.y, c.n, frameSigma / h);
      const { nx, ny } = normalsOf(fx, fy, c.n);
      // 방향 일관성: 원래 곡선 기준 법선과 같은 쪽으로
      const base = normalsOf(c.x, c.y, c.n);
      let dot = 0; for (let i = 0; i < c.n; i++) dot += nx[i] * base.nx[i] + ny[i] * base.ny[i];
      if (dot < 0) for (let i = 0; i < c.n; i++) { nx[i] = -nx[i]; ny[i] = -ny[i]; }
      let n = Math.max(2, Math.round(L / target));
      if (S.dir === 'alt' && n % 2) n += 1;
      for (let i = 0; i < c.n; i++) {
        for (const sgn of [-1, 1]) {
          const use = S.dir === 'alt' || (S.dir === 'out' ? sgn > 0 : sgn < 0);
          const r = use ? reach * sgn : 0;
          const px = c.x[i] + nx[i] * r, py = c.y[i] + ny[i] * r;
          if (px < minX) minX = px; if (px > maxX) maxX = px;
          if (py < minY) minY = py; if (py > maxY) maxY = py;
        }
      }
      return { x: c.x, y: c.y, nx, ny, cn: c.n, L, h, n, l: L / n, ci,
               buf: new Float32Array(n * M * 2) };
    });
    const total = cs.reduce((s, c) => s + c.n, 0);
    LAY = { cs, target, Hh, total, maxN: Math.max(1, ...cs.map(c => c.n)),
            bbox: { minX, minY, maxX, maxY } };
    dirty = true;
  }

  // 윤곽 위 호길이 a 에서의 위치/법선 (선형 보간, 순환)
  function sample(c, a, out) {
    let s = (a / c.h) % c.cn; if (s < 0) s += c.cn;
    const i0 = Math.floor(s), i1 = (i0 + 1) % c.cn, f = s - i0;
    out[0] = c.x[i0] + (c.x[i1] - c.x[i0]) * f;
    out[1] = c.y[i0] + (c.y[i1] - c.y[i0]) * f;
    let nx = c.nx[i0] + (c.nx[i1] - c.nx[i0]) * f, ny = c.ny[i0] + (c.ny[i1] - c.ny[i0]) * f;
    const l = Math.hypot(nx, ny) || 1;
    out[2] = nx / l; out[3] = ny / l;
  }

  // 유닛들을 윤곽 위로 워핑 → c.buf (래스터 좌표)
  const tmp = [0, 0, 0, 0];
  function warp(c) {
    const { u, v } = UNIT, Hh = LAY.Hh, off = phase * c.l;
    for (let k = 0; k < c.n; k++) {
      const dir = S.dir === 'out' ? 1 : S.dir === 'in' ? -1 : (k % 2 ? -1 : 1);
      const base = k * M * 2;
      for (let i = 0; i < M; i++) {
        sample(c, (k + u[i]) * c.l + off, tmp);
        const d = v[i] * Hh * dir;
        c.buf[base + i * 2] = tmp[0] + tmp[2] * d;
        c.buf[base + i * 2 + 1] = tmp[1] + tmp[3] * d;
      }
    }
  }

  // ───────────────────────── 색 ─────────────────────────
  const hex2rgb = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const css = c => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
  let COL = null;
  function buildColors() { COL = { bg: hex2rgb(S.bg), c: [S.c1, S.c2, S.c3].map(hex2rgb) }; dirty = true; }

  function baseColor(c, k, uMid) {
    const P = COL.c;
    switch (S.colorMode) {
      case 'unit': return P[(k + c.ci) % P.length];
      case 'letter': return P[c.ci % P.length];
      case 'gradient': {
        let t = ((k + uMid + phase) / c.n) % 1; if (t < 0) t += 1;
        const pos = t * P.length, j = Math.floor(pos), f = pos - j;
        const e = f * f * (3 - 2 * f);
        return mix(P[j % P.length], P[(j + 1) % P.length], e);
      }
      default: return P[0];
    }
  }

  // ───────────────────────── 4) 렌더 ─────────────────────────
  /**
   * 한 유닛을 그린다. pts: 화면 좌표 배열, m: 보이는 점 개수.
   * 교차부는 앞 가닥(z>0)이 지나갈 때 주변을 지워(destination-out) over/under 틈을 만든다.
   */
  function drawUnit(g, c, k, P, m, lw, gap, svg) {
    const { zn, u, cross } = UNIT;
    const effects = S.colorMode === 'gradient' || S.depthWidth > 0 || S.depthShade > 0;
    const CH = effects ? 4 : M;
    const styleAt = (i) => {
      let col = baseColor(c, k, u[i]);
      if (S.depthShade > 0) col = mix(col, COL.bg, S.depthShade * (1 - zn[i]) * 0.5);
      return { col: css(col), w: lw * (1 + S.depthWidth * zn[i]) };
    };
    const strokeRange = (i0, i1, cap) => {
      for (let s = i0; s < i1; s += CH) {
        const e = Math.min(i1, s + CH), st = styleAt((s + e) >> 1);
        g.path(P, s, e, st.col, st.w, cap);
      }
    };
    strokeRange(0, m - 1, 'round');

    // over/under: 앞 가닥이 교차부를 지나간 뒤에 틈을 낸다
    if (gap > 0 && cross > 0) {
      const st = styleAt(cross);
      const half = 1.6 * (st.w / 2 + gap) + st.w * 0.5;
      const unitArcPx = UNIT.arc * LAY.target * g.scale;
      const win = Math.max(2, Math.ceil(half / (unitArcPx / (M - 1))));
      const a = Math.max(1, cross - win), b = Math.min(M - 2, cross + win);
      if (m - 1 >= b) {
        g.erase(P, a, b, st.w + gap * 2);
        strokeRange(a, b, 'butt');
      }
    }
  }

  // Canvas 백엔드
  function canvasBackend(ctx, scale) {
    return {
      scale,
      path(P, i0, i1, col, w, cap) {
        ctx.beginPath(); ctx.moveTo(P[i0 * 2], P[i0 * 2 + 1]);
        for (let i = i0 + 1; i <= i1; i++) ctx.lineTo(P[i * 2], P[i * 2 + 1]);
        ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = cap; ctx.lineJoin = 'round';
        ctx.stroke();
      },
      erase(P, i0, i1, w) {
        ctx.save(); ctx.globalCompositeOperation = 'destination-out';
        this.path(P, i0, i1, '#000', w, 'butt'); ctx.restore();
      },
    };
  }

  // SVG 백엔드 (틈은 배경색 스트로크로)
  function svgBackend(parts, scale) {
    const f = v => v.toFixed(2);
    return {
      scale,
      path(P, i0, i1, col, w, cap) {
        let d = `M${f(P[i0 * 2])} ${f(P[i0 * 2 + 1])}`;
        for (let i = i0 + 1; i <= i1; i++) d += `L${f(P[i * 2])} ${f(P[i * 2 + 1])}`;
        parts.push(`<path d="${d}" stroke="${col}" stroke-width="${f(w)}" stroke-linecap="${cap}"/>`);
      },
      erase(P, i0, i1, w) { this.path(P, i0, i1, S.bg, w, 'butt'); },
    };
  }

  function fit(W, H) {
    const b = LAY.bbox, pad = Math.min(W, H) * 0.07;
    const bw = b.maxX - b.minX, bh = b.maxY - b.minY;
    const scale = Math.min((W - pad * 2) / bw, (H - pad * 2) / bh);
    return { scale, ox: (W - bw * scale) / 2 - b.minX * scale, oy: (H - bh * scale) / 2 - b.minY * scale };
  }

  // 윤곽별 보이는 고리 수
  function visibleUnits() {
    const cs = LAY.cs;
    if (S.anim === 'flow' || S.anim === 'static') return cs.map(c => c.n);
    if (S.order === 'parallel') {
      const p = Math.min(1, drawT / LAY.maxN);
      return cs.map(c => c.n * p);
    }
    let left = drawT;
    return cs.map(c => { const v = Math.max(0, Math.min(c.n, left)); left -= c.n; return v; });
  }

  function isDrawDone() {
    if (S.anim === 'flow' || S.anim === 'static') return true;
    return S.order === 'parallel' ? drawT >= LAY.maxN : drawT >= LAY.total;
  }

  function renderInto(g, W, H, ctxForGuide, full) {
    const { scale, ox, oy } = fit(W, H);
    const lw = S.lw * scale, gap = S.gap * scale;
    const vis = full ? LAY.cs.map(c => c.n) : visibleUnits();
    const P = new Float32Array(M * 2);
    const pens = [];

    if (S.guide && ctxForGuide) {
      // 글자 면을 옅게 채워 형태 참고용으로 표시
      ctxForGuide.save();
      ctxForGuide.fillStyle = css(mix(COL.bg, COL.c[0], 0.08));
      ctxForGuide.beginPath();
      for (const c of LAY.cs) {
        for (let i = 0; i < c.cn; i++) {
          const x = ox + c.x[i] * scale, y = oy + c.y[i] * scale;
          i ? ctxForGuide.lineTo(x, y) : ctxForGuide.moveTo(x, y);
        }
        ctxForGuide.closePath();
      }
      ctxForGuide.fill('evenodd');
      ctxForGuide.restore();
    }

    LAY.cs.forEach((c, idx) => {
      const vu = vis[idx]; if (vu <= 0) return;
      warp(c);
      const nFull = Math.floor(vu), frac = vu - nFull;
      for (let k = 0; k < Math.min(c.n, nFull + 1); k++) {
        const m = k < nFull ? M : Math.floor(frac * M);
        if (m < 2) continue;
        const base = k * M * 2;
        for (let i = 0; i < M; i++) {
          P[i * 2] = ox + c.buf[base + i * 2] * scale;
          P[i * 2 + 1] = oy + c.buf[base + i * 2 + 1] * scale;
        }
        drawUnit(g, c, k, P, m, lw, gap);
        if (k === nFull && S.pen && !full) {
          const col = baseColor(c, k, UNIT.u[m - 1]);
          pens.push([P[(m - 1) * 2], P[(m - 1) * 2 + 1], css(col), lw]);
        }
      }
    });
    return pens;
  }

  // ───────────────────────── 캔버스 / 루프 ─────────────────────────
  const stage = document.getElementById('stage');
  const cv = document.getElementById('cv');
  const ctx = cv.getContext('2d');
  let dpr = 1, CW = 0, CH_ = 0;

  function resize() {
    const r = stage.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    CW = Math.max(10, r.width); CH_ = Math.max(10, r.height);
    cv.width = Math.round(CW * dpr); cv.height = Math.round(CH_ * dpr);
    cv.style.width = CW + 'px'; cv.style.height = CH_ + 'px';
    dirty = true;
  }
  new ResizeObserver(resize).observe(stage);

  function frame() {
    if (!LAY || !UNIT || !COL) return;
    stage.style.background = S.bg;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const s = fit(CW, CH_).scale;
    const pens = renderInto(canvasBackend(ctx, s), CW, CH_, ctx, false);
    for (const [x, y, col, w] of pens) {
      ctx.beginPath(); ctx.arc(x, y, Math.max(2.5, w * 1.1), 0, Math.PI * 2);
      ctx.fillStyle = col; ctx.fill();
    }
  }

  let last = performance.now();
  function tick(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (LAY && playing) {
      const drawing = (S.anim === 'draw' || S.anim === 'drawflow') && !isDrawDone();
      if (drawing) { drawT += S.speed * dt; dirty = true; }
      const flowing = S.anim === 'flow' || (S.anim === 'drawflow' && isDrawDone());
      if (flowing && S.flowSpeed !== 0) { phase += S.flowSpeed * dt; dirty = true; }
    }
    if (dirty) { dirty = false; frame(); }
    requestAnimationFrame(tick);
  }

  function replay() { drawT = 0; phase = 0; playing = true; dirty = true; syncPlay(); }

  // ───────────────────────── 내보내기 ─────────────────────────
  function stamp() { return new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14); }
  function download(url, name) { const a = document.createElement('a'); a.href = url; a.download = name; a.click(); }

  function exportPNG() {
    const long = 3200, ar = CW / CH_;
    const W = ar >= 1 ? long : Math.round(long * ar), H = ar >= 1 ? Math.round(long / ar) : long;
    const oc = document.createElement('canvas'); oc.width = W; oc.height = H;
    const o = oc.getContext('2d');
    renderInto(canvasBackend(o, fit(W, H).scale), W, H, o, false);
    o.globalCompositeOperation = 'destination-over'; o.fillStyle = S.bg; o.fillRect(0, 0, W, H);
    download(oc.toDataURL('image/png'), `gori_${stamp()}.png`);
  }

  function exportSVG() {
    const W = Math.round(CW), H = Math.round(CH_);
    const parts = [];
    renderInto(svgBackend(parts, fit(W, H).scale), W, H, null, true);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
      + `<rect width="100%" height="100%" fill="${S.bg}"/><g fill="none" stroke-linejoin="round">${parts.join('')}</g></svg>`;
    download(URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })), `gori_${stamp()}.svg`);
  }

  // ───────────────────────── UI ─────────────────────────
  const panel = document.getElementById('controls');
  const inputs = {};
  const fmt = (c, v) => (c.step >= 1 ? String(v) : Number(v).toFixed(c.step < 0.1 ? 2 : 1)) + (c.unit || '');

  function onChange(c) {
    if (c.k === 'palette') { applyPalette(S.palette); }
    if (c.k === 'font') { refreshWeights(); }
    if (c.rebuild === 'unit') { buildUnit(); buildLayout(); }
    else if (c.rebuild === 'layout') buildLayout();
    else if (c.rebuild === 'outline') debounceOutline();
    dirty = true;
  }

  let outlineTimer = 0;
  function debounceOutline() { clearTimeout(outlineTimer); outlineTimer = setTimeout(buildOutline, 120); }

  function buildPanel() {
    for (const [title, items] of GROUPS) {
      const sec = document.createElement('section');
      sec.innerHTML = `<h3>${title}</h3>`;
      for (const c of items) {
        const row = document.createElement('label');
        row.className = 'row ' + c.t;
        if (c.t === 'textarea') {
          row.innerHTML = `<span class="lab">${c.label}</span><textarea rows="2" spellcheck="false"></textarea>`;
          const el = row.querySelector('textarea'); el.value = S.text;
          el.addEventListener('input', () => { S.text = el.value; debounceOutline(); });
          inputs.text = el;
        } else if (c.t === 'range') {
          row.innerHTML = `<span class="lab">${c.label}</span><output></output><input type="range" min="${c.min}" max="${c.max}" step="${c.step}">`;
          const el = row.querySelector('input'), out = row.querySelector('output');
          el.value = S[c.k]; out.textContent = fmt(c, S[c.k]);
          el.addEventListener('input', () => { S[c.k] = parseFloat(el.value); out.textContent = fmt(c, S[c.k]); onChange(c); });
          inputs[c.k] = { el, out, c };
        } else if (c.t === 'select') {
          row.innerHTML = `<span class="lab">${c.label}</span><select></select>`;
          const el = row.querySelector('select');
          c.options.forEach(([v, l]) => el.add(new Option(l, v)));
          el.value = S[c.k];
          el.addEventListener('change', () => { S[c.k] = isNaN(+el.value) ? el.value : +el.value; onChange(c); });
          inputs[c.k] = { el, c };
        } else if (c.t === 'check') {
          row.innerHTML = `<input type="checkbox"><span class="lab">${c.label}</span>`;
          const el = row.querySelector('input'); el.checked = S[c.k];
          el.addEventListener('change', () => { S[c.k] = el.checked; onChange(c); });
          inputs[c.k] = { el, c };
        } else if (c.t === 'colors') {
          row.innerHTML = `<span class="lab">${c.label}</span><div class="swatches">`
            + ['bg', 'c1', 'c2', 'c3'].map(k => `<input type="color" data-k="${k}">`).join('') + '</div>';
          row.querySelectorAll('input').forEach(el => {
            el.value = S[el.dataset.k];
            el.addEventListener('input', () => { S[el.dataset.k] = el.value; buildColors(); });
            inputs[el.dataset.k] = { el };
          });
        }
        sec.appendChild(row);
      }
      panel.appendChild(sec);
    }
  }

  function refreshWeights() {
    const f = FONTS.find(x => x.name === S.font) || FONTS[0];
    const el = inputs.weight.el;
    el.innerHTML = '';
    f.weights.forEach(w => el.add(new Option(String(w), w)));
    if (!f.weights.includes(S.weight)) S.weight = f.weights[f.weights.length - 1];
    el.value = S.weight;
  }

  function applyPalette(key) {
    const p = PALETTES[key]; if (!p) return;
    S.bg = p.bg; [S.c1, S.c2, S.c3] = p.c;
    ['bg', 'c1', 'c2', 'c3'].forEach(k => { if (inputs[k]) inputs[k].el.value = S[k]; });
    buildColors();
  }

  function syncInputs() {
    for (const [k, o] of Object.entries(inputs)) {
      if (k === 'text') { o.value = S.text; continue; }
      if (!o.el) continue;
      if (o.el.type === 'checkbox') o.el.checked = S[k];
      else o.el.value = S[k];
      if (o.out) o.out.textContent = fmt(o.c, S[k]);
    }
  }

  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  function randomize() {
    Object.assign(S, {
      R: Math.round(rnd(80, 140)), cy: Math.round(rnd(100, 160)), beta: +rnd(46, 64).toFixed(1),
      Ltail: Math.round(rnd(240, 420) / 5) * 5, ep: +rnd(1, 2.5).toFixed(2), depth: Math.round(rnd(140, 300) / 5) * 5,
      size: +rnd(7, 22).toFixed(1), height: +rnd(0.7, 1.4).toFixed(2), dir: pick(['out', 'out', 'in', 'alt']),
      follow: +rnd(0.2, 0.8).toFixed(2), lw: +rnd(1.4, 5).toFixed(1), gap: +rnd(0.8, 3.5).toFixed(1),
      palette: pick(Object.keys(PALETTES)), colorMode: pick(['solid', 'gradient', 'unit', 'letter']),
    });
    applyPalette(S.palette);
    syncInputs();
    buildUnit(); buildLayout(); replay();
  }

  const playBtn = document.getElementById('play');
  function syncPlay() { playBtn.textContent = playing ? '일시정지' : '재생'; }
  playBtn.addEventListener('click', () => { playing = !playing; syncPlay(); });
  document.getElementById('replay').addEventListener('click', replay);
  document.getElementById('random').addEventListener('click', randomize);
  document.getElementById('png').addEventListener('click', exportPNG);
  document.getElementById('svg').addEventListener('click', exportSVG);
  document.getElementById('toggle-panel').addEventListener('click', () => document.body.classList.toggle('panel-hidden'));
  window.addEventListener('keydown', (e) => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
    if (e.code === 'Space') { e.preventDefault(); playing = !playing; syncPlay(); }
    if (e.key === 'r' || e.key === 'R') randomize();
    if (e.key === 'Enter') replay();
  });

  // ───────────────────────── 시작 ─────────────────────────
  // URL 파라미터로 초기값 덮어쓰기 (예: ?text=Hello&size=10&palette=neon)
  const q = new URLSearchParams(location.search);
  for (const [k, v] of q) if (k in S) S[k] = typeof S[k] === 'number' ? +v : typeof S[k] === 'boolean' ? v === '1' || v === 'true' : v;
  if (q.has('palette') && !q.has('bg')) { const p = PALETTES[S.palette]; if (p) { S.bg = p.bg; [S.c1, S.c2, S.c3] = p.c; } }

  buildPanel();
  refreshWeights();
  buildColors();
  buildUnit();
  resize();
  buildOutline().then(replay);
  // 웹폰트(특히 한글 subset)는 늦게 도착한다 → 도착하면 윤곽 다시 추출
  document.fonts.addEventListener('loadingdone', debounceOutline);
  requestAnimationFrame(tick);

  window.GoriApp = { S, exportPNG, exportSVG, get LAY() { return LAY; }, get UNIT() { return UNIT; }, replay, randomize,
    setDraw(t) { drawT = t; dirty = true; }, setPhase(p) { phase = p; dirty = true; },
    rebuild() { buildUnit(); buildOutline(); syncInputs(); } };
})();
