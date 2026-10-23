import { describe, expect, it } from 'vitest';
import {
  applyMatrix, boxScore, buildCharset, clsSize, components, convexHull, cropTransform, ctcDecode, dbPostprocess, detSize, dilate2x2,
  fitScale, flipQuad, groupLines, inPolygon, minAreaRect, needFlip, orderQuad, recSize, rectQuad, toTensor,
  type Quad, type TextBox,
} from './ocr-core';

const close = (a: number[], b: number[], eps = 1e-6) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], -Math.log10(eps)));

describe('尺寸', () => {
  it('最长边超过 2000 时缩小，太小时放大', () => {
    expect(fitScale(4000, 3000)).toBe(0.5);
    expect(fitScale(800, 600)).toBe(1);
    expect(fitScale(20, 10)).toBe(3);
  });
  it('检测尺寸：短边放大到 736 后取 32 的倍数', () => {
    expect(detSize(1000, 520)).toEqual({ w: 1408, h: 736 });
    expect(detSize(1920, 1080)).toEqual({ w: 1920, h: 1088 });
    expect(detSize(10, 10)).toEqual({ w: 736, h: 736 });
  });
  it('识别尺寸：高 48，宽至少 320，长行按比例，超长封顶', () => {
    expect(recSize(100, 48)).toEqual({ tensorW: 320, resizedW: 100 });
    expect(recSize(960, 48)).toEqual({ tensorW: 960, resizedW: 960 });
    expect(recSize(1000, 30)).toEqual({ tensorW: 1600, resizedW: 1600 });
    expect(recSize(10000, 10)).toEqual({ tensorW: 1920, resizedW: 1920 });
  });
  it('方向分类宽度不超过 192', () => {
    expect(clsSize(100, 48)).toBe(100);
    expect(clsSize(1000, 48)).toBe(192);
  });
});

describe('张量', () => {
  it('RGBA 转 CHW、BGR 顺序、归一化到 -1~1，右侧补 0', () => {
    const px = new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]); // 红、蓝 两个像素
    const t = toTensor(px, 2, 1, 3);
    expect(Array.from(t)).toEqual([-1, 1, 0, -1, -1, 0, 1, -1, 0]);
  });
});

describe('几何', () => {
  it('凸包去掉内部点', () => {
    expect(convexHull([[0, 0], [2, 0], [1, 1], [2, 2], [0, 2]])).toHaveLength(4);
  });
  it('最小外接矩形：水平矩形', () => {
    const r = minAreaRect([[0, 0], [10, 0], [10, 4], [0, 4], [5, 2]]);
    expect(r.w * r.h).toBeCloseTo(40);
    expect([r.cx, r.cy]).toEqual([5, 2]);
  });
  it('最小外接矩形：旋转 30° 的矩形能还原面积和角度', () => {
    const a = Math.PI / 6;
    const pts: [number, number][] = [[-10, -3], [10, -3], [10, 3], [-10, 3]].map(([u, v]) => [50 + u * Math.cos(a) - v * Math.sin(a), 40 + u * Math.sin(a) + v * Math.cos(a)]);
    const r = minAreaRect(pts);
    expect(r.w * r.h).toBeCloseTo(120);
    expect(Math.max(r.w, r.h)).toBeCloseTo(20);
    close([r.cx, r.cy], [50, 40]);
  });
  it('四个角排成 左上、右上、右下、左下', () => {
    expect(orderQuad([[10, 5], [0, 0], [0, 5], [10, 0]])).toEqual([[0, 0], [10, 0], [10, 5], [0, 5]]);
    const q = rectQuad({ cx: 5, cy: 2, w: 10, h: 4, angle: 0 });
    expect(q).toEqual([[0, 0], [10, 0], [10, 4], [0, 4]]);
  });
  it('点在多边形内', () => {
    const q: Quad = [[0, 0], [10, 0], [10, 10], [0, 10]];
    expect(inPolygon(5, 5, q)).toBe(true);
    expect(inPolygon(11, 5, q)).toBe(false);
  });
  it('整页倒置时坐标转 180°', () => {
    expect(flipQuad([[0, 0], [10, 0], [10, 5], [0, 5]], 100, 50)).toEqual([[90, 45], [100, 45], [100, 50], [90, 50]]);
  });
});

describe('裁剪矩阵', () => {
  it('把倾斜的框映射成水平小图', () => {
    const q: Quad = [[10, 20], [110, 30], [109, 50], [9, 40]];
    const t = cropTransform(q);
    expect(t.w).toBe(100);
    expect(t.h).toBe(20);
    close(applyMatrix(t.m, q[0]), [0, 0]);
    close(applyMatrix(t.m, q[1]), [t.w, 0], 1e-1);
    close(applyMatrix(t.m, q[3]), [0, t.h], 1e-1);
    expect(t.rotate).toBe(false);
  });
  it('高宽比 ≥ 1.5 的框视为竖排', () => {
    expect(cropTransform([[0, 0], [20, 0], [20, 60], [0, 60]]).rotate).toBe(true);
  });
});

