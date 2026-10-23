import { describe, expect, it } from 'vitest';
import { buildMessages, chunk, copyText, isImagePath, joinLines, joinSource, lineBoxes, parseTranslations, pastedName, resolveTarget, splitSource, toParagraphs, translate, type LineBox, type Msg } from './core';
import type { TextLine } from './ocr-core';

const L = (text: string, top: number, left = 20, right = 600, h = 24): LineBox => ({ text, top, bottom: top + h, left, right });

describe('目标语言', () => {
  it('自动：中文为主译成英语，英文译成简体中文', () => {
    expect(resolveTarget('auto', '保温时长 12 小时以上')).toBe('en');
    expect(resolveTarget('auto', 'Sync settings')).toBe('zh-Hans');
    expect(resolveTarget('auto', '')).toBe('zh-Hans');
  });
  it('日文里有汉字也不当成中文', () => expect(resolveTarget('auto', '設定を保存しました')).toBe('zh-Hans'));
  it('指定了语言就用指定的', () => expect(resolveTarget('ja', '你好')).toBe('ja'));
});

describe('段落', () => {
  it('从 OCR 行取外接范围', () => {
    const line: TextLine = { text: 'ab', score: 1, boxes: [
      { text: 'a', score: 1, quad: [[10, 5], [40, 5], [40, 25], [10, 25]] },
      { text: 'b', score: 1, quad: [[50, 6], [90, 6], [90, 27], [50, 27]] },
    ] };
    expect(lineBoxes([line])).toEqual([{ text: 'ab', top: 5, bottom: 27, left: 10, right: 90 }]);
  });
  it('英文换行接回一句，加空格；连字符断词去掉连字符', () => {
    expect(joinLines('Turn on sync to keep', 'them up to date.')).toBe('Turn on sync to keep them up to date.');
    expect(joinLines('auto-', 'matically')).toBe('automatically');
    expect(joinLines('Hello.', 'World')).toBe('Hello. World');
  });
  it('中文直接相连', () => expect(joinLines('打开同步后，手机和', '电脑上的笔记')).toBe('打开同步后，手机和电脑上的笔记'));
  it('满行的接成一段，短行结束一段，大间距另起一段', () => {
    const lines = [
      L('Sync settings', 0, 20, 200),
      L('Your notes are saved on this device. Turn on sync to keep', 50),
      L('them up to date on your phone and computer.', 80, 20, 450),
      L('Sync pauses when the battery is below 20%', 140),
      L('or on a metered connection.', 170, 20, 300),
    ];
    expect(toParagraphs(lines)).toEqual([
      'Sync settings',
      'Your notes are saved on this device. Turn on sync to keep them up to date on your phone and computer.',
      'Sync pauses when the battery is below 20% or on a metered connection.',
    ]);
  });
  it('左边缘错开（另一栏或缩进）另起一段', () => expect(toParagraphs([L('第一栏的一整行文字内容', 0), L('右边栏', 28, 400, 990)])).toHaveLength(2));
  it('菜单这类短行各自一段', () => expect(toParagraphs([L('设置', 0, 20, 80), L('隐私', 30, 20, 80), L('关于', 60, 20, 80)])).toEqual(['设置', '隐私', '关于']));
  it('没有行返回空', () => expect(toParagraphs([])).toEqual([]));
  it('修改原文：空行分段，段内换行接回；按行模式每行一段', () => {
    expect(splitSource('Line one\nline two\n\n第二段', false)).toEqual(['Line one line two', '第二段']);
    expect(splitSource('a\n\nb\nc\n', true)).toEqual(['a', 'b', 'c']);
    expect(splitSource('  \n ', false)).toEqual([]);
    expect(joinSource(['a', 'b'], false)).toBe('a\n\nb');
  });
});

