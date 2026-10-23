// 复制自 campfire-code/batch-ocr（MIT）的 src/tool/core.ts，去掉了批量导出部分。
// 纯函数：OCR 前后处理（尺寸计算、张量转换、DB 文本框后处理、裁剪矩阵、CTC 解码、阅读顺序），不依赖界面和本机能力。
// 参数与流程参考 RapidOCR（Apache-2.0）/ PaddleOCR（Apache-2.0）的实现。

export type Pt = [number, number];
/** 四个角：左上、右上、右下、左下 */
export type Quad = [Pt, Pt, Pt, Pt];

// ---------- 尺寸 ----------

/** 整图预处理：最长边不超过 maxSide、最短边不小于 minSide，返回缩放比例 */
export function fitScale(w: number, h: number, maxSide = 2000, minSide = 30): number {
  let s = 1;
  if (Math.max(w, h) * s > maxSide) s = maxSide / Math.max(w, h);
  if (Math.min(w, h) * s < minSide) s = minSide / Math.min(w, h);
  return s;
}

/** 检测模型输入尺寸：短边不足 limit 时放大到 limit（limit_type=min），再取 32 的倍数 */
export function detSize(w: number, h: number, limit = 736): { w: number; h: number } {
  const ratio = Math.min(w, h) < limit ? limit / Math.min(w, h) : 1;
  const r32 = (v: number) => Math.max(Math.round(v / 32) * 32, 32);
  return { w: r32(Math.trunc(w * ratio)), h: r32(Math.trunc(h * ratio)) };
}

/** 识别模型输入宽度：高固定 48，宽按比例，至少 320（与 PaddleOCR 一致），最多 maxW；返回张量宽度与实际缩放后的宽度 */
export function recSize(cw: number, ch: number, H = 48, minW = 320, maxW = 1920): { tensorW: number; resizedW: number } {
  const ratio = ch > 0 ? cw / ch : 1;
  const tensorW = Math.min(maxW, Math.max(minW, Math.trunc(H * ratio)));
  const resizedW = Math.max(1, Math.min(tensorW, Math.ceil(H * ratio)));
  return { tensorW, resizedW };
}

/** 方向分类输入：48×192，宽按比例，不足补零 */
export function clsSize(cw: number, ch: number, H = 48, W = 192): number {
  const ratio = ch > 0 ? cw / ch : 1;
  return Math.max(1, Math.min(W, Math.ceil(H * ratio)));
}

/**
 * RGBA 像素 → CHW 张量（BGR 通道顺序，(x/255 − 0.5)/0.5 归一化）。
 * 张量宽 tensorW 可以大于图片宽 w，右侧补 0（与 PaddleOCR 的 padding 一致）。
 */
export function toTensor(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, tensorW = w): Float32Array {
  const plane = tensorW * h;
  const out = new Float32Array(3 * plane);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const o = y * tensorW + x;
      out[o] = rgba[i + 2] / 127.5 - 1;
      out[plane + o] = rgba[i + 1] / 127.5 - 1;
      out[2 * plane + o] = rgba[i] / 127.5 - 1;
    }
  }
  return out;
}

// ---------- 几何 ----------

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** 凸包（单调链），逆时针 */
export function convexHull(points: Pt[]): Pt[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const lower: Pt[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Pt[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

export interface Rect {
  cx: number;
  cy: number;
  /** 沿 angle 方向的边长 */
  w: number;
  h: number;
  /** 弧度 */
  angle: number;
}

/** 最小外接矩形（旋转卡壳：矩形必有一条边与凸包的某条边重合） */
export function minAreaRect(points: Pt[]): Rect {
  const hull = convexHull(points);
  if (hull.length === 0) return { cx: 0, cy: 0, w: 0, h: 0, angle: 0 };
  if (hull.length === 1) return { cx: hull[0][0], cy: hull[0][1], w: 0, h: 0, angle: 0 };
  let best: Rect | null = null;
  let bestArea = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const len = dist(a, b);
    if (len === 0) continue;
    const ux = (b[0] - a[0]) / len;
    const uy = (b[1] - a[1]) / len;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const q of hull) {
      const u = q[0] * ux + q[1] * uy;
      const v = -q[0] * uy + q[1] * ux;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area < bestArea - 1e-9) {
      bestArea = area;
      const cu = (minU + maxU) / 2;
      const cv = (minV + maxV) / 2;
      best = { cx: cu * ux - cv * uy, cy: cu * uy + cv * ux, w: maxU - minU, h: maxV - minV, angle: Math.atan2(uy, ux) };
    }
  }
  return best!;
}

/** 矩形四个角，按 PaddleOCR get_mini_boxes 的规则排成 左上、右上、右下、左下 */
export function rectQuad(r: Rect): Quad {
  const c = Math.cos(r.angle), s = Math.sin(r.angle);
  const hw = r.w / 2, hh = r.h / 2;
  const pts: Pt[] = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([u, v]) => [r.cx + u * c - v * s, r.cy + u * s + v * c] as Pt);
  return orderQuad(pts);
}

