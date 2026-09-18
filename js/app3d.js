/**
 * Gori Ribbon — 고정된 고리 스플라인(unit_width 340)을 따라 종이띠가 이어지고,
 * 앞면에는 글자, 뒷면에는 그라디언트가 칠해지는 3D 키네틱 타이포 제너레이터.
 *
 * 구조
 *  - 패턴: 고리 유닛을 가로로 잇고 줄을 아래로 반복(홀수 줄은 stagger만큼 어긋남) → 화면 전체를 채움
 *  - 띠: 유닛 1개 = 메쉬 1개 (지오메트리 공유, 위치만 다름). 유닛마다 호길이 시작점 s0를 가짐
 *  - 글자: 텍스트 + 구분자 한 주기를 아틀라스 텍스처에 굽고, 셰이더가 호길이 s로 반복 샘플링(mod)
 *  - 타이핑 반응: 입력한 글자 폭만큼 글자가 띠를 따라 밀려나고(feed), 새 글자가 강조색으로 번쩍임
 *  - 카메라: 직교(투시 없음) + 고정 배율 → 고리 크기가 항상 일정
 *  - 앞/뒤: gl_FrontFacing 으로 앞면=글자, 뒷면=그라디언트
 */
import * as THREE from 'three';

const { generateUnit } = window.Ribbon;
const UW = 340; // 유닛 폭 (C4D 최종본 unit_width)

THREE.ColorManagement.enabled = false; // 평면 그래픽: 입력 색 그대로 출력

// ───────────────────────── 설정 ─────────────────────────
const FONTS = [
  ['SUIT Variable', 'var', 'SUIT Variable'],   // 로컬 가변 폰트 (wght 100–900)
  ['Instrument Serif', 400, 'Nanum Myeongjo'],
  ['Cormorant Garamond', 300, 'Nanum Myeongjo'],
  ['Playfair Display', 400, 'Noto Serif KR'],
  ['Nanum Myeongjo', 400, 'Nanum Myeongjo'],
  ['Noto Serif KR', 300, 'Noto Serif KR'],
  ['Gowun Batang', 400, 'Gowun Batang'],
  ['Noto Sans KR', 300, 'Noto Sans KR'],
  ['Noto Sans KR', 900, 'Noto Sans KR'],
  ['Black Han Sans', 400, 'Black Han Sans'],
  ['Space Grotesk', 400, 'Noto Sans KR'],
  ['IBM Plex Mono', 400, 'Noto Sans KR'],
];
const fontKey = f => `${f[0]}|${f[1]}`;
const isVarFont = () => S.font.endsWith('|var');

const S = {
  text: 'THE LOOP OF GORI ',
  font: 'SUIT Variable|var', weight: 500, sep: '  ✳  ', textScale: 0.8, tracking: 0,
  roundness: 1, width: 40, angle: 55, flip: false,
  loopSize: 180, rowGap: 1.06, stagger: 0.48, rowDepth: 0,
  bg: '#000000', strip: '#000000', ink: '#00ffaa', hl: '#e8452c', back: '#000000', shade: 0.22,
  yaw: 45, pitch: 0, // 고정 카메라 각도(도)
  flowSpeed: 0.08, feed: 1, flash: 0.9,
  wobble: 0.2, wobbleRadius: 38, bounce: 0.45, snap: 30, tension: 4, stiff: 2.4,
  // 가변 굵기 (SUIT Variable)
  varMin: 100, varMax: 900,
  varFlash: 0.6,
};

