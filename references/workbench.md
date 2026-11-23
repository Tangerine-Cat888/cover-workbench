# 工作台操作

## 启动与恢复

在持久化工作目录中给每张封面分配一个草稿文件夹；已有草稿直接复用。运行 `scripts/cover_workbench.py open <草稿目录> --output-dir <当前聊天文件夹>`，打开返回的本机地址。在宿主支持的情况下可自动识别聊天目录；其他宿主可传绝对路径，或设置 `COVER_WORKBENCH_CHAT_DIR`。已有草稿会保留图层和画幅。手工运行时可直接指定成品目录。

新草稿支持 `--name`、`--title`、`--series`、`--font sans|serif|ink`、`--background <图片>`、`--character <图片>`、可重复的 `--screenshot <图片>`。需要标题断行时传入包含换行的字符串。

## 人物、素材与画幅

### 视频选帧与补图

从本次任务所给的视频、工程或附件中取材。用以下命令生成候选联系表，打开它，对照标题选画面。优先展示界面的操作结果或关键功能；不要将视频里的示意图描述为真实产品界面。时间点单位为秒，抽出的图片保留原视频分辨率。

```sh
python scripts/cover_frames.py tutorial.mp4 ./work/candidates.png
python scripts/cover_workbench.py open ./draft --output-dir ./finished --title "封面工作台" --series "工具实操" --video tutorial.mp4 --frame-at 3.21 --character portrait.png
```

直接传 `--video` 会按对比度和细节自动取一帧；Agent 结合内容选好后使用 `--frame-at`，可重复指定。需要 FFmpeg 和 ffprobe 在 PATH。没有可读画面或本机缺少工具时，可使用用户发来的真实截图或跳过。

新草稿缺图时可以照常打开。用户明确暂时不加时，传 `--skip-character` 或 `--skip-screenshot`。库中有多个人物时，用户可在「＋ 人物」中选择。也可以分别在聊天里补图，复用原草稿，运行以下命令。已有文字、位置、背景和其他图层保留，重复传入相同素材会跳过。若已有其他人物，使用人物属性里的「从本机换图」替换。

```sh
python scripts/cover_workbench.py add-media ./draft --screenshot screen.png --character portrait.png
```

聊天收到的新图和网页选图都按四个画幅分别放置，截图在人物下方。已有页面显示「已同步」后刷新即可查看聊天中补的图。

首次提示支持导入人物或跳过。也可在「素材库」添加、改名、排序、设置是否显示或移到系统回收站；在编辑器中从对应图层属性选择。首次选图支持 PNG、JPEG、WebP。人物带背景时可在人物图层中预览抠图、应用透明底或恢复原图。用户选择安装可选组件时才联网下载。

黑体、宋体、手写体是可选字体类别；实际字形取决于已安装或导入的字体。背景的颜色、渐变晕染、图片缩放和偏移可在右侧编辑。文字、素材和图层跨画幅共享。各画幅分别保留位置、尺寸和排序。

## 文件与导出

草稿的 `cover.json`、`assets/` 与确认记录应一起备份。用户资料默认位于系统本地应用数据目录下的 `cover-workbench` 子目录；Linux 遵循 XDG 数据目录。通过 `COVER_WORKBENCH_DATA_DIR` 可指定绝对路径。

导出使用 `scripts/cover_workbench.py finish <草稿目录>`，可用 `--browser <可执行文件>` 指定 Chromium 或 Edge。原确认失效时返回工作台重新核对。只交付该确认下已实际生成的画幅。依赖来源和字体使用说明见[第三方组件](THIRD_PARTY_NOTICES.md)。