describe('DB 后处理', () => {
  it('2×2 膨胀向右下扩一格', () => {
    const b = new Uint8Array(9); b[4] = 1;
    expect(Array.from(dilate2x2(b, 3, 3))).toEqual([0, 0, 0, 0, 1, 1, 0, 1, 1]);
  });
  it('8 连通：对角相连算一个区域', () => {
    const b = new Uint8Array([1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0]);
    expect(components(b, 4, 4)).toHaveLength(2);
  });
  it('框内平均概率', () => {
    const pred = new Float32Array(100).fill(0.8);
    expect(boxScore(pred, 10, 10, [[2, 2], [7, 2], [7, 7], [2, 7]])).toBeCloseTo(0.8);
  });
  it('两块文字区域 → 两个外扩后的框，坐标换算回原图；低分噪点被丢弃', () => {
    const w = 64, h = 32;
    const pred = new Float32Array(w * h);
    const fill = (x0: number, y0: number, x1: number, y1: number, v: number) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) pred[y * w + x] = v; };
    fill(4, 4, 40, 11, 0.9);
    fill(4, 20, 20, 27, 0.9);
    fill(50, 20, 52, 22, 0.35); // 噪点：超过二值化阈值但得分低于 0.5
    const boxes = dbPostprocess(pred, w, h, 128, 64);
    expect(boxes).toHaveLength(2);
    const top = boxes.find((b) => b.quad[0][1] < 20)!;
    // 原区域像素中心 4..40 × 4..11，膨胀后 4..41 × 4..12（宽 37 高 8），外扩 d=37*8*1.6/90≈5.26，再 ×2 换回原图
    expect(top.quad[0][0]).toBeGreaterThanOrEqual(0);
    expect(top.quad[0][0]).toBeLessThan(4);
    expect(top.quad[1][0]).toBeGreaterThan(90);
    expect(top.quad[2][1]).toBeGreaterThan(30);
    expect(top.score).toBeGreaterThan(0.8);
  });
  it('空白概率图没有框', () => {
    expect(dbPostprocess(new Float32Array(100), 10, 10, 10, 10)).toEqual([]);
  });
});

describe('CTC 解码', () => {
  const charset = buildCharset('篝\n火\n2\n');
  it('字典：首位空白、末尾加空格', () => {
    expect(charset).toEqual(['', '篝', '火', '2', ' ']);
  });
  it('去掉连续重复与空白；被空白隔开的重复字保留；置信度为平均值', () => {
    // 时间步最大类：1 1 0 2 2 0 3 0 3
    const idx = [1, 1, 0, 2, 2, 0, 3, 0, 3];
    const p = [0.9, 0.7, 0.99, 0.8, 0.6, 0.99, 0.5, 0.99, 0.7];
    const probs = idx.flatMap((k, t) => Array.from({ length: 5 }, (_, c) => (c === k ? p[t] : (1 - p[t]) / 4)));
    const r = ctcDecode(probs, 9, 5, charset);
    expect(r.text).toBe('篝火22');
    expect(r.score).toBeCloseTo((0.9 + 0.8 + 0.5 + 0.7) / 4);
  });
  it('全是空白时为空串、置信度 0', () => {
    expect(ctcDecode([1, 0, 0, 0, 0], 1, 5, charset)).toEqual({ text: '', score: 0 });
  });
  it('方向分类阈值 0.9', () => {
    expect(needFlip([0.05, 0.95])).toBe(true);
    expect(needFlip([0.15, 0.85])).toBe(false);
  });
});

describe('阅读顺序', () => {
  const box = (x: number, y: number, w: number, h: number, text: string, score = 0.9): TextBox => ({ quad: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], text, score });
  it('同一行的框从左到右，行从上到下；略有高低差也算同一行；间距大于字高用空格隔开', () => {
    const lines = groupLines([box(300, 105, 100, 30, '右边'), box(10, 10, 200, 40, '标题'), box(10, 100, 100, 30, '左边'), box(115, 102, 50, 30, '中间')]);
    expect(lines.map((l) => l.text)).toEqual(['标题', '左边中间 右边']);
  });
  it('行置信度按字数加权', () => {
    const [l] = groupLines([box(0, 0, 10, 10, 'ab', 1), box(100, 0, 10, 10, 'c', 0.7)]);
    expect(l.score).toBeCloseTo(0.9);
  });
});
