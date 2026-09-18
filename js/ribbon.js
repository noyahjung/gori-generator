/**
 * Ribbon loop unit (고리 유닛) — RIBBON_HANDOFF.md §5 포팅.
 * 좌표: x=가로, y=세로(위 +), z=깊이. 끝점 z=0, 좌우 대칭.
 */
(function (root) {
  function generateUnit(p = {}) {
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
    //    unitWidth 지정 시 폭이 정확히 그 값이 되도록 x·y·z 균일 스케일 (C4D 최종본과 동일)
    const xw = (X2[N - 1] - X2[0]);
    const sc = p.unitWidth ? p.unitWidth / xw : 1;
    const out = [];
    for (let i = 0; i < N; i++) {
      const s = 2 * i / (N - 1) - 1;
      const x = (X2[i] - X2[N - 1 - i]) / 2;
      const y = (Y2[i] + Y2[N - 1 - i]) / 2;
      const z = depth * s * (1 - s * s) ** 2;
      out.push([x * sc, y * sc, z * sc]);
    }
    return out;
  }

  /**
   * 유닛을 "베이스라인 로컬 좌표"로 정규화.
   * u: 0..1 (왼끝→오른끝), v: 베이스라인(끝점 높이)으로부터의 높이 / W, z: depth / W.
   * cross: 앞 가닥이 교차부를 지나는 인덱스 (over/under 표현용).
   */
  function normalizeUnit(pts) {
    const N = pts.length;
    const x0 = pts[0][0], y0 = pts[0][1];
    const W = pts[N - 1][0] - x0;
    const u = new Float64Array(N), v = new Float64Array(N), z = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      u[i] = (pts[i][0] - x0) / W;
      v[i] = (pts[i][1] - y0) / W;
      z[i] = pts[i][2] / W;
    }
    // 뒤쪽 절반에서 x가 음→양으로 0을 지나는 지점 = 앞 가닥의 교차 위치
    let cross = -1;
    for (let i = Math.floor(N / 2) + 1; i < N; i++) {
      if (pts[i - 1][0] < 0 && pts[i][0] >= 0) { cross = i; break; }
    }
    let maxV = 0; for (let i = 0; i < N; i++) maxV = Math.max(maxV, v[i]);
    return { N, W, u, v, z, cross, maxV };
  }

  function tile(count, params) {
    const u = generateUnit(params);
    const W = u[u.length - 1][0] - u[0][0];
    const all = [];
    for (let k = 0; k < count; k++)
      for (let i = (k === 0 ? 0 : 1); i < u.length; i++)
        all.push([u[i][0] + k * W, u[i][1], u[i][2]]);
    return all;
  }

  const api = { generateUnit, normalizeUnit, tile };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Ribbon = api;
})(typeof window !== 'undefined' ? window : globalThis);
