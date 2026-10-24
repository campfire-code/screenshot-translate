// 主界面：拖入 / 粘贴 / 选择截图 → 本机识别文字 → 大模型翻译 → 原文译文对照，可复制。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardPaste, ImagePlus, Languages, Loader2, PencilLine, RefreshCw, X } from 'lucide-react';
import type { CustomTool } from '../kit/types';
import { CopyButton, ProgressBar, useDroppedFiles } from '../kit/parts';
import { pickFiles, settingsStore } from '../kit/platform';
import { llmReady, useSettings } from '../kit/settings';
import { AUTO, IMAGE_EXTS, LANGS, copyText, isImagePath, joinSource, langLabel, lineBoxes, pastedName, resolveTarget, splitSource, toParagraphs, translate, type Pair } from './core';
import type { TextLine } from './ocr-core';
import { SAMPLE_NAME, SAMPLE_SEGMENTS, SAMPLE_TRANSLATIONS, sampleImage } from './sample';
import { EmptyFlow } from './Empty';
import './tool.css';

type Ctx = Parameters<CustomTool['Main']>[0]['ctx'];
type Status = 'idle' | 'ocr' | 'translating' | 'done' | 'error';
interface Shot { name: string; url: string; width: number; height: number }

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const PREF_KEY = 'screenshot-translate';