export function orderQuad(pts: Pt[]): Quad {
  const p = [...pts].sort((a, b) => a[0] - b[0]);
  const [tl, bl] = p[0][1] <= p[1][1] ? [p[0], p[1]] : [p[1], p[0]];
  const [tr, br] = p[2][1] <= p[3][1] ? [p[2], p[3]] : [p[3], p[2]];
  return [tl, tr, br, bl];
}

/** 点是否在多边形内（射线法） */
export function inPolygon(x: number, y: number, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ---------- DB 后处理 ----------

export interface DetBox {
  quad: Quad;
  score: number;
}

export interface DbOptions {
  thresh: number;
  boxThresh: number;
  unclipRatio: number;
  maxCandidates: number;
  dilate: boolean;
  minSize: number;
}
export const DB_DEFAULTS: DbOptions = { thresh: 0.3, boxThresh: 0.5, unclipRatio: 1.6, maxCandidates: 1000, dilate: true, minSize: 3 };

/** 2×2 膨胀（与 cv2.dilate(kernel=ones(2,2)) 一致：每个像素取自己、左、上、左上的最大值） */
export function dilate2x2(bin: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(bin.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      out[i] = bin[i] | (x > 0 ? bin[i - 1] : 0) | (y > 0 ? bin[i - w] : 0) | (x > 0 && y > 0 ? bin[i - w - 1] : 0);
    }
  }
  return out;
}

/** 8 连通区域，每个区域返回每行最左、最右像素（足够求凸包） */
export function components(bin: Uint8Array, w: number, h: number, max = 1000): Pt[][] {
  const seen = new Uint8Array(bin.length);
  const out: Pt[][] = [];
  const stack: number[] = [];
  for (let start = 0; start < bin.length && out.length < max; start++) {
    if (!bin[start] || seen[start]) continue;
    seen[start] = 1;
    stack.push(start);
    const rows = new Map<number, [number, number]>();
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w, y = (i - x) / w;
      const r = rows.get(y);
      if (!r) rows.set(y, [x, x]);
      else { if (x < r[0]) r[0] = x; if (x > r[1]) r[1] = x; }
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const j = ny * w + nx;
          if (bin[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
        }
      }
    }
    const pts: Pt[] = [];
    for (const [y, [a, b]] of rows) { pts.push([a, y]); if (b !== a) pts.push([b, y]); }
    out.push(pts);
  }
  return out;
}

/** 文本框得分：框内概率均值（score_mode=fast） */
export function boxScore(pred: Float32Array, w: number, h: number, quad: Quad): number {
  const xs = quad.map((p) => p[0]), ys = quad.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(w - 1, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(h - 1, Math.ceil(Math.max(...ys)));
  let sum = 0, n = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (inPolygon(x, y, quad)) { sum += pred[y * w + x]; n++; }
  }
  return n ? sum / n : 0;
}

/**
 * DB 后处理：概率图 → 文本框（坐标换算回原图 srcW×srcH）。
 * 流程同 PaddleOCR：二值化 → 膨胀 → 连通区域 → 最小外接矩形 → 打分过滤 → 按 unclip_ratio 向外扩 → 再次过滤 → 缩放回原图。
 * 对矩形做 unclip 等价于每边外扩 d = 面积 × ratio / 周长。
 */
export function dbPostprocess(pred: Float32Array, pw: number, ph: number, srcW: number, srcH: number, opt: Partial<DbOptions> = {}): DetBox[] {
  const o = { ...DB_DEFAULTS, ...opt };
  let bin: Uint8Array = new Uint8Array(pw * ph);
  for (let i = 0; i < bin.length; i++) bin[i] = pred[i] > o.thresh ? 1 : 0;
  if (o.dilate) bin = dilate2x2(bin, pw, ph);
  const out: DetBox[] = [];
  for (const pts of components(bin, pw, ph, o.maxCandidates)) {
    const r = minAreaRect(pts);
    if (Math.min(r.w, r.h) < o.minSize) continue;
    const score = boxScore(pred, pw, ph, rectQuad(r));
    if (score < o.boxThresh) continue;
    const peri = 2 * (r.w + r.h);
    const d = peri > 0 ? (r.w * r.h * o.unclipRatio) / peri : 0;
    const big: Rect = { ...r, w: r.w + 2 * d, h: r.h + 2 * d };
    if (Math.min(big.w, big.h) < o.minSize + 2) continue;
    const sx = srcW / pw, sy = srcH / ph;
    const quad = rectQuad(big).map(([x, y]) => [
      Math.min(Math.max(Math.round(x * sx), 0), srcW),
      Math.min(Math.max(Math.round(y * sy), 0), srcH),
    ]) as Quad;
    if (dist(quad[0], quad[1]) <= 3 || dist(quad[0], quad[3]) <= 3) continue;
    out.push({ quad, score });
  }
  return out;
}

// ---------- 裁剪 ----------

/**
 * 把文本框裁成水平的小图：返回目标宽高和画布变换矩阵 [a, b, c, d, e, f]（ctx.setTransform 的参数），
 * 使左上→(0,0)、右上→(w,0)、左下→(0,h)。高宽比 ≥ 1.5 时视为竖排，需要再逆时针转 90°（rotate=true）。
 */
