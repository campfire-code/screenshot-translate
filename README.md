# 截图识字翻译

> 篝火出品 · 收录于篝火 App 应用区

截图里的文字本机识别，再用你自己的大模型翻译成选定语言，原文译文逐段对照、一键复制。

![界面截图](docs/screenshot.png)

## 下载

到 [Releases](https://github.com/campfire-code/screenshot-translate/releases/latest) 下载对应安装包：

| 电脑 | 文件 |
|---|---|
| Windows 10 / 11 | `screenshot-translate_版本号_windows-x64-setup.exe` |
| Mac（Apple 芯片） | `screenshot-translate_版本号_mac-arm64.dmg` |
| Mac（Intel 芯片） | `screenshot-translate_版本号_mac-x64.dmg` |

第一次打开：
- **Windows**：如果弹出「Windows 已保护你的电脑」，点「更多信息」→「仍要运行」。
- **Mac**：如果提示「无法验证开发者」，打开「系统设置 → 隐私与安全性」，在下方点「仍要打开」。

## 怎么用

1. 打开软件，用下面任一方式放入截图：
   - 用系统截图工具截图到剪贴板（或在网页 / 聊天里的图片上右键「复制图片」），回到本窗口按 `Ctrl+V`（Mac 上按 `⌘V`）；
   - 把图片文件拖进窗口；
   - 点虚线框选择图片。支持 PNG、JPG、WebP、BMP、GIF。
2. 软件在本机识别图中文字（第一次会多花几秒加载模型），自动把被换行切断的句子接回段落。截图里是菜单、表格这类一行一项的内容时，「分段」选「按原行」。
3. 「翻译成」选目标语言。默认「自动」：原文以中文为主时译成英语，其他译成简体中文。也可以选英语、日语、韩语、繁体中文、法语、德语、西班牙语、俄语、简体中文。
4. 识别完自动翻译，原文和译文逐段对照显示。每段右侧可以单独复制译文，下面可以「复制全部译文」「复制原文」「复制对照」。
5. 个别字识别错了，点「修改原文」改好后「保存并翻译」。

**首次使用要先设置大模型**：点「设置」，填写兼容 OpenAI 接口格式的接口地址、密钥和模型名（有 DeepSeek、通义千问等预设），点「保存并测试连接」。没设置时只能识别文字、不能翻译。

**说明与限制**
- 文字识别全部在本机完成，图片不上传；翻译时会把识别出的**文字**发给你设置的大模型服务商。涉密内容请不要翻译。
- 识别模型是 PaddleOCR 的中文（含英文、数字）移动版模型，对**简体中文和英文**效果最好；日文假名、韩文、俄文等其他文字基本识别不出来，这类截图不适用。
- 手写字、艺术字、很小或很浅的字、背景花哨的图片容易漏字或错字，翻译前可在「修改原文」里核对。
- 段落合并按文字位置估算，个别多栏排版可能接错，改用「按原行」即可。
- 译文质量取决于你选的大模型，重要内容请人工核对。
- 系统要求：Windows 10 / 11；macOS 13.3 或更新（识别引擎需要较新的系统网页引擎）。

## 验收用例

先在「设置」里填好可用的大模型并测试连接成功。

| 操作 | 应得到 |
|---|---|
| 把 `samples/示例-英文软件提示.png` 拖进窗口，「翻译成」保持「自动」，「分段」保持「接成段落」 | 显示「900×420 · 4 段文字」。原文 4 段：`Sync settings`；`Your notes are saved on this device. Turn on sync to keep them up to date on your phone and computer.`（截图里两行被接成一段）；`Sync pauses automatically when the battery is below 20%.`；`Last synced: today at 10:42 示例`。每段下方出现简体中文译文，标题显示「原文 / 简体中文」 |
| 同一张图，「分段」改成「按原行」 | 变成 5 段，与截图里的行一一对应，点「翻译」后逐行出译文 |
| 用看图软件打开 `samples/示例-中文通知.png`，复制图片，回到本窗口按 `Ctrl+V` / `⌘V` | 文件名显示为「粘贴的截图-时分秒.png」，原文 4 段，其中「自十一月一日起，门店营业时间调整为每天上午九点至晚上九点，节假日照常营业。」为一段；因为原文是中文，自动译成英语，标题显示「原文 / 英语」 |
| 点「复制对照」，粘贴到记事本 | 每段原文下面一行是译文，段与段之间空一行 |
| 「翻译成」改成「日语」 | 自动重新翻译，标题变成「原文 / 日语」 |
| 在「设置」里清空密钥后再拖入示例图 | 仍能识别出原文，提示「文字已识别。要翻译，请先到「设置」填写大模型……」，「翻译」按钮不可点 |
| 拖入一个 PDF 文件 | 提示「请拖入图片文件（PNG、JPG、WebP、BMP、GIF）」 |

## 自己编译

需要 Node.js 22、pnpm、Rust。

```bash
pnpm install
pnpm test          # 单元测试
pnpm tauri dev     # 开发运行
pnpm tauri build   # 打包
```

界面框架在 `src/kit`（所有 campfire-code 工具共用），本工具的逻辑在 `src/tool`。

## 致谢

文字识别使用 [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) PP-OCRv4 模型（Apache-2.0），ONNX 版本与前后处理参考 [RapidOCR](https://github.com/RapidAI/RapidOCR)（Apache-2.0），识别代码复用自篝火「批量图片 OCR」（[campfire-code/batch-ocr](https://github.com/campfire-code/batch-ocr)，MIT），推理用 [ONNX Runtime](https://github.com/microsoft/onnxruntime)（MIT）。

## 归属

本工具由**篝火**出品，是篝火 App 应用区收录的开源工具之一，由篝火（GitHub 组织 [campfire-code](https://github.com/campfire-code)）维护与更新。全部工具的目录见 [toolkit-hub](https://github.com/campfire-code/toolkit-hub)。

## 许可证

MIT，版权方为篝火（campfire-code）。
