"""Local document format and asset storage for the cover workbench."""
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import tempfile
from uuid import uuid4
from PIL import Image, ImageOps

SIZES = {"portrait": (1080, 1440), "main": (1440, 1080), "wide": (1920, 1080), "wechat": (1880, 800)}
ASSETS = Path(__file__).resolve().parents[1] / "assets"
ID = re.compile(r"[a-zA-Z0-9_-]{1,80}\Z")
IMAGE = re.compile(r"[a-f0-9]{64}\.png\Z")
FONT = re.compile(r"[a-f0-9]{64}\.(?:ttf|otf|woff2?)\Z")
COLORS = re.compile(r"#[a-fA-F0-9]{6}\Z")

def write_atomic(path, data):
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".writing-", delete=False) as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    os.replace(f.name, path)

def write_json(path, value):
    write_atomic(path, json.dumps(value, ensure_ascii=False, indent=2).encode("utf-8"))

def normalize_image(data):
    with Image.open(io.BytesIO(data)) as im:
        if im.format not in {"PNG","JPEG","WEBP"} or im.width * im.height > 32_000_000:
            raise ValueError("请选择 3200 万像素以内的 PNG、JPEG 或 WebP。")
        im.load()
        if im.format != "PNG" or im.getexif().get(274, 1) != 1:
            im = ImageOps.exif_transpose(im).convert("RGBA")
            stream = io.BytesIO()
            im.save(stream, format="PNG")
            data = stream.getvalue()
        size = im.size
    return data, size

def image_asset(project, data):
    data, size = normalize_image(data)
    name = hashlib.sha256(data).hexdigest()+".png"
    target = project/"assets"/name
    if not target.exists():
        write_atomic(target, data)
    return {"file":name,"width":size[0],"height":size[1]}

def placement(layer, x, y, w, h, fs=72, rotation=0):
    return dict(id=layer, x=x, y=y, w=w, h=h, fs=fs, rotation=rotation,
                visible=True, locked=layer=="background")

def add_wechat_layout(doc):
    if "wechat" in doc["layouts"]:
        return False
    wide_w, wide_h = SIZES["wide"]
    w, h = SIZES["wechat"]
    scale = h / wide_h
    placements = []
    for old in doc["layouts"]["wide"]:
        item = old.copy()
        if item["id"] == "background":
            item.update(x=0, y=0, w=w, h=h)
        else:
            for field in ("w", "h", "fs", "artFs", "y"):
                if field in old:
                    item[field] = old[field] * scale
            center = (old["x"] + old["w"] / 2) / wide_w
            item["x"] = center * w - item["w"] / 2
        placements.append(item)
    doc["layouts"]["wechat"] = placements
    return True

def make_draft(project, args):
    project.mkdir(parents=True, exist_ok=True)
    path = project/"cover.json"
    if path.exists():
        doc = json.loads(path.read_bytes())
        if add_wechat_layout(doc):
            validate(doc, project)
            doc["revision"] += 1
            write_json(path, doc)
        return
    (project/"assets").mkdir(exist_ok=True)
    from cover_media import inputs, insert
    layers = [
        dict(id="background",kind="background",name="背景",color="#fbf7ef",preset="lavender"),
        dict(id="series",kind="text",name="系列名",text=args.series,color="#665e78",font="sans"),
        dict(id="title",kind="text",name="主标题",text=args.title,color="#202331",font=args.font),
    ]
    if args.background:
        layers[0].update(src=image_asset(project,Path(args.background).read_bytes())["file"],preset="image")
    layouts = {}
    for key,(w,h) in SIZES.items():
        vertical = key=="portrait"
        left,top = round(w*.07),round(h*.06)
        layouts[key] = [
            placement("background",0,0,w,h),
            placement("series",left,top,round(w*.82),round(h*.05),round(h*.03)),
            placement("title",left,top+round(h*.076),round(w*(.86 if vertical else .60)),
                      round(h*.28),round(h*(.079 if vertical else .096))),
        ]
    doc=dict(schema=1,projectId=uuid4().hex,revision=0,name=args.name or project.name,layers=layers,layouts=layouts)
    if args.skip_character:
        doc["skipCharacterHint"]=True
    if args.skip_screenshot:
        doc["skipScreenshotHint"]=True
    insert(doc,inputs(args,project,choose_library=True))
    validate(doc,project)
    write_json(path,doc)

def validate(doc, project):
    def need(condition):
        if not condition:
            raise ValueError("草稿包含无法读取的图层或画幅数据。")
    def number(value, low, high):
        return type(value) in (int,float) and math.isfinite(value) and low<=value<=high
    def check_image(name):
        need(isinstance(name,str) and IMAGE.fullmatch(name) and (project/"assets"/name).is_file())
    need(isinstance(doc,dict) and doc.get("schema")==1 and type(doc.get("revision")) is int)
    need(isinstance(doc.get("name"),str) and 0<len(doc["name"])<=200)
    need(isinstance(doc.get("projectId"), str) and ID.fullmatch(doc["projectId"]))
    layers=doc.get("layers")
    need(isinstance(layers,list) and 1<=len(layers)<=150)
    ids=set()
    backgrounds=[]
    for layer in layers:
        need(isinstance(layer,dict))
        id_=layer.get("id")
        need(isinstance(id_,str) and ID.fullmatch(id_) and id_ not in ids)
        ids.add(id_)
        kind=layer.get("kind")
        need(kind in ("text","image","character","background") and isinstance(layer.get("name"),str))
        if kind=="background": backgrounds.append(id_)
        for field in ("src","art"):
            if layer.get(field): check_image(layer[field])
        if "cutoutOriginal" in layer:
            need(kind=="character" and bool(layer.get("src")))
            check_image(layer["cutoutOriginal"])
        for field in ("text","artText"):
            if field in layer: need(isinstance(layer[field],str) and len(layer[field])<=2000)
        if kind=="text":
            font=layer.get("font")
            need(isinstance(font,str) and (font in ("sans","ink","serif") or
                 (FONT.fullmatch(font) and (project/"assets"/font).is_file())) and "text" in layer)
        if kind in ("text","background"): need(isinstance(layer.get("color"),str) and COLORS.fullmatch(layer["color"]))
        if kind=="background" and "gradientTint" in layer:
            need(isinstance(layer["gradientTint"],str) and COLORS.fullmatch(layer["gradientTint"]))
        for ref in layer.get("backgrounds",{}).values(): check_image(ref)
        for ref in layer.get("parts",[]): check_image(ref)
    need(backgrounds==["background"] and set(doc.get("layouts",{}))==set(SIZES))
    for layout in doc["layouts"].values():
        need(isinstance(layout,list) and len(layout)==len(ids) and layout[0]["id"]=="background")
        need({p["id"] for p in layout}==ids)
        for p in layout:
            for field in ("x","y","w","h","fs","rotation"):
                need(number(p.get(field),1 if field in ("w","h","fs") else -20000,20000))
            need(type(p.get("locked")) is bool and type(p.get("visible")) is bool)
