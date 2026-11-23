const dialog=document.querySelector("#cutout-dialog");
const el=name=>dialog.querySelector("#cutout-"+name);
const image=el("image"), view=el("view"), status=el("status");
let task=null;

function showVersion(original){
  if(!task)return;
  image.src="/assets/"+(original?task.src:task.result);
  image.alt=original?"人物原图":"透明底人物";
  el("before").setAttribute("aria-pressed",String(original));
  el("after").setAttribute("aria-pressed",String(!original));
}
function zoom(full){
  view.classList.toggle("full",full);
  el("zoom").setAttribute("aria-pressed",String(full));
  el("zoom").textContent=full?"适应窗口":"查看原尺寸";
}
function current(job){return dialog.open&&task===job}
async function run(job,install=false){
  status.textContent=install?"正在安装本机抠图组件…":"正在本机识别人物轮廓…";
  el("setup").hidden=true;
  try{
    await job.save();
    if(!current(job))return;
    if(install){
      await job.request("/api/portrait/setup","{}");
      if(!current(job))return;
      status.textContent="正在本机识别人物轮廓…";
    }
    const result=await job.request("/api/portrait/preview",JSON.stringify({format:job.format,layer:job.id,file:job.src}));
    if(!current(job))return;
    if(result.setupRequired){
      status.textContent="首次使用需联网安装抠图组件。人物图片只在本机处理。";
      el("setup").hidden=false;
      return;
    }
    await job.loadImage(result.file);
    if(!current(job))return;
    job.result=result.file;
    el("after").disabled=false;
    el("apply").disabled=false;
    showVersion(false);
    status.textContent="";
  }catch(error){
    if(current(job)){
      status.textContent=error.message;
      if(install)el("setup").hidden=false;
    }
  }
}
export function previewCutout(options){
  if(dialog.open)return;
  task={...options,result:null};
  el("after").disabled=el("apply").disabled=true;
  el("setup").hidden=true;
  zoom(false);
  showVersion(true);
  dialog.showModal();
  run(task);
}
el("before").onclick=()=>showVersion(true);
el("after").onclick=()=>showVersion(false);
el("zoom").onclick=()=>zoom(!view.classList.contains("full"));
el("close").onclick=el("cancel").onclick=()=>dialog.close();
el("setup").onclick=()=>run(task,true);
el("apply").onclick=()=>{
  if(!task?.result)return;
  try{task.apply(task.result);dialog.close()}
  catch(error){status.textContent=error.message;el("apply").disabled=true}
};
dialog.addEventListener("close",()=>{
  if(dialog.open)return;
  task=null;
  image.removeAttribute("src");
});
