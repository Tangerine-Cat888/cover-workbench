"""Persist review decisions and render only the approved cover formats."""
import base64
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import io
import json
import os
from pathlib import Path
import re
from uuid import uuid4
from cover_host import current_chat, chat_directory

from PIL import Image
from cover_project import ASSETS, IMAGE, FONT, SIZES, write_json

LABELS = {"portrait": "3x4", "main": "4x3", "wide": "16x9", "wechat": "公众号-2.35x1"}

@contextmanager
def review_lock(project, name=".cover-review.lock"):
    with open(project/name, "a+b") as handle:
        if os.name == "nt":
            import msvcrt
            if os.fstat(handle.fileno()).st_size == 0:
                handle.write(b"0")
                handle.flush()
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
        else:
            import fcntl
            fcntl.flock(handle, fcntl.LOCK_EX)
        yield

def read_optional(path):
    return json.loads(path.read_bytes()) if path.is_file() else {}

def destination(project):
    return Path(json.loads((project/".cover-output.json").read_bytes())["directory"])

def bind_output(project, explicit=None, *, resume=False):
    path = project/".cover-output.json"
    current = read_optional(path)
    thread = current_chat()
    if explicit is not None:
        folder = explicit.expanduser().resolve()
    elif current.get("directory") and "threadId" in current and (resume or current["threadId"] == thread):
        return
    else:
        folder = chat_directory(thread)
    if folder is None:
        raise ValueError("未取得当前聊天的独立文件夹。请用 --output-dir 传入该聊天的目录。")
    if folder.exists() and not folder.is_dir():
        raise ValueError("成品位置须为文件夹。")
    updated = {"directory":str(folder), "threadId":thread}
    if current != updated:
        write_json(path, updated)

def draft_info(project):
    data = (project/"cover.json").read_bytes()
    return json.loads(data), hashlib.sha256(data).hexdigest()

def review_state(project):
    doc, digest = draft_info(project)
    record = read_optional(project/"cover-confirmation.json")
    directory = str(destination(project))
    current = record.get("digest") == digest and record.get("outputDir") == directory
    return {"outputDir": directory, "formats": record.get("formats", []),
            "confirmed": current, "revision": doc["revision"]}

def confirm(project, payload):
    formats = payload.get("formats")
    if not isinstance(formats, list) or not formats or any(not isinstance(k, str) or k not in SIZES for k in formats):
        raise ValueError("请勾选至少一个有效画幅。")
    selected = [k for k in SIZES if k in formats]
    doc, digest = draft_info(project)
    directory = str(destination(project))
    if (payload.get("revision") != doc["revision"] or payload.get("projectId") != doc["projectId"]
            or payload.get("outputDir") != directory):
        raise ValueError("草稿或成品目录已变化，请刷新后重新核对。")
    record = read_optional(project/"cover-confirmation.json")
    if (record.get("digest"), record.get("formats"), record.get("outputDir")) != (digest, selected, directory):
        record = dict(id=uuid4().hex, projectId=doc["projectId"], revision=doc["revision"], digest=digest,
                      formats=selected, outputDir=directory, confirmedAt=datetime.now(timezone.utc).isoformat())
        write_json(project/"cover-confirmation.json", record)
    return review_state(project)

def render(project, doc, formats, executable=None):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        if not executable and not Path(pw.chromium.executable_path).is_file():
            for var in ("ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"):
                for suffix in ("Microsoft/Edge/Application/msedge.exe", "Google/Chrome/Application/chrome.exe"):
                    candidate = Path(os.environ.get(var, ""))/suffix
                    if candidate.is_file():
                        executable = str(candidate)
                        break
                if executable:
                    break
        browser = pw.chromium.launch(executable_path=executable)
        page = browser.new_page()
        def local_asset(route):
            url = route.request.url
            base = "http://cover.local/"
            if url == base:
                route.fulfill(body="<meta charset=utf-8><canvas></canvas>", content_type="text/html")
            elif url == base + "canvas.js":
                route.fulfill(path=str(ASSETS/"workbench"/"canvas.js"), content_type="application/javascript")
            elif url.startswith(base+"assets/") and IMAGE.fullmatch(url[len(base+"assets/"):]):
                route.fulfill(path=str(project/"assets"/url.rsplit("/", 1)[1]), content_type="image/png")
            elif url.startswith(base+"assets/") and FONT.fullmatch(url[len(base+"assets/"):]):
                route.fulfill(path=str(project/"assets"/url.rsplit("/", 1)[1]), content_type="font/"+url.rsplit(".",1)[1])
            else:
                route.abort()
        page.route("**/*", local_asset)
        page.goto("http://cover.local/")
        page.evaluate("""async doc => {
            const renderer = await import('/canvas.js');
            await Promise.all([renderer.loadFonts(), renderer.prepare(doc)]);
            window.paint = key => {
                const canvas = document.querySelector('canvas');
                renderer.draw(canvas,doc,key);
                return canvas.toDataURL('image/png').split(',')[1];
            };
        }""", doc)
        results = {}
        for key in formats:
            data = base64.b64decode(page.evaluate("key => window.paint(key)", key), validate=True)
            with Image.open(io.BytesIO(data)) as im:
                if im.format != "PNG" or im.size != SIZES[key]:
                    raise ValueError("成品尺寸与选中画幅不符。")
                im.verify()
            results[key] = data
        browser.close()
        return results

def finish(project, executable=None):
    with review_lock(project):
        binding = read_optional(project/".cover-output.json")
        thread = current_chat()
        if thread and binding.get("threadId") != thread:
            # Older confirmations only stored a path. Honor them if it is this chat's folder.
            if binding.get("threadId") or chat_directory(thread) != destination(project):
                raise ValueError("请从当前聊天重新打开工作台，核对成品位置并确认封面。")
        if not review_state(project)["confirmed"]:
            raise ValueError("请先在工作台核对当前草稿和比例，点击「确认封面」。")
        record = read_optional(project/"cover-confirmation.json")
        doc, _ = draft_info(project)
    output = Path(record["outputDir"])
    receipt_file = project/("cover-delivery-"+record["id"]+".json")
    safe_name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "-", doc["name"]).strip(" .")[:75] or "封面"
    targets = {key: output / f"{safe_name}-封面-{LABELS[key]}-{record['id'][:10]}.png" for key in record["formats"]}
    def delivered():
        receipt = read_optional(receipt_file)
        return bool(receipt) and all(p.is_file() and hashlib.sha256(p.read_bytes()).hexdigest()
                                     == receipt.get("sha256", {}).get(k) for k,p in targets.items())
    images = None if delivered() else render(project, doc, targets, executable)
    with review_lock(project):
        if record != read_optional(project/"cover-confirmation.json") or not review_state(project)["confirmed"]:
            raise ValueError("确认后草稿或画幅已变化，请重新确认。")
        if not delivered():
            if images is None:
                raise ValueError("成品文件发生变化，请重新运行出图。")
            output.mkdir(parents=True, exist_ok=True)
            for key, target in targets.items():
                if target.exists() and target.read_bytes() != images[key]:
                    raise ValueError("同名文件已被修改，已保留原文件。"+str(target))
            for key, target in targets.items():
                if not target.exists():
                    with target.open("xb") as file:
                        file.write(images[key])
            write_json(receipt_file, {"confirmation":record["id"], "sha256":{
                k:hashlib.sha256(v).hexdigest() for k,v in images.items()}})
    return {k:str(v) for k,v in targets.items()}
