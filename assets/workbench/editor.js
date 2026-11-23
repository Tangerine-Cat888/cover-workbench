import {sizes,formatNames,loadFonts,loadProjectFont,hasBrush,prepare,loadImage,imageAspect,draw,hit,paperDefault,tintDefault,paintWashSample} from "/canvas.js";
import {reload as refreshLibrary,visibleItems,startLibrary,mountChoices,catalogHas,openCollectForm} from "/library.js";
import {previewCutout} from "/cutout.js";
const $=s=>document.querySelector(s);
const canvas=$("#canvas"), paper=$("#paper"), stage=$("#stage"), outline=$("#selection");
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const icons={
 eye:'<path d="M2 12s3-6 10-6 10 6 10 6-3 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/>',
 hidden:'<path d="M3 3l18 18M3 11s3-5 9-5c5 0 8 3 10 6M4 15c2 2 5 3 8 3"/>',
 lock:'<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 018 0v3"/>'
};
const icon=id=>'<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">'+icons[id]+'</svg>';
let doc,key="portrait",active="title",scale=1,rev=0,seq=0,saved=0,timer,saving,conflict=false,redraw=0,gesture=null,uploadJob=null,messageTimer;
const undoStack=[],redoStack=[];
const layers=()=>doc.layouts[key];
const model=(id=active)=>doc.layers.find(l=>l.id===id);
const pos=(id=active)=>layers().find(l=>l.id===id);
function info(text,link){
  const el=$("#feedback");clearTimeout(messageTimer);el.replaceChildren(document.createTextNode(text));el.hidden=false;
  if(link){const a=document.createElement("a");a.href=link;a.target="_blank";a.rel="noopener";a.textContent="查看 PNG";el.append(a)}
  messageTimer=setTimeout(()=>el.hidden=true,link?11000:4600);
}
async function request(path,body,headers={}){
  const response=await fetch(path,body===undefined?{}:{method:"POST",headers:{"X-Cover-Workbench":"1",...headers},body});
  const result=await response.json();if(!response.ok){const err=new Error(result.error||"操作失败");err.status=response.status;throw err}return result;
}
function setStatus(s){$("#save-state").textContent=s}
function dirty(){seq++;setStatus("待保存");clearTimeout(timer);if(!conflict)timer=setTimeout(()=>save().catch(report),550);}
function report(e){info(e.message||String(e));if(seq!==saved)setStatus(conflict?"有版本冲突":"尚未保存")}
async function save(){
  clearTimeout(timer);
  if(conflict)throw new Error("本页有版本冲突。请先备份，再刷新。");
  if(saving){await saving;if(saved<seq)return save();return}
  if(saved===seq)return;
  saving=(async()=>{
    while(saved<seq){
      const snapshot=seq;setStatus("正在保存");doc.revision=rev;
      try{const result=await request("/api/draft",JSON.stringify(doc),{"Content-Type":"application/json"});
        rev=result.revision;doc.revision=rev;saved=snapshot;
      }catch(e){if(e.status===409){conflict=true;$("#backup").hidden=false}throw e}
    }setStatus("已同步");
  })();
  try{await saving}finally{saving=null}
}
function backup(){const blob=new Blob([JSON.stringify(doc,null,2)],{type:"application/json"});const u=URL.createObjectURL(blob),a=document.createElement("a");a.href=u;a.download="cover-conflict.json";a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)}
function checkpoint(){undoStack.push(JSON.stringify(doc));if(undoStack.length>55)undoStack.shift();redoStack.length=0;historyButtons()}
function historyButtons(){$("#undo").disabled=!undoStack.length;$("#redo").disabled=!redoStack.length}
function history(from,to){if(!from.length)return;creating=null;choiceVersion++;to.push(JSON.stringify(doc));doc=JSON.parse(from.pop());doc.revision=rev;if(!model())active=doc.layers.at(-1).id;renderUI();dirty()}
function change(fn){checkpoint();creating=null;choiceVersion++;fn();renderUI();dirty()}
function remember(){try{localStorage.setItem("cover-ui-"+doc.projectId,JSON.stringify({key,active}))}catch{}}
function select(id){if(!model(id))return;creating=null;choiceVersion++;active=id;remember();renderUI()}
function queueDraw(){if(redraw)return;redraw=requestAnimationFrame(()=>{
  redraw=0;draw(canvas,doc,key);showOutline();
  const sample=$("#wash-sample");
  if(sample){const p=pos("background");paintWashSample(sample,model("background"),key,p.w,p.h)}
})}
function showOutline(){
  const p=pos();outline.hidden=!p||!p.visible||p.locked||active==="background";if(outline.hidden)return;
  Object.assign(outline.style,{left:p.x*scale+"px",top:p.y*scale+"px",width:p.w*scale+"px",height:p.h*scale+"px",transform:"rotate("+p.rotation+"deg)"});
}
function fit(){
  if(!doc)return;const [w,h]=sizes[key];const gap=stage.clientWidth<430?22:54;
  scale=Math.max(.04,Math.min((stage.clientWidth-gap)/w,(stage.clientHeight-24)/h));
  paper.style.width=w*scale+"px";paper.style.height=h*scale+"px";
  $("#dimensions").textContent=formatNames[key]+"  ·  "+w+" × "+h;$("#zoom").textContent="适应窗口  "+Math.round(scale*100)+"%";showOutline();
}
let shotSkipped=false;
function drawLayers(){
  $("#shot-welcome").hidden=shotSkipped||doc.skipScreenshotHint||doc.layers.some(l=>l.kind==="image"&&l.role!=="sticker");
  if(doc.layers.some(l=>l.kind==="character"))$("#portrait-welcome").hidden=true;
  $("#layer-count").textContent=doc.layers.length;
  $("#new-character").hidden=doc.layers.some(l=>l.kind==="character");
  $("#layers").innerHTML=[...layers()].reverse().map(p=>{
    const l=model(p.id),src=l.src||l.parts?.[0];
    const mini=src?'<img alt="" src="/assets/'+esc(src)+'">':l.kind==="text"?"T":"▧";
    return '<div class="layer-row '+(p.id===active?"active":"")+'" data-id="'+esc(p.id)+'"><button class="pick" data-act="pick"><span class="mini">'+mini+'</span><span>'+esc(l.name)+'</span></button>'+
      (p.locked?'<span title="已锁定" class="bare">'+icon("lock")+'</span>':'')+
      '<button class="bare" data-act="visibility" aria-label="'+(p.visible?'隐藏':'显示')+esc(l.name)+'">'+icon(p.visible?"eye":"hidden")+'</button></div>';
  }).join("");
  const idx=layers().indexOf(pos());$("#raise").disabled=idx<=0||idx===layers().length-1;$("#lower").disabled=idx<=1;
}
const field=(label,input)=>'<label class="field">'+label+input+'</label>';
const group=(label,inner)=>'<section class="group"><h3>'+esc(label)+'</h3>'+inner+'</section>';
const inp=(id,type,value,extra="")=>'<input data-field="'+id+'" type="'+type+'" value="'+esc(value)+'" '+extra+'>';
const selectField=(id,options,val)=>'<select data-field="'+id+'">'+options.map(([v,n])=>'<option value="'+v+'" '+(v===val?"selected":"")+'>'+esc(n)+'</option>').join("")+'</select>';
const button=(id,name)=>'<button type="button" data-action="'+id+'">'+name+'</button>';
const pair=(a,b)=>'<div class="pair">'+a+b+'</div>';
function layerAsset(layer){
  const kind=({text:"font",image:"sticker"})[layer.kind]||layer.kind;
  if(kind==="background"&&layer.preset!=="image")return null;
  const file=kind==="font"?layer.font:layer.src;
  if(!file)return null;
  const builtinId=kind==="font"&&!file.includes(".")?file:null;
  if(builtinId&&!catalogHas(kind,builtinId))return null;
  const name=(kind==="font"?layer.fontLabel:layer.sourceLabel)||layer.name;
  return {kind,file,layer:layer.id,layerName:layer.name,name:layer.cutoutOriginal?name.slice(0,74)+" · 透明底":name,
    saved:!!builtinId||catalogHas(kind,file)};
}
function saveAssetButton(layer){
  const asset=layerAsset(layer);
  if(!asset)return "";
  return asset.saved?'<button type="button" class="asset-saved" disabled>已在素材库</button>':button("collect","保存到素材库");
}
let creating=null,choiceVersion=0,pendingChoice=null;
const choicesBox='<div class="image-options"></div>';
const mediaRectangles=JSON.parse($("#media-rectangles").textContent);
function mediaSlots(kind,aspect){
  const index=doc.layers.filter(l=>l.kind==="image"&&l.role!=="sticker").length;
  const result={};
  for(const [format,[w,h]] of Object.entries(sizes)){
    const options=mediaRectangles[format==="portrait"?"portrait":"landscape"][kind];
    const box=options[index%options.length];
    const width=Math.min(w*box.w,h*box.h*aspect),height=width/aspect;
    const x="right" in box?w*box.right-width:w*box.x;
    const y="bottom" in box?h*box.bottom-height:h*box.y;
    result[format]={x:Math.round(x),y:Math.round(y),w:Math.max(1,Math.round(width)),h:Math.max(1,Math.round(height)),
      fs:72,rotation:box.rotation,visible:true,locked:false};
  }
  return result;
}
function addArtwork(kind,file,name,positions){
  const layer={kind:kind==="sticker"?"image":"character",name,src:file,fit:"contain",sourceLabel:name};
  if(kind==="sticker")Object.assign(layer,{role:"sticker",frame:false});
  addLayer(layer,imageAspect(file),positions);
}
function fillChoices(kind,layer){
  const file=layer?.src;
  const selected=kind==="background"&&layer?.preset!=="image"?layer?.preset:file;
  const projectItem=file?{project:true,id:file,file,name:layer.sourceLabel||(kind==="background"?"本期背景":layer.name)}:null;
  mountChoices($("#properties .image-options"),kind,selected,projectItem);
  if(kind==="background"&&selected==="lavender"){
    const thumb=$("#properties [data-choice=lavender] .material-preview");
    if(thumb){
      const sample=document.createElement("canvas");sample.id="wash-sample";sample.width=156;sample.height=92;sample.style.touchAction="auto";
      thumb.replaceChildren(sample);queueDraw();
    }
  }
}
async function pickMaterial(kind,item){
  const pending=applyMaterial(kind,item);
  const before=$("#save-state").textContent;
  pendingChoice=pending;
  if(seq===saved)setStatus("正在载入素材");
  try{await pending}finally{
    if(pendingChoice===pending){
      pendingChoice=null;
      if($("#save-state").textContent==="正在载入素材")setStatus(before==="已确认"?"已确认":"已同步");
    }
  }
}
async function applyMaterial(kind,item){
  const id=active,adding=creating,version=++choiceVersion;
  const ref=item.builtin||item.project?null:await request("/api/library/"+kind+"/use",JSON.stringify({file:item.id}),{"Content-Type":"application/json"});
  const file=ref?.file||item.file;
  if(file&&kind!=="font")await loadImage(file);
  if(kind==="font")await loadProjectFont(item.id);
  const positions=adding==="character"?mediaSlots("character",imageAspect(file)):null;
  if(active!==id||creating!==adding||version!==choiceVersion)return;
  const target=model(id);
  change(()=>{
    if(adding)addArtwork(kind,file,item.name,positions);
    else if(kind==="font"){target.font=item.id;target.fontLabel=item.name}
    else if(kind==="background"&&item.builtin)target.preset=item.id;
    else{
      setLayerImage(target,file,item.name);
      if(kind==="sticker")target.name=item.name;
    }
  });
  remember();await save();
}
function fontOptions(layer){
  const rows=visibleItems("font").map(i=>[i.id,i.name]);
  if(!rows.some(([id])=>id===layer.font))rows.push([layer.font,layer.fontLabel||({sans:"黑体",serif:"宋体",ink:"手写体"}[layer.font])||"本期字体"]);
  return rows;
}
function drawProperties(){
  if(creating){
    const label=creating==="character"?"人物":"贴纸";
    $("#properties").innerHTML=group("添加"+label,choicesBox+button("choose-new","选择本机图片")+button("cancel-new","取消"));
    fillChoices(creating,null);return;
  }
  const l=model(),p=pos(),bg=l.kind==="background";let html="";
  const colors=(label="颜色",picker="color",hex="hex",value=l.color)=>pair(field(label,inp(picker,"color",value)),field("色值",inp(hex,"text",value,'maxlength="7"')));
  if(l.kind==="text"){
    html+=group(l.name,field("文字",'<textarea data-field="text" rows="2">'+esc(l.text)+'</textarea>')+
      pair(field("字体",selectField("font",fontOptions(l),l.font)),field("字号",inp("fs","number",Math.round(p.fs),'min="1" max="1200"')))+saveAssetButton(l)+colors()+
      (l.art && l.text===l.artText && l.font==="ink"?'<p class="note">当前使用定稿手写字形。修改文字后按手写字体重排。</p>':l.font==="ink"&&!hasBrush()?'<p class="note">本机未加载手写字库，使用楷体预览。</p>':''));
  }else if(l.kind==="character"){
    const cutout=l.cutoutOriginal?button("restore-portrait","恢复人物原图"):
      l.src?button("cutout","去除背景"):"";
    html+=group("人物",choicesBox+button("replace","从本机换图")+cutout+saveAssetButton(l));
  }else if(bg){
    const palette=l.preset==="lavender"
      ?colors("晕染色","gradientTint","tintHex",l.gradientTint||tintDefault)+colors("纸底色")+button("reset-wash","恢复默认配色（淡紫暖白）")
      :colors();
    html+=group("背景",choicesBox+palette+button("replace","选择背景图片")+saveAssetButton(l)+
      (l.preset==="image"?field("图片缩放 %",inp("zoom","number",l.zoom||100,'min="1" max="800"'))+
        pair(field("水平偏移 %",inp("panX","number",l.panX||0)),field("垂直偏移 %",inp("panY","number",l.panY||0))):""));
  }else{
    html+=group(l.role==="sticker"?"贴纸":"截图",(l.role==="sticker"?choicesBox:"")+(l.parts?.length?l.parts.map((_,i)=>button("part-"+i,"替换第 "+(i+1)+" 张截图")).join("")+button("split","拆成独立图层")+button("replace","改用一张截图"):button("replace",l.role==="sticker"?"从本机换图":"替换截图"))+saveAssetButton(l));
    if(l.frame)html+=field("卡片底色",inp("frameColor","color",l.frameColor||"#fffdf9"));
  }
  if(!bg){
    if(l.kind!=="text"&&!l.parts?.length)html+=group("图片显示",field("适配",selectField("fit",[["contain","完整显示"],["cover","铺满裁切"]],l.fit||"contain"))+
      (l.kind==="image"?field("卡片边框",selectField("frame",[["yes","显示"],["no","隐藏"]],l.frame?"yes":"no")):""));
    const geometry=(name,label)=>field(label,inp(name,"number",Math.round(p[name]),(p.locked?'disabled ':'')+(["w","h"].includes(name)?'min="1"':'')));
    html+=group("当前画幅",pair(geometry("x","X"),geometry("y","Y"))+pair(geometry("w","宽"),geometry("h","高"))+
      pair(geometry("rotation","旋转 °"),field("位置",button("lock",p.locked?"解锁":"锁定"))));
  }
  html+=group("图层",field("名称",inp("name","text",l.name,'maxlength="70"'))+
    '<div class="tools-row">'+button("toggle",p.visible?"隐藏图层":"显示图层")+(!bg?button("remove","移除图层"):"")+'</div>');
  $("#properties").innerHTML=html;
  if(bg||l.kind==="character"||l.role==="sticker")fillChoices(l.role==="sticker"?"sticker":l.kind,l);
}
function renderUI(){
  $("#project-name").textContent=doc.name;document.querySelectorAll("[data-format]").forEach(b=>b.classList.toggle("active",b.dataset.format===key));
  drawLayers();drawProperties();historyButtons();fit();queueDraw();
}
function localField(el,final=false){
  const l=model(),p=pos(),f=el.dataset.field,v=el.value;if(!f)return;
  if(el.dataset.editing!=="yes"){checkpoint();el.dataset.editing="yes"}
  if(["x","y","w","h","fs","rotation","zoom","panX","panY"].includes(f)){
    if(v===""||!Number.isFinite(+v))return;
    const min=["w","h","fs","zoom"].includes(f)?1:-20000;
    const n=Math.min(f==="zoom"?800:20000,Math.max(min,+v));
    if(f==="fs"){
      const factor=n/p.fs;p.w=Math.min(20000,Math.max(1,p.w*factor));p.h=Math.min(20000,Math.max(1,p.h*factor));p.fs=n;
      for(const field of ["w","h"]){const input=$("#properties [data-field="+field+"]");if(input)input.value=Math.round(p[field]);}
    }else if(["zoom","panX","panY"].includes(f))l[f]=n;else p[f]=n;
  }else if(["hex","color","gradientTint","tintHex"].includes(f)){
    if(!/^#[0-9a-f]{6}$/i.test(v))return;
    const tint=f==="gradientTint"||f==="tintHex";l[tint?"gradientTint":"color"]=v;
    const paired={color:"hex",hex:"color",gradientTint:"tintHex",tintHex:"gradientTint"};
    const other=$("#properties [data-field="+paired[f]+"]");if(other)other.value=v;
  }else if(f==="frame")l.frame=v==="yes";
  else if(f==="name"){if(!v.trim())return;l.name=v}
  else if(f==="text")l.text=v.slice(0,2000);
  else l[f]=v;
  dirty();queueDraw();if(f==="name")drawLayers();if(final&&["preset","font","frame"].includes(f))drawProperties();
}
$("#properties").addEventListener("focusin",e=>{if(e.target.dataset.field)delete e.target.dataset.editing});
$("#properties").addEventListener("input",e=>{if(e.target.dataset.field && e.target.tagName!=="SELECT")localField(e.target)});
$("#properties").addEventListener("change",e=>{if(e.target.dataset.field==="font"){const pick=visibleItems("font").find(i=>i.id===e.target.value);if(pick)pickMaterial("font",pick).catch(report)}else if(e.target.dataset.field)localField(e.target,true)});
function upload(action,id){uploadJob={action,id};$("#upload").value="";$("#upload").click()}
function setLayerImage(layer,file,label){
  if(layer.kind==="character")delete layer.cutoutOriginal;
  if(layer.kind==="background"&&(layer.src!==file||layer.preset!=="image")){
    Object.assign(layer,{preset:"image",zoom:100,panX:0,panY:0});
  }
  if(layer.kind==="character"||layer.kind==="background")layer.sourceLabel=label.slice(0,80);
  layer.src=file;
  delete layer.parts;
}
function splitCard(layer){
  const parts=layer.parts.map((file,i)=>({id:"l"+crypto.randomUUID(),kind:"image",name:layer.name+" "+(i+1),src:file,fit:"contain",frame:false}));
  const weights=parts.map(part=>1/imageAspect(part.src)),total=weights.reduce((a,b)=>a+b,0);
  doc.layers.splice(doc.layers.indexOf(layer),1,...parts);
  for(const items of Object.values(doc.layouts)){
    const index=items.findIndex(p=>p.id===layer.id), p=items[index];
    const border=layer.frame?Math.max(7,p.w*.024):0, gap=border*.75;
    const width=Math.max(1,p.w-2*border),inside=Math.max(1,p.h-2*border-gap*(parts.length-1));
    const angle=p.rotation*Math.PI/180;let top=border;
    const boxes=parts.map((part,i)=>{
      const height=Math.max(1,inside*weights[i]/total), dy=top+height/2-p.h/2;top+=height+gap;
      return {...p,id:part.id,w:width,h:height,x:p.x+p.w/2-dy*Math.sin(angle)-width/2,y:p.y+p.h/2+dy*Math.cos(angle)-height/2};
    });
    items.splice(index,1,...boxes);
  }
  active=parts[0].id;
}
$("#properties").addEventListener("click",e=>{
 const tile=e.target.closest("[data-choice]");
 if(tile){
   const layer=model(),kind=creating||(layer.role==="sticker"?"sticker":layer.kind),id=tile.dataset.choice;
   const item=visibleItems(kind).find(i=>i.id===id)||(layer.src===id?{id,file:id,project:true,name:layer.sourceLabel||layer.name}:null);
   if(item&&tile.getAttribute("aria-pressed")!=="true")pickMaterial(kind,item).catch(report);
   return;
 }
 const b=e.target.closest("[data-action]");if(!b)return;const a=b.dataset.action,l=model(),p=pos();
 if(a==="cutout"){
   const {id,src}=l;
   previewCutout({id,src,request,save,loadImage,apply:file=>{
     const target=model(id);
     if(active!==id||target?.src!==src)throw new Error("人物图层已更换，请重新预览。");
     change(()=>{target.cutoutOriginal=src;target.src=file});
   }});return;
 }
 if(a==="restore-portrait"&&l.cutoutOriginal){
   const original=l.cutoutOriginal;
   loadImage(original).then(()=>{if(model()===l&&l.cutoutOriginal===original)
     change(()=>{l.src=original;delete l.cutoutOriginal})}).catch(report);return;
 }
 if(a==="reset-wash"){if(l.preset==="lavender")change(()=>{l.color=paperDefault;delete l.gradientTint});return}
 if(a==="collect"){const asset=layerAsset(l);if(asset&&!asset.saved)openCollectForm(asset.kind,asset);return}
 if(a==="cancel-new"){creating=null;drawProperties();return}
 if(a==="choose-new")return upload(creating,null);
 if(a==="replace"||a.startsWith("part-"))return upload(a,active);
 if(a==="split"&&l.parts?.length)return change(()=>splitCard(l));
 if(a==="lock")return change(()=>p.locked=!p.locked);
 if(a==="toggle")return change(()=>p.visible=!p.visible);
 if(a==="remove"&&l.kind!=="background")change(()=>{doc.layers=doc.layers.filter(i=>i.id!==active);for(const k in doc.layouts)doc.layouts[k]=doc.layouts[k].filter(i=>i.id!==active);active=layers().at(-1).id});
});
const layerList=$("#layers");
let hold=null, ignoreClick=false;
function clearDrop(){
  layerList.querySelectorAll(".drop-before,.drop-after").forEach(el=>el.classList.remove("drop-before","drop-after"));
}
function cancelHold(){
  if(!hold)return;
  clearTimeout(hold.timer);clearDrop();
  layerList.querySelector(".dragging")?.classList.remove("dragging");
  if(layerList.hasPointerCapture(hold.pointer))layerList.releasePointerCapture(hold.pointer);
  hold=null;
}
layerList.addEventListener("pointerdown",e=>{
  ignoreClick=false;
  const row=e.target.closest(".pick")?.closest("[data-id]");
  if(!row||e.button!==0||row.dataset.id==="background")return;
  cancelHold();
  const h={id:row.dataset.id,pointer:e.pointerId,x:e.clientX,y:e.clientY,ready:false,target:null};
  hold=h;
  h.timer=setTimeout(()=>{
    if(hold!==h)return;
    h.ready=true;
    layerList.setPointerCapture(h.pointer);
    row.classList.add("dragging");
  },320);
});
window.addEventListener("pointermove",e=>{
  if(!hold||e.pointerId!==hold.pointer)return;
  if(!hold.ready){
    if(Math.hypot(e.clientX-hold.x,e.clientY-hold.y)>8)cancelHold();
    return;
  }
  const row=document.elementFromPoint(e.clientX,e.clientY)?.closest("#layers [data-id]");
  clearDrop();hold.target=null;
  if(!row||row.dataset.id===hold.id)return;
  const rect=row.getBoundingClientRect();
  hold.after=row.dataset.id!=="background" && e.clientY>rect.top+rect.height/2;
  hold.target=row.dataset.id;
  row.classList.add(hold.after?"drop-after":"drop-before");e.preventDefault();
});
window.addEventListener("pointerup",e=>{
  if(!hold||e.pointerId!==hold.pointer)return;
  const {id,ready,target,after}=hold;
  cancelHold();if(!ready)return;
  ignoreClick=true;
  if(target){
    const display=[...layers()].reverse().filter(p=>p.id!==id);
    display.splice(display.findIndex(p=>p.id===target)+(after?1:0),0,pos(id));
    const next=display.reverse();
    if(next.some((p,i)=>p!==layers()[i])){change(()=>{doc.layouts[key]=next;active=id});remember();return}
  }
  select(id);
});
window.addEventListener("pointercancel",cancelHold);
window.addEventListener("blur",cancelHold);
layerList.addEventListener("contextmenu",e=>{if(hold)e.preventDefault()});
layerList.addEventListener("dragstart",e=>e.preventDefault());
layerList.addEventListener("click",e=>{if(ignoreClick){ignoreClick=false;e.stopImmediatePropagation()}},true);
$("#layers").addEventListener("click",e=>{const button=e.target.closest("[data-act]");if(!button)return;const id=button.closest("[data-id]").dataset.id;if(button.dataset.act==="visibility"){change(()=>pos(id).visible=!pos(id).visible)}else select(id)});
function moveOrder(step){const items=layers(),at=items.indexOf(pos()),to=at+step;if(at<1||to<1||to>=items.length)return;change(()=>[items[at],items[to]]=[items[to],items[at]])}
$("#raise").onclick=()=>moveOrder(1);$("#lower").onclick=()=>moveOrder(-1);
function addLayer(layer,aspect=1.8,positions=null){
  layer.id="l"+crypto.randomUUID();doc.layers.push(layer);
  for(const [k,[w,h]] of Object.entries(sizes)){
    if(positions){
      const items=doc.layouts[k];
      const at=layer.role==="screenshot"?items.findIndex(p=>model(p.id)?.kind==="character"):-1;
      items.splice(at<0?items.length:at,0,{...positions[k],id:layer.id});
      continue;
    }
    const width=Math.round(w*.45);doc.layouts[k].push({id:layer.id,x:Math.round(w*.15),y:Math.round(h*.35),w:width,h:Math.round(Math.min(h*.55,width/aspect)),fs:Math.round(w*.052),visible:true,locked:false,rotation:0});
  }active=layer.id;
}
$("#new-text").onclick=()=>change(()=>addLayer({kind:"text",name:"文字",text:"新文字",font:"sans",color:"#252735"},3.5));
$("#new-image").onclick=()=>{creating=null;drawProperties();upload("new",null)};
for(const kind of ["character","sticker"])$("#new-"+kind).onclick=()=>{choiceVersion++;creating=kind;drawProperties()};
$("#upload").onchange=async e=>{
  const f=e.target.files[0],job=uploadJob;if(!f||!job)return;
  try{const a=await request("/api/image",f);await loadImage(a.file);
    const adding=job.action==="sticker"||job.action==="character";
    const role=job.action==="new"?"screenshot":job.action;
    const positions=["screenshot","character"].includes(role)?mediaSlots(role,a.width/a.height):null;
    if(adding&&creating!==job.action)return;
    if(!adding&&job.action!=="new"&&!model(job.id))return;
    change(()=>{if(adding)addArtwork(job.action,a.file,f.name.replace(/\.[^.]+$/,""),positions);
      else if(job.action==="new")addLayer({kind:"image",name:f.name.replace(/\.[^.]+$/,""),src:a.file,role:"screenshot",frame:true,fit:"contain"},a.width/a.height,positions);
      else{const l=model(job.id);if(job.action.startsWith("part-"))l.parts[+job.action.slice(5)]=a.file;
        else{setLayerImage(l,a.file,f.name.replace(/\.[^.]+$/,""))}}});
  }catch(err){report(err)}
};
function point(e){const r=canvas.getBoundingClientRect();return [(e.clientX-r.left)/scale,(e.clientY-r.top)/scale]}
function begin(e,resize){
  if(e.button!==0)return;const [x,y]=point(e);
  if(!resize){const target=[...layers()].reverse().find(p=>p.visible&&p.id!=="background"&&!p.locked&&hit(p,x,y));select(target?.id||"background");canvas.focus({preventScroll:true})}
  const p=pos();if(p.locked||p.id==="background")return;
  gesture={resize,origin:[x,y],p:structuredClone(p),id:active,moved:false};
  e.currentTarget.setPointerCapture(e.pointerId);e.preventDefault();
}
function drag(e){
  if(!gesture)return;const [x,y]=point(e),[ox,oy]=gesture.origin,p=pos(gesture.id),base=gesture.p,dx=x-ox,dy=y-oy;
  if(!gesture.moved){if(Math.abs(dx)+Math.abs(dy)<2)return;checkpoint();gesture.moved=true}
  if(gesture.resize){
    const rad=base.rotation*Math.PI/180;
    const factor=Math.max(.05,Math.min(12,(base.w*(dx*Math.cos(rad)+dy*Math.sin(rad))+base.h*(-dx*Math.sin(rad)+dy*Math.cos(rad)))/(base.w**2+base.h**2)+1));
    p.w=Math.max(1,Math.min(20000,Math.round(base.w*factor)));p.h=Math.max(1,Math.min(20000,Math.round(base.h*factor)));p.fs=Math.max(1,Math.round(base.fs*factor));
    if(base.artFs)p.artFs=base.artFs*factor;
    const dw=p.w-base.w,dh=p.h-base.h;p.x=base.x+(dw*Math.cos(rad)-dh*Math.sin(rad)-dw)/2;p.y=base.y+(dw*Math.sin(rad)+dh*Math.cos(rad)-dh)/2;
  }else{p.x=Math.max(-20000,Math.min(20000,Math.round(base.x+dx)));p.y=Math.max(-20000,Math.min(20000,Math.round(base.y+dy)))}
  queueDraw();
}
function endDrag(){if(gesture?.moved){dirty();drawProperties()}gesture=null}
for(const el of [canvas,$("#resize")]){el.onpointerdown=e=>begin(e,el!==canvas);el.onpointermove=drag;el.onpointerup=endDrag;el.onpointercancel=endDrag}
document.querySelectorAll("[data-format]").forEach(b=>b.onclick=()=>{key=b.dataset.format;remember();renderUI()});
$("#undo").onclick=()=>history(undoStack,redoStack);$("#redo").onclick=()=>history(redoStack,undoStack);
$("#backup").onclick=backup;
const formatRatios={portrait:"3:4",main:"4:3",wide:"16:9",wechat:"2.35:1"};
const dialog=$("#review-dialog");
let review=null;
function showResult(){
  $("#review-options").hidden=true;
  $("#review-done").hidden=false;
  $("#review-title").textContent="封面已确认";
  $("#approved-formats").textContent=review.formats.map(k=>formatNames[k]+" "+formatRatios[k]).join("、");
  $("#confirmed-output").textContent=review.outputDir;
  setStatus("已确认");
}
$("#review").onclick=async()=>{
  try{
    if(pendingChoice)await pendingChoice;
    await save();
    review=await request("/api/review");
    const selected=review.formats.length?review.formats:[key];
    $("#review-error").textContent="";
    $("#review-options").hidden=false;
    $("#review-done").hidden=true;
    $("#review-title").textContent="确认封面";
    $("#output-dir").textContent=review.outputDir;
    $("#format-options").innerHTML=Object.entries(sizes).map(([k,[w,h]])=>
      '<label><input type="checkbox" value="'+k+'" '+(selected.includes(k)?"checked":"")+
      '><span>'+formatNames[k]+'<small>'+w+' × '+h+'</small></span><b>'+formatRatios[k]+'</b></label>').join("");
    $("#approve-formats").disabled=false;
    dialog.showModal();
  }catch(err){report(err)}
};
$("#format-options").onchange=()=>{$("#approve-formats").disabled=!$("#format-options input:checked")};
$("#approve-formats").onclick=async()=>{
  const button=$("#approve-formats");
  button.disabled=true;
  try{
    await save();
    const formats=[...document.querySelectorAll("#format-options input:checked")].map(el=>el.value);
    review=await request("/api/confirm",JSON.stringify({projectId:doc.projectId,revision:rev,formats,outputDir:review.outputDir}),{"Content-Type":"application/json"});
    showResult();
  }catch(err){$("#review-error").textContent=err.message;button.disabled=false}
};
window.addEventListener("keydown",e=>{
 if($("#cutout-dialog").open)return;
 const input=e.target.closest("input,textarea,select");
 if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="s"){e.preventDefault();save().catch(report);return}
 if(input||!doc||dialog.open||$("#edit-page").hidden)return;
 if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"){e.preventDefault();e.shiftKey?history(redoStack,undoStack):history(undoStack,redoStack);return}
 const offset={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key];
 if(offset&&!pos().locked&&active!=="background"){e.preventDefault();change(()=>{pos().x+=offset[0]*(e.shiftKey?10:1);pos().y+=offset[1]*(e.shiftKey?10:1)})}
});
window.addEventListener("beforeunload",e=>{if(seq!==saved||gesture?.moved||pendingChoice){e.preventDefault();e.returnValue=""}});
new ResizeObserver(fit).observe(stage);
async function dismissWelcome(){
  await request("/api/portrait/welcome","{}");
  $("#portrait-welcome").hidden=true;
}
$("#shot-pick").onclick=()=>upload("new",null);
$("#shot-skip").onclick=()=>{
  shotSkipped=true;$("#shot-welcome").hidden=true;
  try{localStorage.setItem("cover-shot-skip-"+doc.projectId,"1")}catch{}
};
$("#welcome-skip").onclick=()=>dismissWelcome().catch(report);
$("#welcome-file").onchange=async event=>{
  const input=event.target,file=input.files[0];
  if(!file)return;
  const status=$("#welcome-status"),skip=$("#welcome-skip");
  input.disabled=skip.disabled=true;
  status.hidden=false;status.textContent="正在保存人物…";
  try{
    const name=file.name.replace(/\.[^.]+$/,"").slice(0,80)||"我的人物";
    const {item}=await request("/api/library/character/import",file,{"X-Asset-Name":encodeURIComponent(name)});
    const asset=await request("/api/library/character/use",JSON.stringify({file:item.file}));
    await loadImage(asset.file);
    const positions=mediaSlots("character",imageAspect(asset.file));
    if(!doc.layers.some(layer=>layer.kind==="character")){
      change(()=>addArtwork("character",asset.file,item.name,positions));remember();await save();
    }
    await refreshLibrary();await dismissWelcome();info("人物已存入素材库");
  }catch(err){status.textContent=err.message}
  finally{input.value="";input.disabled=skip.disabled=false}
};
try{
 doc=await request("/api/draft");rev=doc.revision;
 try{shotSkipped=localStorage.getItem("cover-shot-skip-"+doc.projectId)==="1"}catch{}
 try{const ui=JSON.parse(localStorage.getItem("cover-ui-"+doc.projectId)||"{}");if(sizes[ui.key])key=ui.key;if(typeof ui.active==="string"&&model(ui.active))active=ui.active}catch{}
 if(!model())active=doc.layers.at(-1).id;
 await Promise.all([prepare(doc),loadFonts()]);renderUI();review=await request("/api/review");setStatus(review.confirmed?"已确认":"已同步");$("#review").disabled=false;
 await startLibrary({request,info,save,fit,updated:()=>{if(!$("#properties :is(input,textarea,select):focus"))drawProperties()}}).catch(report);
  const welcome=await request("/api/portrait/welcome");
  $("#portrait-welcome").hidden=!welcome.show||doc.skipCharacterHint||doc.layers.some(layer=>layer.kind==="character");
}catch(e){setStatus("打开失败");report(e)}