describe('大模型请求与解析', () => {
  it('请求里写明目标语言，原文以 JSON 发送', () => {
    const m = buildMessages(['Hello'], 'zh-Hans');
    expect(m[0].content).toContain('简体中文');
    expect(JSON.parse(m[1].content)).toEqual({ segments: ['Hello'] });
  });
  it('按字数分批，单段超长自成一批', () => {
    expect(chunk(['aaaa', 'bbbb', 'cc'], 8)).toEqual([['aaaa', 'bbbb'], ['cc']]);
    expect(chunk(['x'.repeat(20), 'y'], 8)).toEqual([['x'.repeat(20)], ['y']]);
    expect(chunk([])).toEqual([]);
  });
  it('解析标准 JSON 和 ```json 包裹的回复', () => {
    expect(parseTranslations('{"translations":["你好","世界"]}', 2)).toEqual(['你好', '世界']);
    expect(parseTranslations('好的：\n```json\n{"translations": [" 你好 "]}\n```', 1)).toEqual(['你好']);
  });
  it('键名不同、直接返回数组、元素是对象也能取出', () => {
    expect(parseTranslations('{"result":["a","b"]}', 2)).toEqual(['a', 'b']);
    expect(parseTranslations('["a","b"]', 2)).toEqual(['a', 'b']);
    expect(parseTranslations('{"translations":[{"text":"a"}]}', 1)).toEqual(['a']);
  });
  it('没按 JSON 回：一段时整段当译文，行数对上时按行对应', () => {
    expect(parseTranslations('你好，世界', 1)).toEqual(['你好，世界']);
    expect(parseTranslations('甲\n乙', 2)).toEqual(['甲', '乙']);
  });
  it('段数对不上时报错', () => {
    expect(() => parseTranslations('{"translations":["a"]}', 2)).toThrow('返回了 1 段译文，原文有 2 段');
    expect(() => parseTranslations('随便说点什么\n再说一行\n第三行', 2)).toThrow('没有按要求返回译文');
  });
});

describe('翻译流程（假的大模型）', () => {
  it('分批调用并按顺序拼回，带 JSON 要求和低温度', async () => {
    const calls: { msgs: Msg[]; opts?: { json?: boolean; temperature?: number } }[] = [];
    const fake = async (msgs: Msg[], opts?: { json?: boolean; temperature?: number }) => {
      calls.push({ msgs, opts });
      const { segments } = JSON.parse(msgs[1].content) as { segments: string[] };
      return JSON.stringify({ translations: segments.map((s) => `译:${s.slice(0, 3)}`) });
    };
    const segs = ['a'.repeat(1000), 'b'.repeat(1000), 'c'];
    const steps: string[] = [];
    const out = await translate(segs, 'zh-Hans', fake, (d, t) => steps.push(`${d}/${t}`));
    expect(out).toEqual(['译:aaa', '译:bbb', '译:c']);
    expect(calls).toHaveLength(2);
    expect(calls[0].opts).toEqual({ json: true, temperature: 0.2 });
    expect(steps).toEqual(['1/2', '2/2']);
  });
  it('大模型报错时原样抛出', async () => {
    await expect(translate(['x'], 'en', async () => { throw new Error('大模型调用失败（401，密钥不对或已过期）'); })).rejects.toThrow('401');
  });
});

describe('复制与其他', () => {
  const pairs = [{ source: 'Hello', target: '你好' }, { source: 'World', target: '世界' }];
  it('复制原文、译文、对照', () => {
    expect(copyText(pairs, 'target', false)).toBe('你好\n\n世界');
    expect(copyText(pairs, 'source', true)).toBe('Hello\nWorld');
    expect(copyText(pairs, 'both', false)).toBe('Hello\n你好\n\nWorld\n世界');
  });
  it('粘贴的截图按时间命名', () => expect(pastedName(new Date(2026, 9, 23, 9, 5, 7))).toBe('粘贴的截图-090507.png'));
  it('只接收图片', () => {
    expect(isImagePath('/a/截图.PNG')).toBe(true);
    expect(isImagePath('/a/说明.pdf')).toBe(false);
  });
});
