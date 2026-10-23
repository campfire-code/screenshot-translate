// 工具声明：截图识字翻译（自定义界面）。文字识别在本机完成，翻译调用用户自己配置的大模型。
import { Languages as LanguagesAsIcon } from 'lucide-react';
import { createElement } from 'react';
import type { CustomTool } from '../kit/types';
import { Main } from './Main';

const tool: CustomTool = {
  id: 'o21',
  name: '截图识字翻译',
  tagline: '拖入、粘贴或选择截图，本机识别图中文字，再用你自己的大模型翻译成选定语言，原文译文逐段对照，一键复制。',
  icon: LanguagesAsIcon,
  category: '办公提效',
  type: 'text',
  mode: 'custom',
  mainLabel: '识字翻译',
  needsLLM: true,
  params: [],
  // 预览页（preview.html）里不跑模型、不调大模型，直接展示示例截图和结果
  Main: ({ ctx }) => createElement(Main, { ctx, preview: location.pathname.endsWith('preview.html') }),
};

export default tool;
