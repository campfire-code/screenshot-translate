// 纯函数：把 OCR 识别出的行整理成段落、拼翻译请求、解析大模型回复、生成复制文本。不依赖界面和本机能力。
import type { TextLine } from './ocr-core';

// ---------- 目标语言 ----------

/** [键, 界面显示名, 告诉大模型的语言名] */
export const LANGS: [string, string, string][] = [
  ['zh-Hans', '简体中文', '简体中文'],
  ['en', '英语', 'English'],
  ['ja', '日语', '日本語'],
  ['ko', '韩语', '한국어'],
  ['zh-Hant', '繁体中文', '繁體中文'],
  ['fr', '法语', 'Français'],
  ['de', '德语', 'Deutsch'],
  ['es', '西班牙语', 'Español'],
  ['ru', '俄语', 'Русский'],
];
export const AUTO = 'auto';
export const langLabel = (key: string) => LANGS.find((l) => l[0] === key)?.[1] ?? key;
const langPromptName = (key: string) => LANGS.find((l) => l[0] === key)?.[2] ?? key;

/** 「自动」：原文以中文为主时译成英语，否则译成简体中文 */
export function resolveTarget(target: string, text: string): string {
  if (target !== AUTO) return target;
  const han = (text.match(/\p{Script=Han}/gu) ?? []).length;
  const kana = (text.match(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu) ?? []).length;
  const latin = (text.match(/\p{Script=Latin}/gu) ?? []).length;
  const hangul = (text.match(/\p{Script=Hangul}/gu) ?? []).length;
  const total = han + kana + latin + hangul;
  if (!total) return 'zh-Hans';
  return han / total > 0.3 && kana < han * 0.2 ? 'en' : 'zh-Hans';
}

// ---------- 段落 ----------

