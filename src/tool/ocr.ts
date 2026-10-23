// 复制自 campfire-code/batch-ocr（MIT）的 src/tool/ocr.ts。
// OCR 流程：在应用内用 onnxruntime-web（WASM，单线程）跑 PaddleOCR 的 PP-OCRv4 移动版模型（取自 RapidOCR 发布的 ONNX 版本），离线可用。
// 检测（DB）→ 裁出每个文本框 →（可选）方向分类 → 识别（CTC）→ 按阅读顺序排成行。
import * as ort from 'onnxruntime-web/wasm';
import { buildCharset, clsSize, cropTransform, ctcDecode, dbPostprocess, detSize, fitScale, flipQuad, groupLines, needFlip, recSize, toTensor, type TextBox, type TextLine } from './ocr-core';
import wasmUrl from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url';
import mjsUrl from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url';

// 推理引擎文件随应用打包，离线可用
ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: mjsUrl };
ort.env.wasm.numThreads = 1;

const MODELS = {
  det: '/models/ch_PP-OCRv4_det_mobile.onnx',
  rec: '/models/ch_PP-OCRv4_rec_mobile.onnx',
  cls: '/models/ch_ppocr_mobile_v2.0_cls_mobile.onnx',
};
const sessions: Partial<Record<keyof typeof MODELS, Promise<ort.InferenceSession>>> = {};
const getSession = (k: keyof typeof MODELS) =>
  (sessions[k] ??= ort.InferenceSession.create(MODELS[k], { executionProviders: ['wasm'], graphOptimizationLevel: 'all' }).catch((e) => {
    delete sessions[k];
    throw new Error(`识别模型加载失败：${e instanceof Error ? e.message : e}`);
  }));

let charset: Promise<string[]> | null = null;
const getCharset = () =>
  (charset ??= fetch('/models/ppocr_keys_v1.txt').then(async (r) => {
    if (!r.ok) throw new Error('字典文件加载失败');
    return buildCharset(await r.text());
  }).catch((e) => { charset = null; throw e; }));

const canvas = (w: number, h: number) => Object.assign(document.createElement('canvas'), { width: w, height: h });
const ctx2d = (c: HTMLCanvasElement) => c.getContext('2d', { willReadFrequently: true })!;

async function decode(bytes: Uint8Array): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    throw new Error('无法识别这张图片，可能已损坏或格式不受支持');
  } finally {
    URL.revokeObjectURL(url);
  }
  return img;
}

async function run(k: keyof typeof MODELS, data: Float32Array, dims: number[]) {
  const s = await getSession(k);
  const r = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', data, dims) });
  return r[s.outputNames[0]];
}

/** 把一个文本框裁成水平小图（竖排的转 90°） */
function crop(src: HTMLCanvasElement, quad: TextBox['quad']): HTMLCanvasElement {
  const t = cropTransform(quad);
  const c = canvas(t.w, t.h);
  const g = ctx2d(c);
  g.setTransform(...t.m);
  g.drawImage(src, 0, 0);
  if (!t.rotate) return c;
  // 逆时针转 90°（同 np.rot90）
  const r = canvas(t.h, t.w);
  const rg = ctx2d(r);
  rg.translate(0, t.w);
  rg.rotate(-Math.PI / 2);
  rg.drawImage(c, 0, 0);
  return r;
}

function rotate180(c: HTMLCanvasElement): HTMLCanvasElement {
  const r = canvas(c.width, c.height);
  const g = ctx2d(r);
  g.translate(c.width, c.height);
  g.rotate(Math.PI);
  g.drawImage(c, 0, 0);
  return r;
}

/** 缩放到 h=48、宽 resizedW，转成宽 tensorW 的张量（右侧补零） */
function lineTensor(c: HTMLCanvasElement, resizedW: number, tensorW: number): Float32Array {
  const s = canvas(resizedW, 48);
  const g = ctx2d(s);
  g.imageSmoothingQuality = 'high';
  g.drawImage(c, 0, 0, resizedW, 48);
  return toTensor(g.getImageData(0, 0, resizedW, 48).data, resizedW, 48, tensorW);
}

export interface OcrOptions {
  useCls: boolean;
  /** 低于这个置信度的文本框丢弃 */
  minScore: number;
}

export interface OcrResult {
  lines: TextLine[];
  width: number;
  height: number;
}

export async function recognize(bytes: Uint8Array, opt: OcrOptions, progress: (r: number) => void = () => {}, signal?: AbortSignal): Promise<OcrResult> {
  const img = await decode(bytes);
  const W0 = img.naturalWidth, H0 = img.naturalHeight;
  if (Math.min(W0, H0) < 8) throw new Error(`图片太小（${W0}×${H0}）`);
  // 1. 整图限制在最长边 2000 像素内
  const s = fitScale(W0, H0);
  const W = Math.round(W0 * s), H = Math.round(H0 * s);
  const full = canvas(W, H);
  const fg = ctx2d(full);
  fg.fillStyle = '#FFFFFF';
  fg.fillRect(0, 0, W, H); // 透明 PNG 垫白底
  fg.drawImage(img, 0, 0, W, H);
  progress(0.05);

  // 2. 检测文本框
  const ds = detSize(W, H);
  const dc = canvas(ds.w, ds.h);
  const dg = ctx2d(dc);
  dg.drawImage(full, 0, 0, ds.w, ds.h);
  const detOut = await run('det', toTensor(dg.getImageData(0, 0, ds.w, ds.h).data, ds.w, ds.h), [1, 3, ds.h, ds.w]);
  const boxes = dbPostprocess(detOut.data as Float32Array, ds.w, ds.h, W, H);
  progress(0.3);
  const chars = await getCharset();

  // 3. 逐个文本框识别
  const texts: TextBox[] = [];
  let flipped = 0;
  for (let i = 0; i < boxes.length; i++) {
    if (signal?.aborted) throw new Error('已暂停');
    let c = crop(full, boxes[i].quad);
    if (opt.useCls) {
      const cw = clsSize(c.width, c.height);
      const out = await run('cls', lineTensor(c, cw, 192), [1, 3, 48, 192]);
      if (needFlip(out.data as Float32Array)) { c = rotate180(c); flipped++; }
    }
    const rs = recSize(c.width, c.height);
    const out = await run('rec', lineTensor(c, rs.resizedW, rs.tensorW), [1, 3, 48, rs.tensorW]);
    const [, T, C] = out.dims;
    const r = ctcDecode(out.data as Float32Array, T, C, chars);
    if (r.text.trim() && r.score >= opt.minScore) texts.push({ quad: boxes[i].quad, text: r.text.trim(), score: r.score });
    progress(0.3 + (0.7 * (i + 1)) / boxes.length);
  }
  // 大部分文字都是倒着的：整页倒置，阅读顺序也要倒过来
  if (flipped * 2 > boxes.length) for (const t of texts) t.quad = flipQuad(t.quad, W, H);
  // 坐标换回原图，方便以后标框
  const back = (v: number) => Math.round(v / s);
  for (const t of texts) t.quad = t.quad.map(([x, y]) => [back(x), back(y)]) as TextBox['quad'];
  return { lines: groupLines(texts), width: W0, height: H0 };
}
