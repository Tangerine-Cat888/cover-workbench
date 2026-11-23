"""Shared four-format geometry and non-destructive media insertion."""
from functools import lru_cache
import json
import math
import re
from pathlib import Path
from uuid import uuid4
from cover_frames import selected_frames


@lru_cache(maxsize=1)
def rectangles():
    from cover_project import ASSETS
    template=(ASSETS/"workbench"/"index.html").read_text(encoding="utf-8")
    block=re.search(r'<script type="application/json" id="media-rectangles">([^<]+)</script>',template)
    return json.loads(block.group(1))


def slots(kind, aspect, index=0):
    from cover_project import SIZES, placement
    if kind not in ("screenshot","character") or not isinstance(aspect,(int,float)) or not math.isfinite(aspect) or aspect<=0:
        raise ValueError("图片尺寸无效。")
    if type(index) is not int or index<0:
        raise ValueError("素材序号无效。")
    result={}
    for key,(w,h) in SIZES.items():
        options=rectangles()["portrait" if key=="portrait" else "landscape"][kind]
        box=options[index%len(options)]
        width=min(w*box["w"],h*box["h"]*aspect)
        height=width/aspect
        x=w*box["right"]-width if "right" in box else w*box["x"]
        y=h*box["bottom"]-height if "bottom" in box else h*box["y"]
        result[key]=placement("",math.floor(x+.5),math.floor(y+.5),max(1,math.floor(width+.5)),
                              max(1,math.floor(height+.5)),rotation=box["rotation"])
    return result


def inputs(args, project, *, choose_library=False):
    from cover_project import image_asset
    if args.frame_at and not args.video:
        raise ValueError("--frame-at 需要同时提供 --video。")
    media=[]
    for path in args.screenshot:
        asset=image_asset(project,Path(path).read_bytes())
        media.append(("screenshot",asset,Path(path).stem,None))
    if args.video:
        for at,data in selected_frames(args.video,args.frame_at):
            asset=image_asset(project,data)
            media.append(("screenshot",asset,f"视频截图 {at:.2f} 秒",{"video":Path(args.video).name,"seconds":at}))
    if args.character:
        media.append(("character",image_asset(project,Path(args.character).read_bytes()),Path(args.character).stem,None))
    elif choose_library and not args.skip_character:
        from cover_library import catalog, use_artwork
        choices=[item for item in catalog()["character"] if item["visible"]]
        if len(choices)==1:
            item=use_artwork(project,"character",choices[0]["file"])
            asset=image_asset(project,(project/"assets"/item["file"]).read_bytes())
            media.append(("character",asset,item["name"],None))
    return media


def insert(doc, materials):
    added=[]
    for role,asset,label,origin in materials:
        file=asset["file"]
        is_person=role=="character"
        matches=[l for l in doc["layers"] if l["kind"]=="character"] if is_person else [
            l for l in doc["layers"] if l["kind"]=="image" and l.get("role")!="sticker"]
        if any(l.get("src")==file for l in matches):
            continue
        if is_person and matches:
            raise ValueError("当前草稿已有人物，请在该图层的「从本机换图」中确认替换。")
        positions=slots(role,asset["width"]/asset["height"],len(matches))
        identifier="l"+uuid4().hex
        layer={"id":identifier,"kind":"character" if is_person else "image","name":("人物" if is_person else "截图")+" · "+label[:62],
               "sourceLabel":label[:80],"src":file,"fit":"contain"}
        if not is_person:
            layer.update(role="screenshot",frame=True)
        if origin:
            layer["frameSource"]=origin
        people={l["id"] for l in doc["layers"] if l["kind"]=="character"}
        doc["layers"].append(layer)
        for key,layout in doc["layouts"].items():
            index=next((i for i,p in enumerate(layout) if p["id"] in people),len(layout)) if not is_person else len(layout)
            layout.insert(index,{**positions[key],"id":identifier})
        added.append(identifier)
    return added
