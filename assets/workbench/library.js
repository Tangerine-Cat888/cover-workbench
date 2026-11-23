const el=id=>document.getElementById(id);
const types={character:"IP 人物",background:"背景",font:"字体",sticker:"贴纸"};
const marks={character:"人",background:"▧",font:"Aa",sticker:"✦"};
let groups={},kind="character",chosen=null,op=null,dragKey=null,busy=false,loadVersion=0;
let api,removedGroups={};
export const visibleItems=kind=>(groups[kind]||[]).filter(i=>i.visible);
export const catalogHas=(kind,id)=>(groups[kind]||[]).some(item=>item.id===id);
const previewFonts=new Set();
function preview(kind,item){
  const box=document.createElement("span");box.className="material-preview "+kind;
  if(kind==="font"){
    let family={sans:'"Microsoft YaHei",sans-serif',serif:'SimSun,serif',ink:'CoverBrush,KaiTi,serif'}[item.id];
    if(!item.builtin){
      family="Library"+item.id.split(".")[0];
      if(!previewFonts.has(family)){
        const style=document.createElement("style");
        style.textContent='@font-face{font-family:'+family+';src:url("/library-preview/font/'+item.id+'");font-display:swap}';
        document.head.append(style);previewFonts.add(family);
      }
    }
    box.style.fontFamily=family;box.textContent="字 Aa";
  }else if(kind==="background"&&item.builtin){
    box.classList.add("swatch-"+item.id);
  }else{
    const img=new Image();img.loading="lazy";img.alt="";img.src=item.project?"/assets/"+item.file:"/library-preview/"+kind+"/"+item.id;
    box.append(img);
  }
  return box;
}
function makeButton(text,cls){
  const button=document.createElement("button");button.type="button";button.textContent=text;button.className=cls;return button;
}
export function mountChoices(holder,kind,selected,projectItem){
  const known=groups[kind]||[],items=known.filter(i=>i.visible);
  if(projectItem&&!known.some(i=>i.id===projectItem.id))items.push(projectItem);
  for(const item of items){
    const pick=makeButton("","image-option");pick.dataset.choice=item.id;
    pick.title=item.name;pick.setAttribute("aria-pressed",String(selected===item.id));
    const tile=preview(kind,item),caption=document.createElement("span");
    caption.className="option-caption";caption.textContent=item.name;pick.append(tile,caption);
    holder.append(pick);
  }
  if(!items.length)holder.hidden=true;
}
let menuSource=null;
function selectCard(card){
  chosen=card.dataset.id;
  for(const node of el("catalog-grid").children){
    const active=node===card;node.classList.toggle("selected",active);
    node.querySelector(".material-pick").setAttribute("aria-pressed",String(active));
  }
}
function closeMenu(focus=false){
  el("asset-menu").hidden=true;
  if(menuSource){menuSource.setAttribute("aria-expanded","false");if(focus&&menuSource.isConnected)menuSource.focus({preventScroll:true})}
  menuSource=null;
}
function showMenu(card,x,y){
  closeMenu();selectCard(card);
  const items=groups[kind],at=items.findIndex(i=>i.id===chosen);
  el("earlier").disabled=at===0;el("later").disabled=at===items.length-1;
  el("rename-asset").hidden=items[at].builtin;
  const menu=el("asset-menu");menuSource=card.querySelector(".material-more");
  menuSource.setAttribute("aria-expanded","true");menu.hidden=false;
  menu.style.left=Math.max(4,Math.min(x,innerWidth-menu.offsetWidth-4))+"px";
  menu.style.top=Math.max(4,Math.min(y,innerHeight-menu.offsetHeight-4))+"px";
  menu.querySelector("button:not(:disabled):not([hidden])").focus({preventScroll:true});
}
function renderLibrary(){
  closeMenu();
  const items=groups[kind]||[];
  el("catalog-title").textContent=types[kind];
  el("catalog-summary").textContent=items.length+" 项素材 · "+items.filter(i=>i.visible).length+" 项显示在工作台";
  for(const button of el("categories").children){
    button.setAttribute("aria-pressed",String(button.dataset.kind===kind));
    button.lastChild.textContent=(groups[button.dataset.kind]||[]).length;
  }
  if(!items.some(i=>i.id===chosen))chosen=items[0]?.id??null;
  const grid=el("catalog-grid");grid.replaceChildren();
  for(const item of items){
    const card=document.createElement("article");card.className="material-card";card.dataset.id=item.id;card.draggable=true;
    card.classList.toggle("selected",chosen===item.id);
    const pick=makeButton("","material-pick");pick.title=item.name;pick.setAttribute("aria-pressed",String(chosen===item.id));
    const name=document.createElement("strong");name.textContent=item.name;pick.append(preview(kind,item),name);
    pick.onclick=()=>selectCard(card);
    const label=document.createElement("label");label.className="display-toggle";
    const checkbox=document.createElement("input");checkbox.type="checkbox";checkbox.checked=item.visible;
    checkbox.setAttribute("aria-label",item.name+"显示到工作台");label.append(checkbox,"显示到工作台");
    checkbox.onchange=()=>perform(()=>update("visible",{id:item.id,visible:checkbox.checked}));
    const more=makeButton("⋯","material-more");more.title="更多操作（也可右键）";
    more.setAttribute("aria-label",item.name+"的操作");more.setAttribute("aria-haspopup","menu");more.setAttribute("aria-expanded","false");
    more.onclick=()=>{if(menuSource===more){closeMenu();return}const rect=more.getBoundingClientRect();showMenu(card,rect.left,rect.bottom+3)};
    card.oncontextmenu=e=>{e.preventDefault();showMenu(card,e.clientX,e.clientY)};
    card.onkeydown=e=>{if(e.key==="ContextMenu"||(e.shiftKey&&e.key==="F10")){e.preventDefault();const rect=more.getBoundingClientRect();showMenu(card,rect.left,rect.bottom+3)}};
    card.append(pick,label,more);grid.append(card);
  }
  el("catalog-empty").hidden=!!items.length;
  el("catalog-empty").textContent="还没有"+types[kind]+"素材，点击「添加素材」从本机导入。";
  const removed=removedGroups[kind]||[];
  el("restore-assets").hidden=!removed.length;
  el("restore-items").replaceChildren();
  for(const item of removed){
    const restore=makeButton("恢复「"+item.name+"」","restore-one");
    restore.onclick=()=>perform(()=>update("restore",{id:item.id}));
    el("restore-items").append(restore);
  }
}
function render(){if(!el("library-page").hidden)renderLibrary()}
export async function reload(){
  const version=++loadVersion;
  const result=await api.request("/api/catalog?include=removed");
  if(version!==loadVersion)return;
  for(const [k,items] of Object.entries(result)){groups[k]=items.filter(i=>!i.removed);removedGroups[k]=items.filter(i=>i.removed)}
  render();api.updated();
}
const post=(kind,op,data)=>api.request("/api/library/"+kind+"/"+op,JSON.stringify(data),{"Content-Type":"application/json"});
async function update(op,payload){
  await post(kind,op,payload);await reload();
}
async function perform(fn){
  if(busy){render();return}
  busy=true;el("catalog-status").textContent="";
  try{await fn()}catch(err){el("catalog-status").textContent=err.message;api.info(err.message);try{await reload()}catch{}}
  finally{busy=false}
}
function selectPage(library){
  closeMenu();
  el("library-page").hidden=!library;el("edit-page").hidden=library;
  document.body.classList.toggle("view-library",library);
  const buttons=[el("tab-edit"),el("tab-library")];
  buttons.forEach((b,i)=>{const selected=i===(library?1:0);b.tabIndex=selected?0:-1;b.setAttribute("aria-selected",String(selected))});
  if(library)renderLibrary();else api.fit();
}
export function openCollectForm(kind,source){
  op={action:"collect",kind,source};
  const tile=el("item-preview");
  tile.replaceChildren();
  if(kind==="font"){
    const sample=document.createElement("span");sample.style.fontFamily="Cover"+source.file.split(".")[0];sample.textContent="字体 Aa";tile.append(sample);
  }else{
    const image=new Image();image.src="/assets/"+source.file;image.alt=source.name;tile.append(image);
  }
  tile.hidden=false;
  el("item-title").textContent="保存到素材库";
  el("item-message").textContent="当前图层「"+source.layerName+"」 · 保存到「"+types[kind]+"」";
  el("item-name-field").hidden=false;el("item-name").required=true;el("item-name").value=source.name;
  el("accept-item").textContent="保存";el("item-dialog").showModal();el("item-name").select();
}
function openForm(action){
  const item=(groups[kind]||[]).find(i=>i.id===chosen);
  if(!item)return;
  closeMenu(true);op={action,kind,id:item.id,builtin:item.builtin};
  const remove=action==="delete";
  el("item-preview").hidden=true;
  el("item-title").textContent=remove?(item.builtin?"从素材库移除":"删除素材"):"修改素材名";
  el("item-message").textContent=remove?"「"+item.name+"」"+(item.builtin?"将从本类移除，可在本页恢复。":"将移入系统回收站，已使用它的封面会保留项目副本。"):"";
  el("item-name-field").hidden=remove;el("item-name").required=!remove;el("item-name").value=item.name;
  el("accept-item").textContent=remove?(item.builtin?"移出素材库":"移入回收站"):"保存";
  el("item-dialog").showModal();if(!remove)el("item-name").select();
}
export async function startLibrary(callbacks){
  api=callbacks;
  const menu=el("asset-menu");
  document.addEventListener("pointerdown",e=>{if(!menu.hidden&&!menu.contains(e.target)&&!e.target.closest(".material-more"))closeMenu()});
  window.addEventListener("resize",()=>closeMenu());
  document.addEventListener("scroll",()=>{if(!menu.hidden)closeMenu()},true);
  menu.onkeydown=e=>{
    if(e.key==="Escape"){e.preventDefault();closeMenu(true);return}
    if(e.key==="Tab"){closeMenu(true);return}
    const buttons=[...menu.querySelectorAll("button:not(:disabled):not([hidden])")];
    if(["ArrowDown","ArrowUp","Home","End"].includes(e.key)){
      e.preventDefault();
      const n=buttons.length,i=buttons.indexOf(document.activeElement);
      buttons[e.key==="Home"?0:e.key==="End"?n-1:(i+(e.key==="ArrowDown"?1:-1)+n)%n].focus();
    }
  };

  for(const [key,label] of Object.entries(types)){
    const button=makeButton("","category");button.dataset.kind=key;
    const mark=document.createElement("i"),count=document.createElement("small");mark.textContent=marks[key];
    button.append(mark,label,count);el("categories").append(button);
    button.onclick=()=>{kind=key;chosen=null;el("catalog-status").textContent="";renderLibrary()};
  }
  ["edit","library"].forEach(view=>{const tab=el("tab-"+view);
    tab.onclick=()=>{if(location.hash!=="#"+view)location.hash=view;else selectPage(view==="library")};
    tab.onkeydown=e=>{if(e.key==="ArrowLeft"||e.key==="ArrowRight"){e.preventDefault();const other=el(view==="edit"?"tab-library":"tab-edit");other.focus();other.click()}}
  });
  window.addEventListener("hashchange",()=>selectPage(location.hash==="#library"));
  window.addEventListener("focus",()=>{if(!busy)reload().catch(e=>api.info(e.message))});
  el("import-assets").onclick=()=>{
    const input=el("asset-files");input.dataset.kind=kind;
    input.accept=kind==="font"?".ttf,.otf,.woff,.woff2":"image/png,image/jpeg,image/webp";
    input.value="";input.click();
  };
  el("asset-files").onchange=e=>{
    const target=e.target.dataset.kind,files=[...e.target.files];
    perform(async()=>{
      let created=0,duplicates=0;const failures=[];
      for(const file of files){
        try{
          if(file.size>32*1024*1024)throw new Error("文件超过 32 MB");
          if(target==="font")await new FontFace("ImportPreview",await file.arrayBuffer()).load();
          const name=file.name.replace(/\.[^.]+$/,"").slice(0,80)||types[target];
          const result=await api.request("/api/library/"+target+"/import",file,{"X-Asset-Name":encodeURIComponent(name)});
          if(result.created)created++;else duplicates++;
          if(kind===target)chosen=result.item.file;
        }catch(err){failures.push(file.name+"："+err.message)}
      }
      await reload();
      el("catalog-status").textContent=["已添加 "+created+" 项",duplicates?"已有 "+duplicates+" 项":"",...failures].filter(Boolean).join(" · ");
    });
  };
  el("rename-asset").onclick=()=>openForm("rename");
  el("remove-asset").onclick=()=>openForm("delete");el("cancel-item").onclick=()=>el("item-dialog").close();
  el("item-form").onsubmit=e=>{
    e.preventDefault();const job=op,name=el("item-name").value.trim();
    if(job.action!=="delete"&&!name)return;
    el("item-dialog").close();
    perform(async()=>{
      if(job.action==="collect"){await api.save();const result=await post(job.kind,"save",{format:job.source.format,layer:job.source.layer,file:job.source.file,name});if(kind===job.kind)chosen=result.item.file;api.info((result.created?"已存入":"素材库中已有")+"「"+result.item.name+"」")}
      else await post(job.kind,job.action,{id:job.id,name});
      await reload();el("catalog-status").textContent=job.action==="delete"?(job.builtin?"内置素材已移除":"素材已移入回收站"):"已保存";
    });
  };
  for(const [id,step] of [["earlier",-1],["later",1]]){
    el(id).onclick=()=>{closeMenu(true);const items=groups[kind],at=items.findIndex(i=>i.id===chosen);
      if(items[at+step])perform(()=>update("order",{id:chosen,anchor:items[at+step].id,after:step>0}));
    };
  }
  const grid=el("catalog-grid");
  grid.ondragstart=e=>{dragKey=e.target.closest(".material-card")?.dataset.id;e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("text/plain",dragKey||"")};
  grid.ondragover=e=>{if(dragKey&&e.target.closest(".material-card"))e.preventDefault()};
  grid.ondragend=()=>{dragKey=null};
  grid.ondrop=e=>{e.preventDefault();const target=e.target.closest(".material-card"),id=dragKey;dragKey=null;
    if(!id||!target||target.dataset.id===id)return;
    const items=groups[kind];const after=items.findIndex(i=>i.id===id)<items.findIndex(i=>i.id===target.dataset.id);
    perform(()=>update("order",{id,anchor:target.dataset.id,after}));
  };
  selectPage(location.hash==="#library");await reload();
}
