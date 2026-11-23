"""Cover assets shared by all projects in this installation."""
from datetime import datetime, timezone
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import time
from PIL import Image

from cover_paths import data_directory
from cover_project import IMAGE, FONT, normalize_image, write_atomic, write_json
from cover_review import review_lock

LIBRARY = data_directory() / "library"
FOLDERS = {"character":"characters", "background":"backgrounds", "font":"fonts", "sticker":"stickers"}
BUILTINS = {
    "character":{},
    "background":{"lavender":"柔光渐变", "solid":"纯色", "grid":"方格纸"},
    "font":{"sans":"黑体", "serif":"宋体", "ink":"手写体"}, "sticker":{}
}
MAGICS = {b"\0\1\0\0":"ttf", b"OTTO":"otf", b"wOFF":"woff", b"wOF2":"woff2"}

def folder_for(kind):
    if kind not in FOLDERS:
        raise ValueError("未知的素材分类。")
    return LIBRARY/FOLDERS[kind]

def check_file(kind, file):
    if not isinstance(file,str) or not (FONT if kind=="font" else IMAGE).fullmatch(file):
        raise ValueError("素材编号无效。")
    return file

def item_dir(kind,file):
    return folder_for(kind)/"items"/check_file(kind,file)

def source_name(file):
    return "source"+Path(file).suffix

def library_lock():
    LIBRARY.mkdir(parents=True,exist_ok=True)
    return review_lock(LIBRARY,".catalog.lock")

def portrait_welcome(dismiss=False):
    with library_lock():
        marker=LIBRARY/"portrait-welcome.json"
        if dismiss and not marker.exists():
            write_json(marker,{"dismissed":True})
        added=any((folder_for("character")/"items").glob("*/item.json"))
        return {"show":not marker.exists() and not added}

def preferences():
    file=LIBRARY/"display.json"
    return json.loads(file.read_bytes()) if file.is_file() else {}

def read_items(kind,prefs,include_removed=False):
    items=[dict(id=k,name=v,builtin=True) for k,v in BUILTINS[kind].items()]
    imports=[]
    for path in (folder_for(kind)/"items").glob("*/item.json"):
        item=json.loads(path.read_bytes())
        file=check_file(kind,item["file"])
        if file!=path.parent.name:
            raise ValueError("素材目录与记录不一致。")
        imports.append(dict(id=file,file=file,name=item["name"],builtin=False,savedAt=item["savedAt"]))
    items.extend(sorted(imports,key=lambda i:i["savedAt"],reverse=True))
    settings=prefs.get(kind,{})
    order={key:i for i,key in enumerate(settings.get("order",[]))}
    hidden=set(settings.get("hidden",[]))
    removed=set(settings.get("removedBuiltins",[]))
    for item in items:
        item["visible"]=item["id"] not in hidden
        if item["builtin"] and item["id"] in removed:
            item["removed"]=True
    if not include_removed:
        items=[item for item in items if not item.get("removed")]
    return sorted(items,key=lambda i:order.get(i["id"],len(order)))

def catalog(include_removed=False):
    with library_lock():
        prefs=preferences()
        return {kind:read_items(kind,prefs,include_removed) for kind in FOLDERS}

def clean_name(name):
    if not isinstance(name,str) or not 1<=len(name.strip())<=80:
        raise ValueError("素材名称应为 1 到 80 个字。")
    return name.strip()

def store_item(kind,data,name):
    name=clean_name(name)
    if kind=="font":
        ext=MAGICS.get(data[:4])
        if not ext or len(data)<16:
            raise ValueError("请选择有效的 TTF、OTF、WOFF 或 WOFF2 字体。")
    else:
        data,_=normalize_image(data)
        ext="png"
    file=hashlib.sha256(data).hexdigest()+"."+ext
    target=item_dir(kind,file)
    with library_lock():
        meta=target/"item.json"
        if meta.is_file():
            return {"created":False,"item":json.loads(meta.read_bytes())}
        target.mkdir(parents=True,exist_ok=True)
        write_atomic(target/source_name(file),data)
        if kind!="font":
            with Image.open(io.BytesIO(data)) as im:
                small=im.convert("RGBA")
                small.thumbnail((372,240),Image.Resampling.LANCZOS)
                buf=io.BytesIO()
                small.save(buf,format="PNG")
            write_atomic(target/"preview.png",buf.getvalue())
        item=dict(name=name,file=file,savedAt=datetime.now(timezone.utc).isoformat())
        write_json(meta,item)
        return {"created":True,"item":item}

