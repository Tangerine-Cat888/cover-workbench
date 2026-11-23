"""Start or resume one loopback-only cover editor for a project."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
from urllib.parse import urlsplit, unquote
from urllib.request import urlopen
from uuid import uuid4

from PIL import Image
from cover_project import ASSETS, IMAGE, FONT, image_asset, make_draft, validate, write_json
from cover_review import bind_output, confirm, destination, finish, review_lock, review_state
from cover_library import portrait_welcome, FOLDERS, catalog, manage, preview_file, store_item, save_artwork, use_artwork
from cover_media import inputs, insert
from cover_cutout import preview as portrait_preview, setup as setup_cutout

WEB=ASSETS/"workbench"
STATIC={"/":"index.html","/editor.css":"editor.css","/editor.js":"editor.js","/canvas.js":"canvas.js"}
STATIC.update({"/library.js":"library.js","/library.css":"library.css","/cutout.js":"cutout.js"})
LIMIT=32*1024*1024

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):
        pass

    def send(self, status, data, mime="application/json; charset=utf-8"):
        if not isinstance(data,bytes):
            data=json.dumps(data,ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type",mime)
        self.send_header("Content-Length",str(len(data)))
        self.send_header("Cache-Control","no-store")
        self.send_header("X-Content-Type-Options","nosniff")
        self.end_headers()
        self.wfile.write(data)

    def allowed(self, mutation=False):
        authority="127.0.0.1:"+str(self.server.server_port)
        if self.headers.get("Host")!=authority or (mutation and self.headers.get("Origin","http://"+authority)!="http://"+authority):
            self.send(403,{"error":"请从本地工作台打开。"})
            return False
        return True

    def do_GET(self):
        if not self.allowed(): return
        path=urlsplit(self.path).path
        project=self.server.project
        if path=="/api/portrait/welcome":
            self.send(200,portrait_welcome())
            return
        if path=="/api/status":
            self.send(200,{"instance":self.server.instance,"project":str(project)})
            return
        if path=="/api/draft":
            self.send(200,(project/"cover.json").read_bytes())
            return
        if path=="/api/review":
            with review_lock(project):
                self.send(200,review_state(project))
            return
        parts = path.strip("/").split("/")
        if path=="/api/catalog" or (len(parts)==3 and parts[:2]==["api","library"] and parts[2] in FOLDERS):
            try:
                groups=catalog(include_removed=path=="/api/catalog" and urlsplit(self.path).query=="include=removed")
                self.send(200,groups if path=="/api/catalog" else {"items":[i for i in groups[parts[2]] if not i["builtin"]]})
            except (OSError, ValueError, KeyError):
                self.send(400, {"error":"素材库暂时无法读取。"})
            return
        if len(parts)==3 and parts[0]=="library-preview" and parts[1] in FOLDERS:
            try:
                file=preview_file(parts[1],parts[2])
            except ValueError:
                self.send(404,{"error":"素材不存在。"})
                return
        elif path in STATIC:
            file=WEB/STATIC[path]
        elif path.startswith("/assets/") and (IMAGE.fullmatch(path[8:]) or FONT.fullmatch(path[8:])):
            file=project/"assets"/path[8:]
        elif path.startswith("/exports/") and path[9:].isascii() and all(c.isalnum() or c in '-_.' for c in path[9:]) and path.endswith(".png"):
            file=project/"exports"/path[9:]
        else:
            self.send(404,{"error":"找不到资源。"})
            return
        if not file.is_file():
            self.send(404,{"error":"文件不存在。"})
            return
        self.send(200,file.read_bytes(),mimetypes.guess_type(file.name)[0] or "application/octet-stream")

    def do_POST(self):
        if not self.allowed(mutation=True): return
        path=urlsplit(self.path).path
        project=self.server.project
        try:
            if self.headers.get("X-Cover-Workbench")!="1":
                self.send(403,{"error":"请在工作台中操作。"})
                return
            size=int(self.headers.get("Content-Length",0))
            if not 0<size<=(LIMIT if path=="/api/image" or path.endswith("/import") else 1_500_000):
                raise ValueError("文件太大或内容为空。")
            body=self.rfile.read(size)
            if path=="/api/draft":
                updated=json.loads(body)
                validate(updated,project)
                with self.server.write_lock, review_lock(project):
                    original=json.loads((project/"cover.json").read_bytes())
                    if updated["revision"]!=original["revision"] or updated["projectId"]!=original["projectId"]:
                        self.send(409,{"error":"另一页面已经保存了更新。请备份本页草稿，再刷新载入最新版本。"})
                        return
                    updated["revision"]+=1
                    write_json(project/"cover.json",updated)
                    value={"revision":updated["revision"]}
            elif path=="/api/image":
                value=image_asset(project,body)
            elif path=="/api/portrait/welcome":
                value=portrait_welcome(dismiss=True)
            elif path=="/api/portrait/preview":
                value=portrait_preview(project,json.loads(body))
            elif path=="/api/portrait/setup":
                try:
                    setup_cutout()
                except (OSError, subprocess.SubprocessError) as exc:
                    raise ValueError("抠图组件安装失败，请检查网络后重试。") from exc
                value={"ready":True}
            elif path.startswith("/api/library/"):
                parts=path.strip("/").split("/")
                if len(parts)!=4 or parts[2] not in FOLDERS:
                    self.send(404,{"error":"找不到素材库操作。"})
                    return
                op=parts[3]
                payload={} if op=="import" else json.loads(body)
                if op=="import":
                    value=store_item(parts[2],body,unquote(self.headers.get("X-Asset-Name","")))
                elif op=="save":
                    with self.server.write_lock:
                        value=save_artwork(project,parts[2],payload)
                elif op=="use":
                    value=use_artwork(project,parts[2],payload.get("file"))
                else:
                    value=manage(parts[2],op,payload)
            elif path=="/api/confirm":
                with self.server.write_lock, review_lock(project):
                    value=confirm(project,json.loads(body))
            else:
                self.send(404,{"error":"找不到操作。"})
                return
            self.send(200,value)
        except (ValueError,TypeError,KeyError,OSError,AttributeError,subprocess.SubprocessError,Image.DecompressionBombError) as exc:
            self.send(400,{"error":str(exc)[:240]})

def acquire(project):
    lock=open(project/".workbench.lock","a+b")
    lock.seek(0)
    if os.name=="nt":
        import msvcrt
        if os.fstat(lock.fileno()).st_size==0:
            lock.write(b"0"); lock.flush(); lock.seek(0)
        msvcrt.locking(lock.fileno(),msvcrt.LK_NBLCK,1)
    else:
        import fcntl
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    return lock

def live_url(project):
    try:
        info=json.loads((project/".workbench.json").read_bytes())
        port=int(info["port"])
        if not 0<port<65536: return None
        url=f"http://127.0.0.1:{port}"
        with urlopen(url+"/api/status", timeout=.5) as response:
            status=json.load(response)
        if status["instance"]==info["instance"] and Path(status["project"])==project:
            return url+"/"
    except (OSError,ValueError,KeyError):
        return None

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("action",choices=["open","serve","finish","add-media"])
    parser.add_argument("project",type=Path)
    parser.add_argument("--title",default="我的视频封面",help="Use a literal newline between title lines.")
    parser.add_argument("--series",default="");parser.add_argument("--name",default="")
    parser.add_argument("--screenshot",action="append",default=[])
    parser.add_argument("--skip-screenshot",action="store_true",help="Dismiss the screenshot prompt for this draft")
    parser.add_argument("--background")
    parser.add_argument("--font",choices=["ink","sans","serif"],default="sans")
    parser.add_argument("--video",type=Path,help="Local video for actual frame extraction")
    parser.add_argument("--frame-at",type=float,action="append",default=[],metavar="SECONDS")
    portraits=parser.add_mutually_exclusive_group()
    portraits.add_argument("--character",type=Path,help="User-supplied portrait image")
    portraits.add_argument("--skip-character",action="store_true",help="Leave out a previously saved portrait")
    parser.add_argument("--output-dir",type=Path,help="Dedicated chat folder or an explicitly requested destination for final PNGs")
    parser.add_argument("--port",type=int,default=0)
    parser.add_argument("--browser",help="Chromium executable for final rendering")
    args=parser.parse_args()
    project=args.project.resolve()
    if args.action=="finish":
        try:
            print(json.dumps(finish(project,args.browser),ensure_ascii=False))
        except (ValueError,OSError) as exc:
            parser.exit(1,str(exc)+"\n")
        return
    if args.action=="add-media":
        file=project/"cover.json"
        if not file.is_file():
            parser.exit(1,"请先打开已有草稿。\n")
        try:
            materials=inputs(args,project)
            if not materials:
                raise ValueError("请选择视频、截图或人物。")
            with review_lock(project):
                doc=json.loads(file.read_bytes())
                added=insert(doc,materials)
                if added:
                    doc["revision"]+=1
                    validate(doc,project)
                    write_json(file,doc)
            print(json.dumps({"added":len(added),"revision":doc["revision"],"draft":str(file)},ensure_ascii=False))
        except (ValueError,OSError) as exc:
            parser.exit(1,str(exc)+"\n")
        return
    project.mkdir(parents=True,exist_ok=True)
    if args.action=="serve":
        with acquire(project), ThreadingHTTPServer(("127.0.0.1",args.port),Handler) as server:
            with review_lock(project):
                try:
                    bind_output(project,args.output_dir,resume=True)
                    make_draft(project,args)
                except (ValueError,OSError) as exc:
                    parser.exit(1,str(exc)+"\n")
            validate(json.loads((project/"cover.json").read_bytes()),project)
            server.project=project
            server.instance=uuid4().hex
            server.write_lock=threading.Lock()
            write_json(project/".workbench.json",{"port":server.server_port,"instance":server.instance,"pid":os.getpid()})
            server.serve_forever()
        return
    with review_lock(project):
        try:
            bind_output(project,args.output_dir)
            make_draft(project,args)
        except (ValueError,OSError) as exc:
            parser.exit(1,str(exc)+"\n")
    url=live_url(project)
    if not url:
        project.mkdir(parents=True,exist_ok=True)
        command=[sys.executable,str(Path(__file__).resolve()),"serve",str(project),*sys.argv[3:]]
        launch={"creationflags":subprocess.CREATE_NO_WINDOW|subprocess.CREATE_NEW_PROCESS_GROUP} if os.name=="nt" else {"start_new_session":True}
        with open(project/".workbench.log","ab") as log:
            process=subprocess.Popen(command,stdin=subprocess.DEVNULL,stdout=log,stderr=log,**launch)
        for _ in range(100):
            url=live_url(project)
            if url: break
            if process.poll() is not None and _>10: break
            time.sleep(.1)
        if not url:
            raise SystemExit(f"工作台启动失败。查看 {project/'.workbench.log'}")
    print(json.dumps({"url":url,"draft":str(project/"cover.json"),"outputDir":str(destination(project))},ensure_ascii=False))

if __name__=="__main__":
    main()
