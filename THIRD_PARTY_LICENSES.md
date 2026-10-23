# 第三方开源组件

本工具使用了以下开源组件，许可证原文见各项目仓库。

| 组件 | 用途 | 许可证 |
|---|---|---|
| [Tauri](https://github.com/tauri-apps/tauri) 及官方插件 | 桌面应用框架 | MIT / Apache-2.0 |
| [React](https://github.com/facebook/react) | 界面 | MIT |
| [Lucide](https://github.com/lucide-icons/lucide) | 图标 | ISC |
| [Vite](https://github.com/vitejs/vite) | 构建 | MIT |
| [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) 1.22.0 | 在应用内运行识别模型 | MIT |
| [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) PP-OCRv4 移动版模型：文字检测 `ch_PP-OCRv4_det_mobile.onnx`（4.7 MB）、文字识别 `ch_PP-OCRv4_rec_mobile.onnx`（10.9 MB）、方向分类 `ch_ppocr_mobile_v2.0_cls_mobile.onnx`（0.6 MB），字典 `ppocr_keys_v1.txt` | 识别截图文字 | Apache-2.0 |
| [RapidOCR](https://github.com/RapidAI/RapidOCR) | 上述模型的 ONNX 转换版本（ModelScope `RapidAI/RapidOCR` v3.10.0）；前后处理流程与参数参考其实现 | Apache-2.0 |
| [campfire-code/batch-ocr](https://github.com/campfire-code/batch-ocr)（篝火「批量图片 OCR」） | `src/tool/ocr.ts`、`src/tool/ocr-core.ts` 及其测试、`public/models/` 下的模型文件复制自该工具（去掉了批量导出部分） | MIT |

模型下载地址：`https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/onnx/PP-OCRv4/{det,rec,cls}/…`。字典取自 PaddleOCR 仓库 `ppocr/utils/ppocr_keys_v1.txt`。