const GROUPS = [
  ['텍스트', [
    { k: 'text', t: 'textarea', label: '글자' },
    { k: 'font', t: 'select', label: '폰트', options: FONTS.map(f => [fontKey(f), f[1] === 'var' ? `${f[0]} (가변)` : `${f[0]} ${f[1]}`]), rebuild: 'atlas' },
    { k: 'weight', t: 'range', label: '굵기 (wght)', min: 100, max: 900, step: 1, rebuild: 'atlas', varOnly: true },
    { k: 'sep', t: 'select', label: '반복 사이 구분', options: [['   ·   ', '·'], ['     ', '공백'], ['  —  ', '—'], ['  /  ', '/'], ['  ✳  ', '✳'], [' ', '붙여서']], rebuild: 'atlas' },
    { k: 'textScale', t: 'range', label: '글자 크기 (띠 대비)', min: 0.3, max: 1.1, step: 0.01, rebuild: 'atlas' },
    { k: 'tracking', t: 'range', label: '자간', min: -0.05, max: 0.5, step: 0.01, rebuild: 'atlas' },
  ]],
  ['고리', [
    { k: 'roundness', t: 'range', label: '고리 둥글기 (기울기 보정)', min: 0, max: 1.5, step: 0.01, rebuild: 'geo' },
  ]],
  ['띠', [
    { k: 'width', t: 'range', label: '띠 폭', min: 16, max: 90, step: 1, rebuild: 'geo' },
    { k: 'angle', t: 'range', label: '띠 각도 (0 종이띠 ↔ 90 평면)', min: 0, max: 90, step: 1, rebuild: 'geo' },
    { k: 'flip', t: 'check', label: '앞뒤 뒤집기', rebuild: 'geo' },
  ]],
  ['배치', [
    { k: 'loopSize', t: 'range', label: '고리 크기 (px)', min: 60, max: 600, step: 1 },
    { k: 'rowGap', t: 'range', label: '줄 간격', min: 0.7, max: 2, step: 0.01 },
    { k: 'stagger', t: 'range', label: '줄 어긋남', min: 0, max: 1, step: 0.01 },
    { k: 'rowDepth', t: 'range', label: '줄 깊이 이동', min: -1, max: 1, step: 0.01 },
  ]],
  ['색', [
    { k: 'strip', t: 'color', label: '글자 면 (띠 앞면)' },
    { k: 'ink', t: 'color', label: '글자' },
    { k: 'back', t: 'color', label: '반대편 면 (띠 뒷면)' },
    { k: 'hl', t: 'color', label: '새 글자 강조' },
    { k: 'bg', t: 'color', label: '배경' },
    { k: 'shade', t: 'range', label: '음영', min: 0, max: 0.8, step: 0.01 },
  ]],
  ['움직임 · 타이핑 반응', [
    { k: 'flowSpeed', t: 'range', label: '글자 흐름', min: -1, max: 1, step: 0.01 },
    { k: 'feed', t: 'range', label: '타이핑 밀림', min: 0, max: 4, step: 0.05 },
    { k: 'flash', t: 'range', label: '새 글자 강조 시간 (초)', min: 0, max: 3, step: 0.05 },
  ]],
  ['가변 굵기 (Variable)', [
    { k: 'varMin', t: 'range', label: '가장 얇게', min: 100, max: 900, step: 1, rebuild: 'atlas', varOnly: true },
    { k: 'varMax', t: 'range', label: '가장 굵게', min: 100, max: 900, step: 1, rebuild: 'atlas', varOnly: true },
    { k: 'varFlash', t: 'range', label: '새 글자 굵게', min: 0, max: 1, step: 0.01, rebuild: 'varfx', varOnly: true },
  ], true],
  ['마우스 반응', [
    { k: 'wobble', t: 'range', label: '걸림 세기', min: 0, max: 2.5, step: 0.05 },
    { k: 'wobbleRadius', t: 'range', label: '반경 (px)', min: 10, max: 300, step: 1 },
    { k: 'snap', t: 'range', label: '걸렸다 풀리는 거리 (px)', min: 4, max: 120, step: 1 },
    { k: 'tension', t: 'range', label: '끈 텐션 (팽팽함)', min: 0.3, max: 4, step: 0.05 },
    { k: 'stiff', t: 'range', label: '끈 강성 (휘기 어려움)', min: 0, max: 3, step: 0.05 },
    { k: 'bounce', t: 'range', label: '탄력 (튕김 지속)', min: 0, max: 1, step: 0.01 },
  ]],
];

// ───────────────────────── 렌더러 ─────────────────────────
const stage = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
stage.prepend(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -50000, 50000); // 투시 없음
const pivot = new THREE.Group();     // 회전 중심
const content = new THREE.Group();   // 중심 맞춤용 이동
pivot.add(content); scene.add(pivot);
const MAX_TEX = Math.min(8192, renderer.capabilities.maxTextureSize);

// ───────────────────────── 공유 유니폼 / 셰이더 ─────────────────────────
const U = {
  atlas: { value: null },
  segLen: { value: 1 }, flow: { value: 0 },
  ppw: { value: 1 }, totalPx: { value: 1 }, chunkW: { value: 1 }, rowH: { value: 1 }, pad: { value: 0 },
  texH: { value: 1 }, atlasW: { value: 1 }, atlasH: { value: 1 },
  hlA: { value: 0 }, hlB: { value: 0 }, hlAmt: { value: 0 }, hlColor: { value: new THREE.Color() },
  shade: { value: 0 }, backColor: { value: new THREE.Color() },
  stripColor: { value: new THREE.Color() }, inkColor: { value: new THREE.Color() },
  levels: { value: 1 }, chunks: { value: 1 }, tBase: { value: 0 },
  flashBold: { value: 0 },
  disp: { value: null }, cordTex: { value: new THREE.Vector2(1, 1) }, npu: { value: 1 }, worldPerPx: { value: 1 },
};

const vert = /* glsl */`
  uniform sampler2D disp;      // 끈 변위 (화면 px, RG) — 텍스처 행 = 고리 줄, 열 = 줄을 따라간 노드
  uniform vec2 cordTex;
  uniform float npu, rowIdx, unitIdx, worldPerPx;
  varying vec2 vUv; varying vec3 vView;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float xi = unitIdx * npu + clamp(uv.x, 0.0, 1.0) * npu;      // 줄 안에서의 노드 위치
    vec2 tuv = vec2((xi + 0.5) / cordTex.x, (rowIdx + 0.5) / cordTex.y);
    mv.xy += texture2D(disp, tuv).rg * worldPerPx;                // 화면 평면에서 밀기
    vView = mv.xyz;
    gl_Position = projectionMatrix * mv;
  }`;

