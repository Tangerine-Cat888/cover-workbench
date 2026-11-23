"""Inspect a local video's candidate frames or extract a full-size frame for a cover."""
import argparse
import io
import json
import math
from pathlib import Path
import shutil
import subprocess

from PIL import Image, ImageDraw, ImageFilter, ImageStat


def run(binary, args):
    tool = shutil.which(binary)
    if not tool:
        raise ValueError("视频选帧需要 FFmpeg 和 ffprobe；也可以直接发送截图，或先跳过。")
    try:
        result = subprocess.run([tool, "-v", "error", *args], capture_output=True, timeout=45)
    except subprocess.TimeoutExpired as exc:
        raise ValueError("视频读取超时，可指定时间点或使用截图。") from exc
    if result.returncode:
        raise ValueError("无法读取视频画面，请检查视频格式或使用真实截图。")
    return result.stdout


def duration(path):
    if not path.is_file():
        raise ValueError("请选择本地视频文件。")
    raw = run("ffprobe", ["-select_streams", "v:0", "-show_entries", "stream=codec_type,duration:format=duration",
                         "-of", "json", str(path.resolve())])
    data = json.loads(raw)
    if not data.get("streams"):
        raise ValueError("文件没有可用的视频轨道。")
    for value in (data["streams"][0].get("duration"), data.get("format", {}).get("duration")):
        try:
            seconds = float(value)
        except (TypeError, ValueError):
            continue
        if math.isfinite(seconds) and seconds > 0:
            return seconds
    raise ValueError("无法确定视频时长，请改用截图。")


def frame(path, at, preview=False):
    args = ["-nostdin", "-ss", f"{at:.6f}", "-i", str(path.resolve()), "-map", "0:v:0", "-frames:v", "1"]
    if preview:
        args += ["-vf", "scale=320:210:force_original_aspect_ratio=decrease"]
    data = run("ffmpeg", args + ["-f", "image2pipe", "-vcodec", "png", "pipe:1"])
    if not data:
        raise ValueError("这个时间点没有可读取的画面。")
    return data


def candidates(path, seconds):
    values = []
    for ratio in (.08, .18, .30, .42, .55, .68, .80, .91):
        at = round((seconds - min(.08, seconds/2)) * ratio, 6)
        try:
            im = Image.open(io.BytesIO(frame(path, at, True))).convert("RGB")
        except ValueError:
            if not values and ratio == .91:
                raise
            continue
        gray = im.convert("L")
        # Ignore letterboxing and the outer border when measuring detail.
        w,h = gray.size
        area = gray.crop((w//12,h//12,w-w//12,h-h//12))
        spread = ImageStat.Stat(area).stddev[0]
        detail = ImageStat.Stat(area.filter(ImageFilter.FIND_EDGES)).mean[0]
        values.append((at, im, spread + 2*detail))
    if not values:
        raise ValueError("没有取得视频候选帧，可直接提供截图。")
    return values


def selected_frames(video, times):
    path = Path(video)
    seconds = duration(path)
    if not times:
        choices = candidates(path, seconds)
        at, _, score = max(choices, key=lambda item:item[2])
        if score < 6:
            raise ValueError("视频候选缺少可辨认的画面，请指定时间点、发送截图或跳过。")
        times = [at]
    for at in dict.fromkeys(times):
        if not math.isfinite(at) or not 0 <= at < seconds:
            raise ValueError("选帧时间须位于视频时长内。")
        yield at, frame(path, at)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video",type=Path)
    parser.add_argument("sheet",type=Path,help="Path for a new candidate contact sheet (.png)")
    args = parser.parse_args()
    try:
        values = candidates(args.video,duration(args.video))
        sheet = Image.new("RGB",(4*320, ((len(values)+3)//4)*240),"#f4f2ef")
        draw = ImageDraw.Draw(sheet)
        for i,(at,im,_) in enumerate(values):
            x,y = i%4*320,i//4*240
            sheet.paste(im,(x+(320-im.width)//2,y+(210-im.height)//2))
            draw.text((x+9,y+214),f"{i+1:02}   {at:.3f} s",fill="black")
        args.sheet.parent.mkdir(parents=True,exist_ok=True)
        with args.sheet.open("xb") as stream:
            sheet.save(stream,"PNG")
        print(json.dumps({"sheet":str(args.sheet.resolve()),"seconds":[t for t,_,_ in values]}))
    except (OSError, ValueError) as exc:
        parser.exit(1,str(exc)+"\n")

if __name__=="__main__":
    main()