export interface LineBox {
  text: string;
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** OCR 行 → 带位置的行（取该行所有文本框的外接范围） */
export function lineBoxes(lines: TextLine[]): LineBox[] {
  return lines.map((l) => {
    const pts = l.boxes.flatMap((b) => b.quad);
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return { text: l.text, top: Math.min(...ys), bottom: Math.max(...ys), left: Math.min(...xs), right: Math.max(...xs) };
  });
}

const ASCII_END = /[A-Za-z0-9,;:'")\]%]$/;
const ASCII_START = /^[A-Za-z0-9("'[]/;

/** 把两行接起来：英文之间加空格，行尾连字符接小写字母时去掉连字符，中文直接相连 */
export function joinLines(a: string, b: string): string {
  if (/[A-Za-z]-$/.test(a) && /^[a-z]/.test(b)) return a.slice(0, -1) + b;
  if ((ASCII_END.test(a) || /[.!?]$/.test(a)) && ASCII_START.test(b)) return `${a} ${b}`;
  return a + b;
}

/**
 * 把被截图换行切断的句子接回段落。满足任一条件就另起一段：
 * - 和上一行的竖直间距超过行高的 0.8 倍；
 * - 上一行明显比最长行短（不到 70%），或者本身很短（宽度不到 6 个行高，例如菜单项），说明上一行本来就在那里结束；
 * - 左边缘相差超过一个行高（缩进或另一栏）。
 */
export function toParagraphs(lines: LineBox[]): string[] {
  if (!lines.length) return [];
  const maxW = Math.max(...lines.map((l) => l.right - l.left));
  const out: string[] = [];
  let cur = lines[0].text;
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i - 1], l = lines[i];
    const h = Math.max(1, Math.min(p.bottom - p.top, l.bottom - l.top));
    const gap = l.top - p.bottom;
    const short = p.right - p.left < Math.max(0.7 * maxW, 6 * h);
    const shifted = Math.abs(l.left - p.left) > h;
    if (gap > 0.8 * h || short || shifted) {
      out.push(cur);
      cur = l.text;
    } else cur = joinLines(cur, l.text);
  }
  out.push(cur);
  return out;
}

/** 用户修改原文时：空行分段；按行模式时每行一段 */
export function splitSource(text: string, byLine: boolean): string[] {
  const t = text.replace(/\r/g, '').trim();
  if (!t) return [];
  const parts = byLine ? t.split('\n') : t.split(/\n\s*\n/).map((p) => p.split('\n').map((s) => s.trim()).reduce((a, b) => (a ? joinLines(a, b) : b), ''));
  return parts.map((s) => s.trim()).filter(Boolean);
}

/** 原文放进编辑框的写法：按段落时段与段之间空一行 */
export const joinSource = (segs: string[], byLine: boolean) => segs.join(byLine ? '\n' : '\n\n');

// ---------- 大模型 ----------

export type Msg = { role: 'system' | 'user' | 'assistant'; content: string };

/** 按字数把段落分批，避免一次请求太长；单段超长也自成一批 */
export function chunk(segs: string[], maxChars = 1800): string[][] {
  const out: string[][] = [];
  let cur: string[] = [];
  let n = 0;
  for (const s of segs) {
    if (cur.length && n + s.length > maxChars) { out.push(cur); cur = []; n = 0; }
    cur.push(s);
    n += s.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

export function buildMessages(segs: string[], target: string): Msg[] {
  const lang = langPromptName(target);
  return [
    {
      role: 'system',
      // check-zh: 忽略（写给大模型的提示词里的 JSON 字段名）
      content: `你是专业翻译。把用户给的截图文字逐段翻译成${lang}。
要求：
1. 输入是 JSON：{"segments": [...]}，每个元素是一段原文（来自截图识别，可能有个别错字，按上下文理解）。
2. 只输出 JSON：{"translations": [...]}，数组长度必须和 segments 相同，一一对应，不要合并或拆分段落。
3. 数字、网址、邮箱、代码、型号保持原样；原文已经是${lang}的段落原样返回。
4. 不要解释，不要加任何多余文字。`,
    },
    { role: 'user', content: JSON.stringify({ segments: segs }) },
  ];
}

/** 从回复里取出 JSON 对象（兼容 ```json 包裹和前后多余文字） */
function extractJson(reply: string): unknown {
  const t = reply.replace(/```(?:json)?/gi, '').trim();
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try { return JSON.parse(t.slice(a, b + 1)); } catch { /* 继续尝试数组 */ }
  }
  const c = t.indexOf('[');
  const d = t.lastIndexOf(']');
  if (c >= 0 && d > c) {
    try { return JSON.parse(t.slice(c, d + 1)); } catch { /* 不是 JSON */ }
  }
  return null;
}

/** 解析大模型回复，得到与原文段数相同的译文；对不上时抛出说明 */
export function parseTranslations(reply: string, n: number): string[] {
  const j = extractJson(reply);
  let arr: unknown = Array.isArray(j) ? j : j && typeof j === 'object' ? (j as Record<string, unknown>).translations ?? Object.values(j as object).find(Array.isArray) : null;
  if (!Array.isArray(arr)) {
    // 没按 JSON 回：只有一段时整段当译文；行数刚好对上时按行对应
    const plain = reply.replace(/```[a-z]*/gi, '').trim();
    if (n === 1 && plain) return [plain];
    const lines = plain.split('\n').map((s) => s.trim()).filter(Boolean);
    if (lines.length === n) return lines;
    throw new Error('大模型没有按要求返回译文，请重试或换一个模型');
  }
  arr = arr.map((x) => (typeof x === 'string' ? x : x && typeof x === 'object' ? String(Object.values(x)[0] ?? '') : String(x ?? '')));
  const list = arr as string[];
  if (list.length !== n) throw new Error(`大模型返回了 ${list.length} 段译文，原文有 ${n} 段，对不上，请重试`);
  return list.map((s) => s.trim());
}

/** 逐批翻译，返回与 segs 一一对应的译文 */
export async function translate(
  segs: string[],
  target: string,
  llm: (m: Msg[], o?: { json?: boolean; temperature?: number }) => Promise<string>,
  progress: (done: number, total: number) => void = () => {},
): Promise<string[]> {
  const batches = chunk(segs);
  const out: string[] = [];
  for (let i = 0; i < batches.length; i++) {
    const reply = await llm(buildMessages(batches[i], target), { json: true, temperature: 0.2 });
    out.push(...parseTranslations(reply, batches[i].length));
    progress(i + 1, batches.length);
  }
  return out;
}

// ---------- 复制 ----------

export interface Pair {
  source: string;
  target: string;
}

export const copyText = (pairs: Pair[], what: 'source' | 'target' | 'both', byLine: boolean) => {
  const sep = byLine ? '\n' : '\n\n';
  if (what === 'both') return pairs.map((p) => (p.target ? `${p.source}\n${p.target}` : p.source)).join('\n\n');
  return pairs.map((p) => p[what]).join(sep);
};

/** 剪贴板里取出的图片没有文件名，按时间命名 */
export const pastedName = (d: Date, ext = 'png') =>
  `粘贴的截图-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}.${ext}`;

export const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'];
export const isImagePath = (p: string) => IMAGE_EXTS.includes((p.split('.').pop() ?? '').toLowerCase());