const frag = /* glsl */`
  uniform sampler2D atlas;
  uniform float s0, segLen, flow, ppw, totalPx, chunkW, rowH, pad, texH, atlasW, atlasH, shade;
  uniform float hlA, hlB, hlAmt;
  uniform float levels, chunks, tBase, flashBold;
  uniform vec3 stripColor, inkColor, hlColor, backColor;
  varying vec2 vUv; varying vec3 vView;
  void main() {
    float s = s0 + vUv.x * segLen - flow;      // 띠 위 호길이 (− 흐름)
    vec3 n = normalize(cross(dFdx(vView), dFdy(vView)));
    float facing = abs(n.z);
    float lit = mix(1.0 - shade, 1.0, facing);
    vec3 col;
    if (gl_FrontFacing) {
      float px = s * ppw;                      // 텍스트 라인 상의 픽셀 위치
      float pw = mod(px, totalPx);
      float c = floor(pw / chunkW);
      float ly = (1.0 - vUv.y) * texH;
      float inHl = step(hlA, pw) * step(pw, hlB);
      // 가변 굵기: 0(가장 얇게)~1(가장 굵게). 기본 굵기 + 방금 친 글자
      float t = tBase + flashBold * hlAmt * inHl;
      float lv = clamp(t, 0.0, 1.0) * (levels - 1.0);
      float l0 = floor(lv), l1 = min(l0 + 1.0, levels - 1.0), fw = lv - l0;
      float ux = (pw - c * chunkW) / atlasW;
      vec2 uv0 = vec2(ux, 1.0 - ((l0 * chunks + c) * rowH + pad + ly) / atlasH);
      vec2 uv1 = vec2(ux, 1.0 - ((l1 * chunks + c) * rowH + pad + ly) / atlasH);
      vec2 uvc = vec2(px / atlasW, 1.0 - (pad + ly) / atlasH);   // 연속 좌표 → 밉맵 경계 아티팩트 방지
      vec2 gx = dFdx(uvc), gy = dFdy(uvc);
      float a = mix(textureGrad(atlas, uv0, gx, gy).a, textureGrad(atlas, uv1, gx, gy).a, fw);
      float hl = hlAmt * inHl;                                   // 방금 입력한 글자 강조
      col = mix(stripColor, mix(inkColor, hlColor, hl), a);
    } else {
      col = backColor;                         // 뒷면: 단색
    }
    gl_FragColor = vec4(col * lit, 1.0);
  }`;

