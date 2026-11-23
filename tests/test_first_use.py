"""Browser regression: onboard or skip once across fresh drafts; keep data outside the install."""
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from urllib.request import Request, urlopen

from PIL import Image
from playwright.sync_api import expect, sync_playwright

SCRIPT = Path(__file__).resolve().parents[1]/"scripts"/"cover_workbench.py"


class FirstUseTest(unittest.TestCase):
    def setUp(self):
        evidence = os.environ.get("COVER_TEST_ARTIFACTS")
        if evidence:
            self.root = Path(tempfile.mkdtemp(dir=evidence))
        else:
            temp = tempfile.TemporaryDirectory()
            self.addCleanup(temp.cleanup)
            self.root = Path(temp.name)
        pw = sync_playwright().start()
        self.addCleanup(pw.stop)
        options = {"channel":os.environ["COVER_TEST_BROWSER"]} if os.environ.get("COVER_TEST_BROWSER") else {}
        self.browser = pw.chromium.launch(**options)
        self.addCleanup(self.browser.close)

    def open_draft(self, name, *options):
        project = self.root/name
        env = dict(os.environ, COVER_WORKBENCH_DATA_DIR=str(self.root/"user-data"), PYTHONDONTWRITEBYTECODE="1")
        proc = subprocess.Popen([sys.executable,"-B",str(SCRIPT),"serve",str(project),"--output-dir",str(self.root/"finished"),*options],env=env)
        def stop():
            if proc.poll() is None:
                proc.terminate()
                proc.wait(timeout=10)
        self.addCleanup(stop)
        record = project/".workbench.json"
        for _ in range(150):
            if record.is_file() or proc.poll() is not None:
                break
            time.sleep(.1)
        self.assertTrue(record.is_file(),"工作台未启动")
        url = "http://127.0.0.1:"+str(json.loads(record.read_bytes())["port"])
        page = self.browser.new_page()
        self.addCleanup(page.close)
        with page.expect_response(lambda response: response.url == url+"/api/portrait/welcome"):
            page.goto(url)
        expect(page.locator("#review")).to_be_enabled()
        return page, project, url

    def test_import_appears_in_cover_and_next_library(self):
        page,project,url = self.open_draft("first")
        expect(page.locator("#portrait-welcome")).to_be_visible()
        stream = io.BytesIO()
        Image.new("RGBA",(32,48),(23,87,165,150)).save(stream,"PNG")
        page.locator("#welcome-file").set_input_files({"name":"人物示例.png","mimeType":"image/png","buffer":stream.getvalue()})
        expect(page.locator("#portrait-welcome")).to_be_hidden()
        draft = json.loads((project/"cover.json").read_bytes())
        people = [layer for layer in draft["canvases"]["portrait"]["layers"] if layer["kind"]=="character"]
        self.assertEqual(len(people),1)
        person = people[0]
        self.assertEqual(person["sourceLabel"],"人物示例")
        self.assertTrue((project/"assets"/person["src"]).is_file())
        self.assertTrue(all(not any(l["kind"]=="character" for l in canvas["layers"])
                            for key,canvas in draft["canvases"].items() if key!="portrait"))
        next_page,_,next_url = self.open_draft("second")
        catalog = json.load(urlopen(next_url+"/api/catalog",timeout=5))
        self.assertEqual([item["file"] for item in catalog["character"]],[person["src"]])
        expect(next_page.locator("#portrait-welcome")).to_be_hidden()
        expect(next_page.locator("#new-character")).to_be_hidden()
        next_doc=json.load(urlopen(next_url+"/api/draft"))
        for canvas in next_doc["canvases"].values():
            self.assertEqual([l["src"] for l in canvas["layers"] if l["kind"]=="character"],[person["src"]])
        self.assertEqual(draft["canvases"]["portrait"]["layout"][-1]["x"],
                         next_doc["canvases"]["portrait"]["layout"][-1]["x"])
        skipped,_,_=self.open_draft("third","--skip-character","--skip-screenshot")
        expect(skipped.locator("#new-character")).to_be_visible()
        expect(skipped.locator("#shot-welcome")).to_be_hidden()
        self.assertEqual(len(json.load(urlopen(url+"/api/catalog"))["character"]),1)

    def test_edit_and_export_only_current_format(self):
        page,project,url=self.open_draft("isolated","--skip-character","--skip-screenshot","--title","Original")
        def export_pixel_digests():
            draft=json.load(urlopen(url+"/api/draft"))
            request=Request(url+"/api/confirm",data=json.dumps({
                "formats":list(draft["canvases"]),"revision":draft["revision"],
                "projectId":draft["projectId"],"outputDir":str(self.root/"finished")
            }).encode(),headers={"X-Cover-Workbench":"1"})
            with urlopen(request) as response:
                self.assertTrue(json.load(response)["confirmed"])
            files=json.loads(subprocess.check_output([sys.executable,"-B",str(SCRIPT),"finish",str(project)]))
            pixels={}
            for key,path in files.items():
                with Image.open(path) as im:
                    pixels[key]=hashlib.sha256(im.tobytes()).hexdigest()
            return pixels
        before=export_pixel_digests()
        text=page.locator("textarea[data-field=text]")
        text.fill("Portrait only")
        page.locator("#new-text").click()
        page.locator('[data-format="wide"]').click()
        page.locator('[data-id="title"] .pick').click()
        expect(text).to_have_value("Original")
        expect(page.locator("#undo")).to_be_disabled()
        text.fill("Wide only")
        page.locator("#undo").click()
        expect(text).to_have_value("Original")
        page.locator('[data-format="portrait"]').click()
        page.locator('[data-id="title"] .pick').click()
        expect(text).to_have_value("Portrait only")
        expect(page.locator("#save-state")).to_have_text("已同步")
        page.reload()
        expect(text).to_have_value("Portrait only")
        after=export_pixel_digests()
        self.assertNotEqual(after["portrait"],before["portrait"])
        for key in ("main","wide","wechat"):
            self.assertEqual(before[key],after[key],key)

    def test_open_legacy_draft_then_add_media_to_one_format(self):
        project=self.root/"legacy"
        project.mkdir()
        (project/"assets").mkdir()
        sizes={"portrait":(1080,1440),"main":(1440,1080),"wide":(1920,1080)}
        legacy={"schema":1,"revision":7,"projectId":"legacy","name":"Legacy",
                "layers":[{"kind":"background","id":"background","name":"Background","color":"#ffffff"}],
                "layouts":{k:[{"id":"background","x":0,"y":0,"w":w,"h":h,"rotation":0,"fs":72,
                               "visible":True,"locked":True}] for k,(w,h) in sizes.items()}}
        file=project/"cover.json"
        saved=json.dumps(legacy).encode()
        file.write_bytes(saved)
        _,_,url=self.open_draft("legacy")
        original=json.load(urlopen(url+"/api/draft"))
        self.assertEqual(original["schema"],2)
        self.assertEqual(file.read_bytes(),saved)
        sample=self.root/"shot.png"
        Image.new("RGB",(60,40),"#235680").save(sample)
        cmd=[sys.executable,"-B",str(SCRIPT),"add-media",str(project),"--screenshot",str(sample),"--format","wide"]
        self.assertEqual(json.loads(subprocess.check_output(cmd))["added"],1)
        self.assertEqual(json.loads(subprocess.check_output(cmd))["added"],0)
        updated=json.load(urlopen(url+"/api/draft"))
        self.assertEqual(set(updated["canvases"]),{"portrait","main","wide","wechat"})
        self.assertEqual(len(updated["canvases"]["wide"]["layers"]),2)
        for key in ("portrait","main","wechat"):
            self.assertEqual(original["canvases"][key],updated["canvases"][key])
        self.assertEqual(updated["revision"],8)

    def test_skip_persists_and_manual_entry_remains(self):
        page,_,url = self.open_draft("first")
        page.locator("#welcome-skip").click()
        expect(page.locator("#portrait-welcome")).to_be_hidden()
        expect(page.locator("#shot-welcome")).to_be_visible()
        page.locator("#shot-skip").click()
        page.reload()
        expect(page.locator("#review")).to_be_enabled()
        expect(page.locator("#shot-welcome")).to_be_hidden()
        next_page,_,_ = self.open_draft("second")
        expect(next_page.locator("#portrait-welcome")).to_be_hidden()
        expect(next_page.locator("#new-character")).to_be_visible()
        self.assertEqual(json.load(urlopen(url+"/api/catalog"))["character"],[])

    def test_browser_and_chat_place_the_same_screenshot(self):
        sample=self.root/"screen.png"
        Image.new("RGB",(290,170),"#235680").save(sample)
        page,project,url=self.open_draft("browser","--skip-character")
        with page.expect_file_chooser() as picker:
            page.locator("#shot-pick").click()
        picker.value.set_files(sample)
        expect(page.locator("#shot-welcome")).to_be_hidden()
        expect(page.locator("#save-state")).to_have_text("已同步")
        browser_doc=json.load(urlopen(url+"/api/draft"))
        other,chat,chat_url=self.open_draft("chat","--skip-character")
        cmd=[sys.executable,"-B",str(SCRIPT),"add-media",str(chat),"--screenshot",str(sample)]
        result=json.loads(subprocess.check_output(cmd))
        self.assertEqual(result["added"],1)
        self.assertEqual(json.loads(subprocess.check_output(cmd))["revision"],result["revision"])
        chat_doc=json.load(urlopen(chat_url+"/api/draft"))
        left=browser_doc["canvases"]["portrait"]["layout"][-1].copy()
        right=chat_doc["canvases"]["portrait"]["layout"][-1].copy()
        left.pop("id")
        right.pop("id")
        self.assertEqual(left,right)
        for key in ("main","wide","wechat"):
            self.assertEqual(len(browser_doc["canvases"][key]["layers"]),3)
            self.assertEqual(len(chat_doc["canvases"][key]["layers"]),4)


if __name__ == "__main__":
    unittest.main()