def save_artwork(project,kind,payload):
    file=check_file(kind,payload.get("file"))
    doc=json.loads((project/"cover.json").read_bytes())
    layer=next((l for l in doc["layers"] if l["id"]==payload.get("layer")),None)
    expected={"font":"text","sticker":"image"}.get(kind,kind)
    if not layer or layer["kind"]!=expected or layer.get("font" if kind=="font" else "src")!=file or (kind=="background" and layer.get("preset")!="image"):
        raise ValueError("请先选中与此分类匹配的图层。")
    return store_item(kind,(project/"assets"/file).read_bytes(),payload.get("name"))

def use_artwork(project,kind,file):
    target=item_dir(kind,file)
    with library_lock():
        meta=target/"item.json"
        if not meta.is_file():
            raise ValueError("素材已移除，请刷新素材库。")
        item=json.loads(meta.read_bytes())
        data=(target/source_name(file)).read_bytes()
    if hashlib.sha256(data).hexdigest()!=file.split(".")[0]:
        raise ValueError("素材文件发生变化。")
    path=project/"assets"/file
    if not path.is_file():
        write_atomic(path,data)
    return item

def preview_file(kind,key):
    directory=item_dir(kind,key)
    return directory/(source_name(key) if kind=="font" else "preview.png")

def recycle(directory):
    path=directory.resolve(strict=True)
    if not path.is_relative_to(LIBRARY.resolve()) or path.parent.name!="items" or not path.is_dir() or directory.is_symlink():
        raise ValueError("素材目录无效。")
    if os.name=="nt":
        script=("$ErrorActionPreference='Stop'; $bin=(New-Object -ComObject Shell.Application).Namespace(10); "
                "if(!$bin){throw 'Recycle Bin unavailable'}; $bin.MoveHere($env:COVER_RECYCLE_ITEM,0x414)")
        subprocess.run(["powershell.exe","-NoProfile","-NonInteractive","-Command",script],
                       env={**os.environ,"COVER_RECYCLE_ITEM":str(path)},check=True,
                       creationflags=subprocess.CREATE_NO_WINDOW)
        for _ in range(30):
            if not path.exists(): return
            time.sleep(.1)
    else:
        try:
            from send2trash import send2trash
        except ImportError:
            raise ValueError("系统回收站不可用，素材已保留。")
        send2trash(str(path))
    if path.exists():
        raise ValueError("未能移入系统回收站，素材已保留。")

def manage(kind,op,payload):
    with library_lock():
        prefs=preferences()
        items=read_items(kind,prefs,include_removed=True)
        key=payload.get("id")
        ids=[i["id"] for i in items]
        if key not in ids:
            raise ValueError("素材已变化，请刷新。")
        settings=prefs.setdefault(kind,{})
        hidden=set(settings.get("hidden",[]))
        removed=set(settings.get("removedBuiltins",[]))
        if op=="restore":
            if key not in BUILTINS[kind]: raise ValueError("请选择内置素材。")
            removed.discard(key)
        elif key in removed:
            raise ValueError("该素材已移除，请刷新。")
        elif op=="visible":
            if type(payload.get("visible")) is not bool: raise ValueError("请选择显示状态。")
            (hidden.discard if payload["visible"] else hidden.add)(key)
        elif op=="order":
            anchor=payload.get("anchor")
            if anchor not in ids or anchor in removed or anchor==key: raise ValueError("排序位置已变化。")
            ids.remove(key)
            ids.insert(ids.index(anchor)+int(payload.get("after") is True),key)
        elif op=="delete":
            if key in BUILTINS[kind]:
                removed.add(key)
            else:
                recycle(item_dir(kind,key))
                ids.remove(key)
                hidden.discard(key)
        elif op=="rename":
            if key in BUILTINS[kind]: raise ValueError("请选择个人素材。")
            file=item_dir(kind,key)/"item.json"
            item=json.loads(file.read_bytes())
            item["name"]=clean_name(payload.get("name"))
            write_json(file,item)
        else:
            raise ValueError("未知的素材操作。")
        settings.update(order=ids,hidden=sorted(hidden.intersection(ids)),removedBuiltins=sorted(removed))
        write_json(LIBRARY/"display.json",prefs)
        return {"items":read_items(kind,prefs)}