// ───────────────────────── 유닛 띠 지오메트리 ─────────────────────────
let UNIT = null; // { geo, arc }
function buildUnitGeometry() {
  // 기울기 보정: 고리 머리는 x–z로 대각선으로 기울어 있어서 방위각 yaw에서 보면 옆으로 접혀 좁아 보인다.
  // x → x − z·tan(yaw)·roundness 전단(shear)으로 그 성분을 상쇄한다. 아핀 변환이라 직선은 그대로(휘지 않음),
  // 끝점은 z=0 이라 폭 340·이음매 그대로. roundness=1 이면 이 카메라에서 정면도와 같은 비율로 보인다.
  const shear = S.roundness * Math.tan(THREE.MathUtils.degToRad(THREE.MathUtils.clamp(S.yaw, -80, 80)));
  const raw = generateUnit({ unitWidth: UW }).map(([x, y, z]) => [x - z * shear, y, z]);
  const NS = 360;
  const P = [];
  for (let i = 0; i < NS; i++) {
    const p = raw[Math.round(i * (raw.length - 1) / (NS - 1))];
    P.push(new THREE.Vector3(p[0], p[1], p[2]));
  }
  const cum = [0];
  for (let i = 1; i < NS; i++) cum.push(cum[i - 1] + P[i].distanceTo(P[i - 1]));
  const arc = cum[NS - 1];

  const hw = S.width / 2, a = THREE.MathUtils.degToRad(S.angle);
  const Z = new THREE.Vector3(0, 0, 1);
  const pos = new Float32Array(NS * 2 * 3), uv = new Float32Array(NS * 2 * 2), idx = [];
  const T = new THREE.Vector3(), wz = new THREE.Vector3(), wf = new THREE.Vector3(), w = new THREE.Vector3();
  for (let i = 0; i < NS; i++) {
    T.subVectors(P[Math.min(i + 1, NS - 1)], P[Math.max(i - 1, 0)]).normalize();
    wz.copy(Z).addScaledVector(T, -Z.dot(T)).normalize();   // 종이띠: 폭이 깊이(z) 방향
    wf.crossVectors(Z, T).normalize();                      // 평면: 폭이 곡선 평면 안
    w.copy(wz).multiplyScalar(Math.cos(a)).addScaledVector(wf, Math.sin(a)).normalize();
    if (S.flip) w.negate();
    // 양 끝을 T 방향으로 살짝 연장 → 이웃 유닛과 겹쳐 이음매 헤어라인 제거
    const ext = i === 0 ? -0.8 : i === NS - 1 ? 0.8 : 0;
    const p = P[i].clone().addScaledVector(T, ext);
    const u = (cum[i] + ext) / arc;
    // 아래(−w, v=0) / 위(+w, v=1)  → 앞면 법선 = T × w
    pos.set([p.x - w.x * hw, p.y - w.y * hw, p.z - w.z * hw], i * 6);
    pos.set([p.x + w.x * hw, p.y + w.y * hw, p.z + w.z * hw], i * 6 + 3);
    uv.set([u, 0, u, 1], i * 4);
    if (i < NS - 1) {
      const a0 = i * 2, b0 = i * 2 + 1, a1 = i * 2 + 2, b1 = i * 2 + 3;
      idx.push(a0, a1, b1, a0, b1, b0);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  if (UNIT) UNIT.geo.dispose();
  UNIT = { geo, arc, P, cum };
  CORD.restDirty = true;
  U.segLen.value = arc;
  meshes.forEach(m => { m.geometry = geo; });
}

// ───────────────────────── 텍스트 아틀라스 ─────────────────────────
const atlasCanvas = document.createElement('canvas');
const atlasTex = new THREE.CanvasTexture(atlasCanvas);
atlasTex.generateMipmaps = true;
atlasTex.minFilter = THREE.LinearMipmapLinearFilter;
atlasTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
U.atlas.value = atlasTex;
let TEXT = { str: null, pos: [0], ppw: 1, L: 1 };

function fontStack() {
  const f = FONTS.find(x => fontKey(x) === S.font) || FONTS[0];
  const variable = f[1] === 'var';
  return { variable, weight: variable ? S.weight : f[1], css: `"${f[0]}", "${f[2]}", "SUIT Variable", sans-serif`, name: f[0], fb: f[2] };
}
const varEffectsOn = () => S.varFlash > 0;
const varRange = () => { const lo = Math.min(S.varMin, S.varMax); return [lo, Math.max(S.varMin, S.varMax, lo + 1)]; };

let atlasReq = 0;
async function buildAtlas() {
  const req = ++atlasReq;
  const fs = fontStack();
  const body = S.text || ' ';
  const line = body + S.sep;
  // 가변 폰트 + 효과가 켜져 있으면 굵기 9단계를 구워 셰이더에서 섞는다
  const L = fs.variable && varEffectsOn() ? 9 : 1;
  const [wMin, wMax] = varRange();
  const weights = L === 1 ? [fs.weight] : Array.from({ length: L }, (_, l) => Math.round(wMin + (wMax - wMin) * l / (L - 1)));
  try {
    await Promise.all([...new Set(weights)].map(w => document.fonts.load(`${w} 100px "${fs.name}"`, line))
      .concat(document.fonts.load(`${fs.weight} 100px "${fs.fb}"`, line)));
  } catch (e) { /* 폴백 */ }
  if (req !== atlasReq) return; // 더 최신 입력이 처리 중

  const ctx = atlasCanvas.getContext('2d');
  const setFont = (px, w) => {
    ctx.font = `${w} ${px}px ${fs.css}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = fs.variable ? '0px' : `${S.tracking * px}px`;
  };
  // 글자 위치(100px 기준). 가변 폰트는 기본 굵기의 글자 폭으로 칸을 고정 → 굵기가 바뀌어도 글자가 흔들리지 않음
  const chars = [...line];
  setFont(100, fs.weight);
  const pos100 = [0];
  for (let i = 0; i < chars.length; i++) {
    pos100.push(fs.variable ? pos100[i] + ctx.measureText(chars[i]).width + S.tracking * 100
                            : ctx.measureText(chars.slice(0, i + 1).join('')).width);
  }
  const w100 = pos100[chars.length];

  const pad = 4;
  let texH = 192, fontPx, TW, chunks;
  for (;;) {
    fontPx = texH * S.textScale; TW = w100 * fontPx / 100;
    chunks = Math.max(1, Math.ceil(TW / MAX_TEX));
    if (L * chunks * (texH + pad * 2) <= MAX_TEX || texH <= 24) break;
    texH = Math.floor(texH * 0.85);
  }
  const k = fontPx / 100, pos = pos100.map(x => x * k);
  const rowH = texH + pad * 2;
  const atlasW = chunks === 1 ? Math.ceil(TW) + 2 : MAX_TEX, atlasH = L * chunks * rowH;
  atlasCanvas.width = atlasW; atlasCanvas.height = atlasH;
  setFont(fontPx, weights[L - 1]);
  const m = ctx.measureText(line);
  const base = pad + texH / 2 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
  ctx.clearRect(0, 0, atlasW, atlasH);
  ctx.fillStyle = '#fff'; ctx.textBaseline = 'alphabetic';
  for (let l = 0; l < L; l++) {
    setFont(fontPx, weights[l]);
    ctx.textAlign = fs.variable ? 'center' : 'left';
    for (let c = 0; c < chunks; c++) {
      const row = l * chunks + c, x0 = c * atlasW, x1 = x0 + atlasW;
      ctx.save();
      ctx.beginPath(); ctx.rect(0, row * rowH, atlasW, rowH); ctx.clip();
      ctx.translate(-x0, row * rowH);
      if (fs.variable) {
        for (let i = 0; i < chars.length; i++) {
          if (pos[i + 1] + fontPx < x0 || pos[i] - fontPx > x1) continue;
          ctx.fillText(chars[i], (pos[i] + pos[i + 1]) / 2, base);
        }
      } else ctx.fillText(line, 0, base);
      ctx.restore();
    }
  }
  // CanvasTexture 크기가 바뀌면 새 텍스처가 필요
  atlasTex.dispose(); atlasTex.needsUpdate = true;

  const ppw = texH / S.width; // 월드 1 단위당 픽셀
  U.ppw.value = ppw; U.totalPx.value = TW; U.chunkW.value = atlasW; U.rowH.value = rowH; U.pad.value = pad;
  U.texH.value = texH; U.atlasW.value = atlasW; U.atlasH.value = atlasH;
  U.levels.value = L; U.chunks.value = chunks;
  const info = { str: body, pos: pos.slice(0, [...body].length + 1), ppw, L };
  reactToEdit(TEXT, info);
  TEXT = info;
}

function applyColors() {
  U.stripColor.value.set(S.strip); U.inkColor.value.set(S.ink); U.hlColor.value.set(S.hl); U.backColor.value.set(S.back);
  scene.background = new THREE.Color(S.bg);
  stage.style.background = S.bg;
}

// ───────────────────────── 레이아웃: 화면을 채우는 패턴 ─────────────────────────
const meshes = [];
const view = { halfW: 1, halfH: 1 };

// 배율: 화면에서 고리 간격이 loopSize(px)가 되도록 고정 → 글자와 무관하게 고리 크기 일정
function applyOrtho() {
  const r = stage.getBoundingClientRect();
  const colStep = UW * Math.abs(Math.cos(THREE.MathUtils.degToRad(S.yaw))) || UW;
  const pxPerWorld = S.loopSize / colStep;
  view.halfW = r.width / 2 / pxPerWorld; view.halfH = r.height / 2 / pxPerWorld;
  U.worldPerPx.value = 1 / pxPerWorld;
  camera.left = -view.halfW; camera.right = view.halfW; camera.top = view.halfH; camera.bottom = -view.halfH;
  camera.updateProjectionMatrix();
}

function layout() {
  if (!UNIT) return;
  const yaw = THREE.MathUtils.degToRad(S.yaw);
  const colStep = UW * Math.abs(Math.cos(yaw)) || UW, rowStep = S.rowGap * UW;
  const nR = Math.ceil(view.halfH / rowStep) + 2;
  const drift = Math.abs(S.rowDepth * UW * Math.sin(yaw)) * nR;   // 줄 깊이 이동이 화면상 가로로 밀리는 양
  const nK = Math.ceil((view.halfW + drift) / colStep) + 2;
  let g = 0;
  for (let r = -nR; r <= nR; r++) {
    for (let k = -nK; k <= nK; k++, g++) {
      if (!meshes[g]) {
        const mat = new THREE.ShaderMaterial({
          uniforms: { ...U, s0: { value: 0 }, rowIdx: { value: 0 }, unitIdx: { value: 0 } },
          vertexShader: vert, fragmentShader: frag, side: THREE.DoubleSide,
        });
        const m = new THREE.Mesh(UNIT.geo, mat);
        m.frustumCulled = false;
        meshes.push(m); content.add(m);
      }
      const m = meshes[g];
      m.visible = true;
      m.position.set(k * UW + (((r % 2) + 2) % 2) * S.stagger * UW, -r * rowStep, r * S.rowDepth * UW);
      m.material.uniforms.s0.value = (k + r * 0.5) * UNIT.arc;   // 줄마다 글자 위치를 조금씩 다르게
      m.material.uniforms.rowIdx.value = r + nR; m.material.uniforms.unitIdx.value = k + nK;
    }
  }
  cordAlloc(nR * 2 + 1, nK * 2 + 1);
  for (; g < meshes.length; g++) meshes[g].visible = false;
  // 고리 하나의 가운데(가로: 어긋남 절반, 세로: 끝점~꼭대기 가운데)가 화면 중심
  content.position.set(-S.stagger * UW / 2, -(220 - 71) / 2, 0);
}

// ───────────────────────── 타이핑 반응 ─────────────────────────
const react = { feed: 0, feedTarget: 0, hl: 0 };
function reactToEdit(prev, next) {
  if (prev.str === null || prev.str === next.str) return;
  const a = [...prev.str], b = [...next.str];
  let p = 0; while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let q = 0; while (q < a.length - p && q < b.length - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q++;
  const x0 = next.pos[p], x1 = next.pos[b.length - q];
  const delta = next.pos[b.length] / next.ppw - prev.pos[a.length] / prev.ppw;   // 글자 폭 변화(월드 단위)
  react.feedTarget += delta * S.feed;
  if (x1 > x0 && (S.flash > 0 || S.varFlash > 0)) { U.hlA.value = x0; U.hlB.value = x1; react.hl = 1; }
}

// ───────────────────────── 마우스 반응: 탄성 끈 ─────────────────────────
// 고리 한 줄 = 끈 하나. 줄을 따라 노드를 촘촘히 두고(고리당 npu개) 화면 평면 변위를 시뮬레이션한다.
//  - 텐션: 이웃과의 차이(2계 미분)를 줄임 → 튕긴 자리가 파동처럼 끈을 따라 퍼짐
//  - 강성: 굽힘(4계 미분)에 저항 → 꺾이지 않고 매끈하고 단단한 곡선으로 휨
//  - 복원: 제자리로 당기는 약한 스프링 / 탄력: 감쇠가 작을수록 오래 튕김
//  - 걸림: 포인터에 닿은 노드만 포인터 속도로 끌려가다 snap 거리를 넘으면 툭 풀림
const W = { px: 0, py: 0, mdx: 0, mdy: 0, inside: false };
renderer.domElement.addEventListener('pointermove', e => {
  const r = renderer.domElement.getBoundingClientRect();
  const x = e.clientX - r.left, y = r.height - (e.clientY - r.top);   // 아래 기준(y 위 +)
  if (W.inside) { W.mdx += x - W.px; W.mdy += y - W.py; }
  W.px = x; W.py = y; W.inside = true;
});
renderer.domElement.addEventListener('pointerleave', () => { W.inside = false; W.mdx = W.mdy = 0; });

const CORD = { rows: 0, units: 0, npu: 0, len: 0, n: 0, restX: null, restY: null, d: null, v: null, rel: null,
               data: null, tex: null, restDirty: true, asleep: true };

function cordAlloc(rows, units) {
  const npu = Math.max(16, Math.min(72, Math.floor(4096 / units)));
  CORD.restDirty = true;
  if (rows === CORD.rows && units === CORD.units && npu === CORD.npu && CORD.d) return;
  const len = units * npu, n = rows * len;
  Object.assign(CORD, { rows, units, npu, len, n, restX: new Float32Array(n), restY: new Float32Array(n),
    d: new Float32Array(n * 2), v: new Float32Array(n * 2), rel: new Float32Array(n), data: new Uint16Array(n * 2) });
  if (CORD.tex) CORD.tex.dispose();
  CORD.tex = new THREE.DataTexture(CORD.data, len, rows, THREE.RGFormat, THREE.HalfFloatType);
  CORD.tex.minFilter = CORD.tex.magFilter = THREE.LinearFilter;
  CORD.tex.needsUpdate = true;
  U.disp.value = CORD.tex; U.cordTex.value.set(len, rows); U.npu.value = npu;
}

// 각 노드의 제자리 화면 좌표(px) — 카메라·배치가 바뀔 때만 다시 계산
function computeRest() {
  const C = CORD; if (!C.d || !UNIT) return;
  const r = stage.getBoundingClientRect();
  scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
  const { P, cum, arc } = UNIT, loc = [];
  for (let j = 0, q = 0; j < C.npu; j++) {                 // 유닛 중심선을 호길이 균일하게 npu개 샘플
    const t = j / C.npu * arc;
    while (q < cum.length - 2 && cum[q + 1] < t) q++;
    loc.push(P[q].clone().lerp(P[q + 1], (t - cum[q]) / ((cum[q + 1] - cum[q]) || 1)));
  }
  const v3 = new THREE.Vector3();
  for (let row = 0; row < C.rows; row++) {
    for (let u = 0; u < C.units; u++) {
      const mesh = meshes[row * C.units + u];
      for (let j = 0; j < C.npu; j++) {
        v3.copy(loc[j]).applyMatrix4(mesh.matrixWorld).project(camera);
        const i = row * C.len + u * C.npu + j;
        C.restX[i] = (v3.x * 0.5 + 0.5) * r.width; C.restY[i] = (v3.y * 0.5 + 0.5) * r.height;
      }
    }
  }
  C.restDirty = false;
}

function stepCord(dt) {
  const C = CORD; if (!C.d || dt <= 0) return;
  const pvx = W.mdx / dt, pvy = W.mdy / dt; W.mdx = W.mdy = 0;      // 포인터 속도(px/s)
  const moving = W.inside && S.wobble > 0 && (pvx || pvy);
  if (!moving && C.asleep) return;
  const { d, v, rel, restX, restY, len, rows, n } = C;

  // 걸림 (프레임당 한 번)
  const R = S.wobbleRadius, inv2 = 1 / (2 * R * R), reach2 = 9 * R * R;
  const grab = 1 - Math.exp(-30 * dt), snap2 = S.snap * S.snap;
  for (let i = 0; i < n; i++) {
    if (rel[i] > 0) { rel[i] -= dt; continue; }
    if (!moving) continue;
    const dx = restX[i] + d[2 * i] - W.px, dy = restY[i] + d[2 * i + 1] - W.py, r2 = dx * dx + dy * dy;
    if (r2 < reach2) {
      const w = Math.exp(-r2 * inv2) * grab;
      v[2 * i] += (pvx * S.wobble - v[2 * i]) * w; v[2 * i + 1] += (pvy * S.wobble - v[2 * i + 1]) * w;
      if (d[2 * i] * d[2 * i] + d[2 * i + 1] * d[2 * i + 1] > snap2) rel[i] = 0.2;   // 툭 풀림
    }
  }

  // 끈 물리 (노드 단위, 작은 스텝으로 안정적으로)
  const kT = 600 * S.tension, kA = 40 * S.tension, kB = 150 * S.stiff, c = 1 + 14 * (1 - S.bounce);
  const sub = Math.max(1, Math.ceil(dt / 0.0025)), h = dt / sub, maxD = S.loopSize * 0.5;
  for (let it = 0; it < sub; it++) {
    for (let row = 0; row < rows; row++) {
      const b = row * len;
      for (let i = 0; i < len; i++) {
        const i0 = b + i, im1 = b + Math.max(i - 1, 0), im2 = b + Math.max(i - 2, 0);
        const ip1 = b + Math.min(i + 1, len - 1), ip2 = b + Math.min(i + 2, len - 1);
        for (let a = 0; a < 2; a++) {
          const u0 = d[2 * i0 + a], um1 = d[2 * im1 + a], up1 = d[2 * ip1 + a];
          const lap = um1 - 2 * u0 + up1;
          const bih = d[2 * im2 + a] - 4 * um1 + 6 * u0 - 4 * up1 + d[2 * ip2 + a];
          v[2 * i0 + a] += (kT * lap - kB * bih - kA * u0 - c * v[2 * i0 + a]) * h;
        }
      }
    }
    for (let q = 0; q < 2 * n; q += 2) {
      d[q] += v[q] * h; d[q + 1] += v[q + 1] * h;
      const m = d[q] * d[q] + d[q + 1] * d[q + 1];
      if (m > maxD * maxD) { const f = maxD / Math.sqrt(m); d[q] *= f; d[q + 1] *= f; }
    }
  }

  let mx = 0;
  for (let q = 0; q < 2 * n; q++) { mx = Math.max(mx, Math.abs(d[q]), Math.abs(v[q]) * 0.02); C.data[q] = THREE.DataUtils.toHalfFloat(d[q]); }
  C.tex.needsUpdate = true;
  C.asleep = !moving && mx < 0.03;
  if (C.asleep) { d.fill(0); v.fill(0); C.data.fill(0); }
}

function resize() {
  const r = stage.getBoundingClientRect();
  renderer.setSize(r.width, r.height);
  applyOrtho(); layout();
}
new ResizeObserver(resize).observe(stage);

// ───────────────────────── 루프 ─────────────────────────
let flow = 0, t = 0, playing = true, last = performance.now();

function tick(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (playing) { t += dt; flow += S.flowSpeed * UW * dt; }
  // 타이핑 밀림은 부드럽게 따라가고, 강조는 서서히 사라짐
  react.feed += (react.feedTarget - react.feed) * (1 - Math.exp(-dt * 7));
  react.hl = S.flash > 0 ? Math.max(0, react.hl - dt / S.flash) : 0;
  U.flow.value = flow + react.feed;
  U.hlAmt.value = react.hl * react.hl * (3 - 2 * react.hl);
  U.shade.value = S.shade;
  syncVarUniforms();

  // 카메라 고정: 방위각 yaw, 높이각 pitch
  pivot.rotation.set(0, THREE.MathUtils.degToRad(S.yaw), 0);
  const p = THREE.MathUtils.degToRad(S.pitch), d = 10000;
  camera.position.set(0, Math.sin(p) * d, Math.cos(p) * d);
  camera.lookAt(0, 0, 0);
  if (CORD.restDirty) computeRest();
  stepCord(playing ? dt : 0);

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}


// 가변 굵기 유니폼
function syncVarUniforms() {
  const on = isVarFont() && U.levels.value > 1;
  const [wMin, wMax] = varRange();
  U.tBase.value = THREE.MathUtils.clamp((S.weight - wMin) / (wMax - wMin), 0, 1);
  U.flashBold.value = on ? S.varFlash : 0;
}

// ───────────────────────── 내보내기 ─────────────────────────
const stamp = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
function download(url, name) { const a = document.createElement('a'); a.href = url; a.download = name; a.click(); }
function exportPNG() {
  const pr = renderer.getPixelRatio();
  renderer.setPixelRatio(3); renderer.render(scene, camera);
  download(renderer.domElement.toDataURL('image/png'), `gori-ribbon_${stamp()}.png`);
  renderer.setPixelRatio(pr); resize();
}
let rec = null;
function toggleRec() {
  const btn = document.getElementById('rec');
  if (rec) { rec.stop(); return; }
  const stream = renderer.domElement.captureStream(60);
  const type = ['video/webm;codecs=vp9', 'video/webm', 'video/mp4'].find(t => MediaRecorder.isTypeSupported(t));
  const chunks = [];
  rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 16e6 });
  rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  rec.onstop = () => {
    download(URL.createObjectURL(new Blob(chunks, { type })), `gori-ribbon_${stamp()}.${type.includes('mp4') ? 'mp4' : 'webm'}`);
    rec = null; btn.textContent = '녹화 시작'; btn.classList.remove('rec-on');
  };
  rec.start(); btn.textContent = '녹화 중지'; btn.classList.add('rec-on');
}

// ───────────────────────── UI ─────────────────────────
const panel = document.getElementById('controls');
const inputs = {};
const fmt = (c, v) => c.step >= 1 ? String(v) : Number(v).toFixed(2);
let atlasTimer = 0;
const debounceAtlas = () => { clearTimeout(atlasTimer); atlasTimer = setTimeout(buildAtlas, 60); };

let lastFx = null;
function onChange(c) {
  if (c.k === 'font') syncVarUI();
  if (c.rebuild === 'varfx') { const fx = varEffectsOn(); if (fx !== lastFx) { lastFx = fx; debounceAtlas(); } }
  if (c.rebuild === 'atlas') debounceAtlas();
  else if (c.rebuild === 'geo') { buildUnitGeometry(); buildAtlas(); layout(); }
  if (c.k === 'loopSize') applyOrtho();
  if (['loopSize', 'stagger', 'rowGap', 'rowDepth'].includes(c.k)) layout();
}

function buildPanel() {
  for (const [title, items, varSection] of GROUPS) {
    const sec = document.createElement('section');
    sec.innerHTML = `<h3>${title}</h3>`;
    if (varSection) sec.dataset.varOnly = '1';
    for (const c of items) {
      const row = document.createElement('label');
      row.className = 'row ' + c.t;
      if (c.varOnly) row.dataset.varOnly = '1';
      if (c.t === 'textarea') {
        row.innerHTML = `<span class="lab">${c.label}</span><textarea rows="3" spellcheck="false"></textarea>`;
        const el = row.querySelector('textarea'); el.value = S.text;
        // 타이핑은 즉시 반영(디바운스 없음) — 반응이 바로 보이도록
        el.addEventListener('input', () => { S.text = el.value.replace(/\n/g, ' '); buildAtlas(); });
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
        el.addEventListener('change', () => { S[c.k] = el.value; onChange(c); });
      } else if (c.t === 'check') {
        row.innerHTML = `<input type="checkbox"><span class="lab">${c.label}</span>`;
        const el = row.querySelector('input'); el.checked = S[c.k];
        el.addEventListener('change', () => { S[c.k] = el.checked; onChange(c); });
      } else if (c.t === 'color') {
        row.innerHTML = `<span class="lab">${c.label}</span><input type="color">`;
        const el = row.querySelector('input'); el.value = S[c.k];
        el.addEventListener('input', () => { S[c.k] = el.value; applyColors(); });
      }
      sec.appendChild(row);
    }
    panel.appendChild(sec);
  }
}

// 가변 폰트가 아닐 때는 가변 전용 항목을 숨김
function syncVarUI() {
  const v = isVarFont();
  panel.querySelectorAll('[data-var-only]').forEach(el => { el.style.display = v ? '' : 'none'; });
}

const playBtn = document.getElementById('play');
function syncPlay() { playBtn.textContent = playing ? '일시정지' : '재생'; }
playBtn.addEventListener('click', () => { playing = !playing; syncPlay(); });
document.getElementById('png').addEventListener('click', exportPNG);
document.getElementById('rec').addEventListener('click', toggleRec);

// 설정 복사: 현재 값 전체를 태그가 붙은 JSON으로 클립보드에 → Claude에게 붙여넣으면 기본값으로 반영
async function copySettings() {
  const btn = document.getElementById('copy');
  const text = '[Gori Ribbon 설정] 아래 값을 js/app3d.js 의 기본값(S)으로 반영해줘\n'
    + '```json\n' + JSON.stringify(S, null, 2) + '\n```';
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch (e) {
    const ta = document.createElement('textarea');           // 클립보드 API가 막힌 환경용 폴백
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
    ta.remove();
  }
  btn.textContent = ok ? '복사됨 ✓' : '복사 실패';
  btn.classList.toggle('copied', ok);
  setTimeout(() => { btn.textContent = '설정 복사'; btn.classList.remove('copied'); }, 1600);
}
document.getElementById('copy').addEventListener('click', copySettings);
document.getElementById('toggle-panel').addEventListener('click', () => document.body.classList.toggle('panel-hidden'));
// 작품을 클릭하면 바로 타이핑할 수 있게 글자 입력칸에 포커스 (패널을 접어도 동작, 한글 IME 포함)
renderer.domElement.addEventListener('pointerdown', () => {
  const el = inputs.text; if (!el) return;
  setTimeout(() => { el.focus({ preventScroll: true }); el.setSelectionRange(el.value.length, el.value.length); }, 0);
});
window.addEventListener('keydown', e => {
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
  if (e.code === 'Space') { e.preventDefault(); playing = !playing; syncPlay(); }
});

// ───────────────────────── 시작 ─────────────────────────
const q = new URLSearchParams(location.search);
for (const [k, v] of q) if (k in S) S[k] = typeof S[k] === 'number' ? +v : typeof S[k] === 'boolean' ? (v === '1' || v === 'true') : v;

buildPanel();
syncVarUI();
lastFx = varEffectsOn();
applyColors();
buildUnitGeometry();
resize();
buildAtlas();
layout();
document.fonts.addEventListener('loadingdone', debounceAtlas);
requestAnimationFrame(tick);

window.GoriRibbon = { S, U, react, W, CORD, stepCord, copySettings, layout, buildAtlas, buildUnitGeometry, applyColors, meshCount: () => meshes.filter(m => m.visible).length };