export function cropTransform(q: Quad): { w: number; h: number; m: [number, number, number, number, number, number]; rotate: boolean } {
  const [tl, tr, br, bl] = q;
  const w = Math.max(1, Math.trunc(Math.max(dist(tl, tr), dist(bl, br))));
  const h = Math.max(1, Math.trunc(Math.max(dist(tl, bl), dist(tr, br))));
  const ux = tr[0] - tl[0], uy = tr[1] - tl[1];
  const vx = bl[0] - tl[0], vy = bl[1] - tl[1];
  const det = ux * vy - vx * uy || 1e-9;
  // inv([u v]) = 1/det * [[vy, -vx], [-uy, ux]]；L = diag(w, h) * inv
  const a = (w * vy) / det, c = (-w * vx) / det;
  const b = (-h * uy) / det, d = (h * ux) / det;
  const e = -(a * tl[0] + c * tl[1]);
  const f = -(b * tl[0] + d * tl[1]);
  return { w, h, m: [a, b, c, d, e, f], rotate: h / w >= 1.5 };
}

/** 应用 cropTransform 的矩阵（测试用） */
export const applyMatrix = (m: number[], [x, y]: Pt): Pt => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

// ---------- 识别解码 ----------

/** 字典：第 0 位是 CTC 空白，最后加一个空格（use_space_char） */
export function buildCharset(dictText: string): string[] {
  const lines = dictText.replace(/\r/g, '').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return ['', ...lines, ' '];
}

/** CTC 贪心解码：每步取最大概率，去掉连续重复和空白；置信度为保留字符概率的平均值 */
export function ctcDecode(probs: Float32Array | number[], T: number, C: number, charset: string[]): { text: string; score: number } {
  let text = '';
  let sum = 0, n = 0, prev = -1;
  for (let t = 0; t < T; t++) {
    let best = 0, bp = -Infinity;
    const off = t * C;
    for (let c = 0; c < C; c++) { const p = probs[off + c]; if (p > bp) { bp = p; best = c; } }
    if (best !== 0 && best !== prev) {
      text += charset[best] ?? '';
      sum += bp;
      n++;
    }
    prev = best;
  }
  return { text, score: n ? sum / n : 0 };
}

/** 方向分类：第二类（180°）概率超过阈值时需要转 180° */
export const needFlip = (probs: ArrayLike<number>, thresh = 0.9) => probs[1] > probs[0] && probs[1] > thresh;

// ---------- 阅读顺序 ----------

/** 整页倒置时把文本框坐标转 180°（W×H 为页面尺寸），角点顺序仍为左上、右上、右下、左下 */
export function flipQuad(q: Quad, W: number, H: number): Quad {
  return orderQuad(q.map(([x, y]) => [W - x, H - y] as Pt));
}

export interface TextBox {
  quad: Quad;
  text: string;
  score: number;
}
export interface TextLine {
  text: string;
  score: number;
  boxes: TextBox[];
}

const yRange = (q: Quad): [number, number] => [Math.min(...q.map((p) => p[1])), Math.max(...q.map((p) => p[1]))];
const xMin = (q: Quad) => Math.min(...q.map((p) => p[0]));
const xMax = (q: Quad) => Math.max(...q.map((p) => p[0]));

/**
 * 按阅读顺序排成行：先按上沿从上到下，竖直方向重叠超过较矮框一半高度的归为同一行，行内从左到右。
 * 同一行相邻两框间距超过一个字高时用空格隔开。
 */
export function groupLines(boxes: TextBox[]): TextLine[] {
  const sorted = [...boxes].sort((a, b) => yRange(a.quad)[0] - yRange(b.quad)[0] || xMin(a.quad) - xMin(b.quad));
  const lines: { top: number; bottom: number; boxes: TextBox[] }[] = [];
  for (const b of sorted) {
    const [t, btm] = yRange(b.quad);
    const h = btm - t;
    let target: (typeof lines)[number] | undefined;
    for (const l of lines) {
      const overlap = Math.min(btm, l.bottom) - Math.max(t, l.top);
      if (overlap > 0.5 * Math.min(h, l.bottom - l.top)) { target = l; break; }
    }
    if (target) {
      target.boxes.push(b);
      target.top = Math.min(target.top, t);
      target.bottom = Math.max(target.bottom, btm);
    } else lines.push({ top: t, bottom: btm, boxes: [b] });
  }
  lines.sort((a, b) => a.top - b.top);
  return lines.map((l) => {
    const bs = l.boxes.sort((a, b) => xMin(a.quad) - xMin(b.quad));
    let text = '';
    bs.forEach((b, i) => {
      if (i > 0) {
        const gap = xMin(b.quad) - xMax(bs[i - 1].quad);
        const hgt = yRange(b.quad)[1] - yRange(b.quad)[0];
        text += gap > hgt ? ' ' : '';
      }
      text += b.text;
    });
    const chars = bs.reduce((a, b) => a + Math.max(1, b.text.length), 0);
    const score = bs.reduce((a, b) => a + b.score * Math.max(1, b.text.length), 0) / chars;
    return { text, score, boxes: bs };
  });
}
