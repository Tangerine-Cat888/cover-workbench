# 第三方组件与素材

本仓库提供工作台代码和预览图。下列运行依赖由使用者安装。各组件的权利与使用条件见其上游许可。

| 组件 | 用途与来源 |
| --- | --- |
| Pillow | 读取、验证图片与生成预览。[项目许可](https://github.com/python-pillow/Pillow/blob/main/LICENSE) |
| FFmpeg / ffprobe | 从用户提供的视频读取元信息与画面。通过本机已安装的命令行程序调用。[FFmpeg 项目](https://ffmpeg.org/) |
| Playwright | 用本机浏览器渲染所选画幅。[项目许可](https://github.com/microsoft/playwright-python/blob/main/LICENSE) |
| Chromium / Edge | 渲染浏览器，由用户安装。各浏览器继续适用其自己的条款。[浏览器安装说明](https://playwright.dev/python/docs/browsers) |
| Send2Trash | macOS 和 Linux 的系统回收站操作。[项目](https://github.com/arsenetar/send2trash) |
| NumPy、ONNX Runtime | 可选本地抠图推理。[NumPy 许可](https://github.com/numpy/numpy/blob/main/LICENSE.txt) · [ONNX Runtime 许可](https://github.com/microsoft/onnxruntime/blob/main/LICENSE) |
| U²-Net 小模型 | 可选组件从 rembg 发布附件下载 `u2netp.onnx`，并按 SHA-256 校验。权重单独获取，仓库的 MIT 授权仅适用于本项目拥有权利的内容。[模型项目](https://github.com/xuebinqin/U-2-Net) · [权重下载来源](https://github.com/danielgatis/rembg/releases/tag/v0.0.0) |

字体选择调用系统已有的字体或用户导入的字体文件。预览图展示实际工作台。使用者自行添加的图片、人物和字体继续适用原有权利及许可。

用户的封面人物从本次提供的图片或其本机素材库中选取。