export function Main({ ctx, preview }: { ctx?: Ctx; preview?: boolean }) {
  const settings = useSettings();
  const ready = Boolean(preview) || llmReady(settings.llm);
  const [shot, setShot] = useState<Shot | null>(null);
  const [lines, setLines] = useState<TextLine[] | null>(null);
  const [edited, setEdited] = useState<string[] | null>(null);
  const [byLine, setByLine] = useState(false);
  const [target, setTarget] = useState(AUTO);
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ key: string; lang: string; texts: string[] } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [pasteHint, setPasteHint] = useState(false);
  const job = useRef(0);

  // 记住上次选的目标语言和分段方式
  useEffect(() => {
    if (preview) return;
    settingsStore().then(async (st) => {
      const p = await st.get<{ target?: string; byLine?: boolean }>(PREF_KEY);
      if (p?.target) setTarget(p.target);
      if (typeof p?.byLine === 'boolean') setByLine(p.byLine);
    }).catch(() => {});
  }, [preview]);
  const savePref = (patch: { target?: string; byLine?: boolean }) => {
    if (preview) return;
    settingsStore().then((st) => st.set(PREF_KEY, { target, byLine, ...patch })).catch(() => {});
  };

  // 预览页：直接展示示例截图和结果
  useEffect(() => {
    if (!preview || new URLSearchParams(location.search).get('state') === 'empty') return;
    setShot({ name: SAMPLE_NAME, url: sampleImage(), width: 900, height: 420 });
    setEdited(SAMPLE_SEGMENTS);
    setResult({ key: SAMPLE_SEGMENTS.join('\u0000') + '|zh-Hans', lang: 'zh-Hans', texts: SAMPLE_TRANSLATIONS });
    setStatus('done');
  }, [preview]);

  const segs = useMemo(() => edited ?? (lines ? (byLine ? lines.map((l) => l.text) : toParagraphs(lineBoxes(lines))) : []), [edited, lines, byLine]);
  const sourceText = segs.join('\n');
  const lang = resolveTarget(target, sourceText);
  const key = segs.join('\u0000') + '|' + lang;
  const fresh = result?.key === key;
  const pairs: Pair[] = segs.map((s, i) => ({ source: s, target: fresh ? result!.texts[i] ?? '' : '' }));

  const runTranslate = useCallback(async (list: string[], to: string) => {
    if (!list.length || !ctx) return;
    const id = ++job.current;
    setStatus('translating'); setError(''); setProgress(0);
    try {
      const texts = await translate(list, to, ctx.llm, (d, t) => id === job.current && setProgress(d / t));
      if (id !== job.current) return;
      setResult({ key: list.join('\u0000') + '|' + to, lang: to, texts });
      setStatus('done');
    } catch (e) {
      if (id !== job.current) return;
      setError(errText(e)); setStatus('error');
    }
  }, [ctx]);

  const load = useCallback(async (name: string, bytes: Uint8Array) => {
    const id = ++job.current;
    const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
    setShot((old) => { if (old?.url.startsWith('blob:')) URL.revokeObjectURL(old.url); return { name, url, width: 0, height: 0 }; });
    setLines(null); setEdited(null); setResult(null); setEditing(null); setError(''); setStatus('ocr'); setProgress(0);
    try {
      const { recognize } = await import('./ocr');
      const r = await recognize(bytes, { useCls: false, minScore: 0.5 }, (p) => id === job.current && setProgress(p));
      if (id !== job.current) return;
      setShot((s) => (s ? { ...s, width: r.width, height: r.height } : s));
      setLines(r.lines);
      if (!r.lines.length) { setStatus('done'); return; }
      const list = byLine ? r.lines.map((l) => l.text) : toParagraphs(lineBoxes(r.lines));
      if (ready) await runTranslate(list, resolveTarget(target, list.join('\n')));
      else setStatus('done');
    } catch (e) {
      if (id !== job.current) return;
      setError(errText(e)); setStatus('error');
    }
  }, [byLine, ready, runTranslate, target]);

  const openPath = useCallback(async (paths: string[]) => {
    const p = paths.find(isImagePath);
    if (!p || !ctx) { if (paths.length) { setError('请拖入图片文件（PNG、JPG、WebP、BMP、GIF）'); setStatus('error'); } return; }
    try { await load(p.split(/[\\/]/).pop() ?? p, await ctx.readFile(p)); } catch (e) { setError(errText(e)); setStatus('error'); }
  }, [ctx, load]);

  const hover = useDroppedFiles((paths) => void openPath(paths));

  // ⌘V / Ctrl+V 粘贴剪贴板里的截图
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
      if (!file) {
        const el = e.target as HTMLElement | null;
        if (!el?.closest?.('textarea, input')) { setPasteHint(true); setTimeout(() => setPasteHint(false), 2500); }
        return;
      }
      e.preventDefault();
      void file.arrayBuffer().then((b) => load(file.name && file.name !== 'image.png' ? file.name : pastedName(new Date(), file.type.split('/')[1] || 'png'), new Uint8Array(b)));
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [load]);

  const pick = async () => openPath(await pickFiles(IMAGE_EXTS, '图片'));
  const busy = status === 'ocr' || status === 'translating';
  const changeTarget = (t: string) => {
    setTarget(t); savePref({ target: t });
    if (segs.length && ready && result) void runTranslate(segs, resolveTarget(t, sourceText));
  };
  const changeMode = (v: boolean) => { setByLine(v); savePref({ byLine: v }); setEdited(null); };

  const sourceName = shot?.name ?? '';
  return (
    <div className="st-root">
      <header className="st-head">
        <h1>截图识字翻译</h1>
        <p className="k-muted">截图贴进来，本机认字，大模型翻译，译文大字显示、原文留在下面核对</p>
      </header>
      {!shot ? (
        <button className={`st-drop${hover ? ' hover' : ''}`} onClick={pick}>
          <EmptyFlow />
          <b>{hover ? '松开鼠标，开始识别' : <>把截图拖到这里，或按 <kbd>{navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl'}</kbd> + <kbd>V</kbd> 粘贴</>}</b>
          <span className="k-muted"><ImagePlus size={14} />也可以点击选择图片 · 支持 PNG、JPG、WebP、BMP、GIF</span>
          <span className="k-muted">文字识别在本机完成；翻译会把识别出的文字发给你在「设置」里填的大模型</span>
        </button>
      ) : (
        <div className="st-work">
          <aside className="st-left">
            <figure className={`st-shot${hover ? ' hover' : ''}`}>
              <img src={shot.url} alt={`截图：${sourceName}`} />
              <figcaption>
                <b title={sourceName}>{sourceName}</b>
                <span className="k-muted k-num">{shot.width ? `${shot.width}×${shot.height} · ` : ''}{lines || edited ? `${segs.length} ${byLine ? '行' : '段'}文字` : '识别中…'}</span>
              </figcaption>
            </figure>
            <div className="st-row">
              <button className="k-btn" onClick={pick} disabled={busy}><ImagePlus size={15} />换一张</button>
              <span className="k-muted st-paste"><ClipboardPaste size={14} />或直接粘贴</span>
            </div>
            <div className="st-ctl">
              <label className="st-field">
                <span className="k-label">翻译成</span>
                <select className="k-input" value={target} disabled={busy} onChange={(e) => changeTarget(e.target.value)}>
                  <option value={AUTO}>自动（中文译英，其余译中）</option>
                  {LANGS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </label>
              <div className="st-field">
                <span className="k-label">分段</span>
                <div className="k-seg" role="radiogroup" aria-label="分段">
                  <button role="radio" aria-checked={!byLine} className={!byLine ? 'on' : ''} disabled={busy} onClick={() => changeMode(false)}>接成段落</button>
                  <button role="radio" aria-checked={byLine} className={byLine ? 'on' : ''} disabled={busy} onClick={() => changeMode(true)}>按原行</button>
                </div>
              </div>
              <button className="k-btn primary st-go" disabled={busy || !segs.length || !ready} title={!ready ? '先到「设置」里填写大模型' : undefined} onClick={() => runTranslate(segs, lang)}>
                {status === 'translating' ? <Loader2 size={15} className="k-spin" /> : fresh ? <RefreshCw size={15} /> : <Languages size={15} />}
                {fresh ? '重新翻译' : '翻译'}
              </button>
            </div>
          </aside>

          <section className="st-right">
            {busy && (
              <div className="st-busy" role="status">
                <Loader2 size={15} className="k-spin" />
                <span>{status === 'ocr' ? '正在识别文字…（第一次会多花几秒加载模型）' : `正在翻译成${langLabel(lang)}…`}</span>
                <ProgressBar ratio={progress} label={status === 'ocr' ? '识别进度' : '翻译进度'} />
              </div>
            )}
            {status === 'error' && error && (
              <div className="k-notice err" role="alert"><span>{error}</span><button className="k-icon-btn" aria-label="关闭提示" onClick={() => { setError(''); setStatus(segs.length ? 'done' : 'idle'); }}><X size={14} /></button></div>
            )}
            {!ready && segs.length > 0 && !preview && (
              <div className="k-notice" role="status"><span>文字已识别。要翻译，请先到「设置」填写大模型的接口地址、密钥和模型名。</span></div>
            )}
            {pasteHint && <div className="k-notice" role="status"><span>剪贴板里没有图片。先截图到剪贴板（或在图片上右键「复制图片」），再按粘贴。</span></div>}
            {(lines || edited) && !segs.length && status === 'done' && <div className="k-notice"><span>这张图里没有识别到文字。图片太小或文字太浅时，可以放大后重新截图。</span></div>}

            {editing !== null ? (
              <section className="st-panel">
                <div className="st-panel-hd"><b>修改原文</b><span className="k-muted">{byLine ? '每行一段' : '段与段之间空一行'}，识别错的字可以在这里改</span></div>
                <textarea className="k-input k-textarea st-edit" rows={10} value={editing} onChange={(e) => setEditing(e.target.value)} aria-label="原文" />
                <div className="st-row st-end">
                  <button className="k-btn" onClick={() => setEditing(null)}>取消</button>
                  <button className="k-btn primary" onClick={() => {
                    const list = splitSource(editing, byLine);
                    setEdited(list); setEditing(null);
                    if (ready && list.length) void runTranslate(list, resolveTarget(target, list.join('\n')));
                  }}>{ready ? '保存并翻译' : '保存'}</button>
                </div>
              </section>
            ) : segs.length > 0 && (
              <section className="st-panel">
                <div className="st-panel-hd">
                  <span className="st-badge">{fresh ? langLabel(result!.lang) : '待翻译'}</span>
                  <b>译文</b>
                  <span className="k-muted k-num">{segs.length} {byLine ? '行' : '段'}</span>
                  <span className="st-sp" />
                  <button className="k-btn st-small" disabled={busy} onClick={() => setEditing(joinSource(segs, byLine))}><PencilLine size={14} />修改原文</button>
                </div>
                <ol className="st-pairs">
                  {pairs.map((p, i) => (
                    <li key={i} className="st-pair">
                      <i className="st-no k-num">{i + 1}</i>
                      <div className="st-txt">
                        {p.target ? <p className="st-dst">{p.target}</p> : <p className="st-dst k-muted">{status === 'translating' ? '翻译中…' : '（未翻译）'}</p>}
                        <p className="st-src"><span>原文</span>{p.source}</p>
                      </div>
                      {p.target && <span className="st-pair-copy"><CopyButton text={p.target} /></span>}
                    </li>
                  ))}
                </ol>
                <div className="st-row st-copy">
                  {fresh && <CopyButton text={copyText(pairs, 'target', byLine)} label="复制全部译文" />}
                  <CopyButton text={copyText(pairs, 'source', byLine)} label="复制原文" />
                  {fresh && <CopyButton text={copyText(pairs, 'both', byLine)} label="复制对照" />}
                </div>
              </section>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
