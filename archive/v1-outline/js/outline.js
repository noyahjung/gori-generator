/**
 * 텍스트 → 외곽선(닫힌 윤곽) 추출.
 * 글자를 오프스크린 캔버스에 래스터화한 뒤 marching squares로 윤곽을 추적한다.
 * 폰트 파일 파싱이 필요 없어서 한글 포함 어떤 웹폰트든 동작한다.
 * 좌표는 래스터 픽셀(화면 좌표, y 아래 +).
 */
(function (root) {
  const EM = 300;   // 래스터 폰트 크기(px). 모든 길이 파라미터의 기준 단위.
  const PAD = 60;

  function rasterize(text, opt) {
    const lines = text.split('\n');
    const font = `${opt.weight || 400} ${EM}px "${opt.font}", sans-serif`;
    const cv = document.createElement('canvas');
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const setup = () => {
      ctx.font = font;
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'center';
      if ('letterSpacing' in ctx) ctx.letterSpacing = `${(opt.tracking || 0) * EM}px`;
    };
    setup();
    const lineH = EM * (opt.leading || 1.15);
    let maxW = 1, asc = EM * 0.8, desc = EM * 0.25;
    for (const ln of lines) {
      const m = ctx.measureText(ln || ' ');
      maxW = Math.max(maxW, m.width);
      asc = Math.max(asc, m.actualBoundingBoxAscent || 0);
      desc = Math.max(desc, m.actualBoundingBoxDescent || 0);
    }
    cv.width = Math.ceil(maxW + PAD * 2 + Math.abs(opt.tracking || 0) * EM * 2);
    cv.height = Math.ceil(asc + desc + lineH * (lines.length - 1) + PAD * 2);
    setup(); // 캔버스 크기 변경 시 컨텍스트 상태가 초기화된다
    ctx.fillStyle = '#000';
    lines.forEach((ln, i) => ctx.fillText(ln, cv.width / 2, PAD + asc + i * lineH));
    const img = ctx.getImageData(0, 0, cv.width, cv.height).data;
    const alpha = new Uint8Array(cv.width * cv.height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = img[i * 4 + 3];
    return { alpha, w: cv.width, h: cv.height };
  }

  /** marching squares: 알파 마스크 → 닫힌 폴리라인 목록 (서브픽셀 보간) */
  function trace(alpha, w, h) {
    const val = (x, y) => alpha[y * w + x] - 127.5;
    const H = (x, y) => (y * w + x) * 2, V = (x, y) => (y * w + x) * 2 + 1;
    const adj = new Map();
    const link = (e1, e2) => {
      let a = adj.get(e1); if (!a) adj.set(e1, a = []); a.push(e2);
      let b = adj.get(e2); if (!b) adj.set(e2, b = []); b.push(e1);
    };
    for (let y = 0; y < h - 1; y++) {
      for (let x = 0; x < w - 1; x++) {
        const a = val(x, y), b = val(x + 1, y), c = val(x + 1, y + 1), d = val(x, y + 1);
        const idx = (a > 0 ? 8 : 0) | (b > 0 ? 4 : 0) | (c > 0 ? 2 : 0) | (d > 0 ? 1 : 0);
        if (idx === 0 || idx === 15) continue;
        const T = H(x, y), R = V(x + 1, y), B = H(x, y + 1), L = V(x, y);
        switch (idx) {
          case 1: case 14: link(L, B); break;
          case 2: case 13: link(B, R); break;
          case 3: case 12: link(L, R); break;
          case 4: case 11: link(T, R); break;
          case 6: case 9: link(T, B); break;
          case 7: case 8: link(T, L); break;
          case 5: {
            if ((a + b + c + d) > 0) { link(T, L); link(B, R); } else { link(T, R); link(L, B); }
            break;
          }
          case 10: {
            if ((a + b + c + d) > 0) { link(T, R); link(L, B); } else { link(T, L); link(B, R); }
            break;
          }
        }
      }
    }
    const pos = (e) => {
      const cell = e >> 1, x = cell % w, y = (cell - x) / w;
      if (e & 1) { const f0 = val(x, y), f1 = val(x, y + 1); return [x, y + f0 / (f0 - f1)]; }
      const f0 = val(x, y), f1 = val(x + 1, y); return [x + f0 / (f0 - f1), y];
    };
    const seen = new Set(), loops = [];
    for (const start of adj.keys()) {
      if (seen.has(start)) continue;
      const loop = []; let prev = -1, cur = start, guard = 0;
      while (guard++ < 1e6) {
        seen.add(cur); loop.push(pos(cur));
        const nb = adj.get(cur);
        const next = nb[0] !== prev ? nb[0] : nb[1];
        if (next === undefined || next === start) break;
        prev = cur; cur = next;
        if (seen.has(cur)) break;
      }
      if (loop.length > 8) loops.push(loop);
    }
    return loops;
  }

  function resampleClosed(pts, spacing) {
    const n0 = pts.length, cum = new Float64Array(n0 + 1);
    for (let i = 0; i < n0; i++) {
      const p = pts[i], q = pts[(i + 1) % n0];
      cum[i + 1] = cum[i] + Math.hypot(q[0] - p[0], q[1] - p[1]);
    }
    const L = cum[n0], n = Math.max(12, Math.round(L / spacing));
    const x = new Float64Array(n), y = new Float64Array(n);
    let j = 0;
    for (let i = 0; i < n; i++) {
      const t = (i / n) * L;
      while (j < n0 - 1 && cum[j + 1] < t) j++;
      const p = pts[j], q = pts[(j + 1) % n0], seg = cum[j + 1] - cum[j];
      const f = seg > 0 ? (t - cum[j]) / seg : 0;
      x[i] = p[0] + f * (q[0] - p[0]); y[i] = p[1] + f * (q[1] - p[1]);
    }
    return { x, y, n, L };
  }

  /** 닫힌 곡선 가우시안 스무딩 (sigma: 샘플 단위) */
  function smoothClosed(src, n, sigma) {
    if (sigma < 0.5) return Float64Array.from(src);
    const rd = Math.min(Math.floor(n / 2) - 1, Math.ceil(sigma * 3));
    const ker = []; let ws = 0;
    for (let t = -rd; t <= rd; t++) { const v = Math.exp(-0.5 * (t / sigma) ** 2); ker.push(v); ws += v; }
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let acc = 0;
      for (let m = -rd; m <= rd; m++) acc += ker[m + rd] * src[((i + m) % n + n) % n];
      out[i] = acc / ws;
    }
    return out;
  }

  function normalsOf(x, y, n) {
    const nx = new Float64Array(n), ny = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n, b = (i + 1) % n;
      const tx = x[b] - x[a], ty = y[b] - y[a], l = Math.hypot(tx, ty) || 1;
      nx[i] = ty / l; ny[i] = -tx / l;
    }
    return { nx, ny };
  }

  function reverseArr(a) { return Float64Array.from(a).reverse(); }

  /**
   * @returns {{contours: Array, w:number, h:number, em:number}}
   * contour: { x, y (스무딩된 위치), n, L, h(샘플 간격) } — 법선 기준 "잉크 바깥"이 +가 되도록 방향 정렬됨.
   */
  function textContours(text, opt = {}) {
    const { alpha, w, h } = rasterize(text, opt);
    const loops = trace(alpha, w, h);
    const spacing = 1.5;
    const inside = (px, py) => {
      const xi = Math.round(px), yi = Math.round(py);
      if (xi < 0 || yi < 0 || xi >= w || yi >= h) return false;
      return alpha[yi * w + xi] > 127;
    };
    const contours = [];
    for (const lp of loops) {
      const r = resampleClosed(lp, spacing);
      if (r.L < EM * 0.06) continue; // 노이즈 제거
      let x = smoothClosed(r.x, r.n, (opt.smooth || 0) / spacing);
      let y = smoothClosed(r.y, r.n, (opt.smooth || 0) / spacing);
      // 법선이 잉크 바깥을 향하도록 진행 방향 정렬
      let { nx, ny } = normalsOf(x, y, r.n);
      let votes = 0;
      const step = Math.max(1, Math.floor(r.n / 40));
      for (let i = 0; i < r.n; i += step) {
        const out = inside(x[i] + nx[i] * 3, y[i] + ny[i] * 3);
        const inn = inside(x[i] - nx[i] * 3, y[i] - ny[i] * 3);
        votes += (inn && !out) ? 1 : (out && !inn) ? -1 : 0;
      }
      if (votes < 0) { x = reverseArr(x); y = reverseArr(y); }
      // 시작점: 좌상단에 가장 가까운 점 (그려지는 시작 위치 통일)
      let si = 0, best = Infinity;
      for (let i = 0; i < r.n; i++) { const s = x[i] + y[i] * 1.2; if (s < best) { best = s; si = i; } }
      const rx = new Float64Array(r.n), ry = new Float64Array(r.n);
      for (let i = 0; i < r.n; i++) { rx[i] = x[(i + si) % r.n]; ry[i] = y[(i + si) % r.n]; }
      let minX = Infinity; for (let i = 0; i < r.n; i++) minX = Math.min(minX, rx[i]);
      contours.push({ x: rx, y: ry, n: r.n, L: r.L, h: r.L / r.n, minX });
    }
    contours.sort((a, b) => a.minX - b.minX);
    return { contours, w, h, em: EM };
  }

  root.Outline = { textContours, smoothClosed, normalsOf, EM };
})(window);
