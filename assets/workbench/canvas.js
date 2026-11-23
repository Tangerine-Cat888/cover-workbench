export const sizes = {portrait:[1080,1440],main:[1440,1080],wide:[1920,1080],wechat:[1880,800]};
export const formatNames = {portrait:"小红书竖版",main:"B 站首页",wide:"个人空间",wechat:"公众号主封面"};
const cache=new Map(), tinted=new Map();
export async function loadImage(file) {
  if (!file) return null;
  if (!cache.has(file)) {
    const img=new Image();
    const promise=new Promise((resolve,reject)=>{
      img.onload=()=>{cache.set(file,{img,promise:Promise.resolve(img)});resolve(img)};
      img.onerror=()=>{cache.delete(file);reject(new Error("图片加载失败，请重新打开或替换素材。"))};
    });
    cache.set(file,{img:null,promise}); img.src="/assets/"+file;
  }
  return cache.get(file).promise;
}
const bitmap=file=>cache.get(file)?.img;
export function imageAspect(file){const im=bitmap(file);return im?im.width/im.height:1}
export async function prepare(doc) {
  const files=new Set();
  for (const layer of doc.layers) {
    for(const file of [layer.src,layer.art,...(layer.parts||[]),...Object.values(layer.backgrounds||{})]) if(file) files.add(file);
  }
  await Promise.all([...Array.from(files,loadImage),...doc.layers.filter(l=>l.kind==="text").map(l=>loadProjectFont(l.font))]);
}
const projectFonts=new Map();
export function loadProjectFont(file){
  if(!/^[0-9a-f]{64}\.(ttf|otf|woff2?)$/.test(file))return Promise.resolve();
  if(!projectFonts.has(file)){
    const face=new FontFace("Cover"+file.split(".")[0],'url("/assets/'+file+'")');
    projectFonts.set(file,face.load().then(f=>document.fonts.add(f)).catch(err=>{projectFonts.delete(file);throw err}));
  }
  return projectFonts.get(file);
}
let brushAvailable=false;
export async function loadFonts() {
  for (const [name,src] of [["CoverBrush",'local("REEJI-CHAO-ZengGB-Regular"),local("潮字社曾玉波手书简 常规")']]) {
    try {const face=await new FontFace(name,src).load(); document.fonts.add(face);brushAvailable=true;} catch {}
  }
  await document.fonts.ready;
}
export const hasBrush=()=>brushAvailable;
function fillImage(ctx,img,w,h,fit) {
  if(!img)return;
  const factor=(fit==="cover"?Math.max:Math.min)(w/img.width,h/img.height);
  const dw=img.width*factor, dh=img.height*factor;
  ctx.drawImage(img,(w-dw)/2,(h-dh)/2,dw,dh);
}
function inkBitmap(file,color){
  const key=file+color;
  if(!tinted.has(key)){
    const img=bitmap(file);if(!img)return null;
    const mask=document.createElement("canvas");mask.width=img.width;mask.height=img.height;
    const ctx=mask.getContext("2d");ctx.drawImage(img,0,0);
    ctx.globalCompositeOperation="source-in";ctx.fillStyle=color;ctx.fillRect(0,0,mask.width,mask.height);
    if(tinted.size>=10)tinted.delete(tinted.keys().next().value);
    tinted.set(key,mask);
  }
  return tinted.get(key);
}
export const paperDefault="#fbf7ef", tintDefault="#a9afff";
const rgb=hex=>[1,3,5].map(at=>parseInt(hex.slice(at,at+2),16));
const referencePaper=rgb(paperDefault),referenceTint=rgb(tintDefault);
// Corner samples of the original paper: violet on the left, warm light on the right.
const coolCorner=[224,224,244],warmCorner=[252,239,211];
let washCache=null;

function originalWash(ctx,image,w,h){
  ctx.fillStyle=paperDefault;ctx.fillRect(0,0,w,h);
  if(image){ctx.drawImage(image,0,0,w,h);return}
  for(const [x,y,rx,ry,color] of [[0,0,.74,.51,"rgba(171,160,222,.3)"],[1,.05,.62,.49,"rgba(242,208,139,.26)"],[0,1,.68,.44,"rgba(170,162,227,.31)"]]){
    ctx.save();ctx.translate(x*w,y*h);ctx.scale(rx*w,ry*h);
    const g=ctx.createRadialGradient(0,0,0,0,0,1);g.addColorStop(0,color);g.addColorStop(1,"transparent");ctx.fillStyle=g;ctx.fillRect(-1,-1,2,2);ctx.restore();
  }
}
function drawWash(ctx,layer,w,h,key){
  const image=bitmap(layer.backgrounds?.[key]);
  const paperHex=layer.color.toLowerCase();
  const tintHex=/^#[a-f0-9]{6}$/i.test(layer.gradientTint)?layer.gradientTint.toLowerCase():tintDefault;
  if(paperHex===paperDefault&&tintHex===tintDefault){washCache=null;originalWash(ctx,image,w,h);return}
  // Keep only the active format. Moving text or a picture reuses the recolored paper.
  if(!washCache||washCache.image!==image||washCache.w!==w||washCache.h!==h){
    const canvas=document.createElement("canvas");
    const scale=Math.min(1,sizes[key][0]/w,sizes[key][1]/h);
    canvas.width=Math.max(1,Math.round(w*scale));canvas.height=Math.max(1,Math.round(h*scale));
    const off=canvas.getContext("2d",{willReadFrequently:true});
    originalWash(off,image,canvas.width,canvas.height);
    washCache={image,w,h,canvas,off,source:off.getImageData(0,0,canvas.width,canvas.height).data,output:off.createImageData(canvas.width,canvas.height)};
  }
  const cacheKey=paperHex+tintHex;
  if(washCache.key!==cacheKey){
    const paper=rgb(paperHex),tint=rgb(tintHex);
    const shift=paper.map((v,c)=>v-referencePaper[c]);
    const cool=coolCorner.map((v,c)=>v+.64*shift[c]+.36*(tint[c]-referenceTint[c]));
    const warm=warmCorner.map((v,c)=>v+.72*shift[c]);
    // Even white ink on white paper retains a soft edge instead of disappearing.
    const separation=Math.max(...cool.map((v,c)=>Math.abs(v-paper[c])));
    const contrast=Math.max(0,25-separation)*(paper[0]*.21+paper[1]*.72+paper[2]*.07>128?-1:1);
    const delta=[new Int16Array(511),new Int16Array(511),new Int16Array(511)];
    for(let i=0;i<511;i++){
      const cast=i-255-(referencePaper[2]-referencePaper[0]);
      const coolMix=Math.min(1,Math.max(0,cast/32)),warmMix=Math.min(1,Math.max(0,-cast/29));
      for(let c=0;c<3;c++)delta[c][i]=Math.round(shift[c]*(1-coolMix-warmMix)+coolMix*(cool[c]+contrast-coolCorner[c])+warmMix*(warm[c]-warmCorner[c]));
    }
    const src=washCache.source,out=washCache.output.data;
    for(let i=0;i<src.length;i+=4){
      const idx=255+src[i+2]-src[i];
      out[i]=src[i]+delta[0][idx];out[i+1]=src[i+1]+delta[1][idx];out[i+2]=src[i+2]+delta[2][idx];out[i+3]=src[i+3];
    }
    washCache.off.putImageData(washCache.output,0,0);washCache.key=cacheKey;
  }
  ctx.drawImage(washCache.canvas,0,0,w,h);
}
export function paintWashSample(canvas,layer,key,w,h){
  const ctx=canvas.getContext("2d");
  ctx.save();ctx.scale(canvas.width/w,canvas.height/h);drawWash(ctx,layer,w,h,key);ctx.restore();
}
function background(ctx,layer,w,h,key) {
  if(layer.preset==="lavender"){drawWash(ctx,layer,w,h,key);return}
  washCache=null;
  ctx.fillStyle=layer.color;ctx.fillRect(0,0,w,h);
  if(layer.preset==="image"){
    const img=bitmap(layer.src);if(img){
      ctx.save();ctx.beginPath();ctx.rect(0,0,w,h);ctx.clip();
      const scale=(layer.zoom||100)/100;
      ctx.translate((1-scale)*w/2+(layer.panX||0)*w/100,(1-scale)*h/2+(layer.panY||0)*h/100);
      fillImage(ctx,img,w*scale,h*scale,"cover");ctx.restore();
    }
  }else if(layer.preset==="grid"){
    ctx.strokeStyle="#77777723";ctx.lineWidth=1;
    ctx.beginPath();for(let x=0;x<w;x+=42){ctx.moveTo(x,0);ctx.lineTo(x,h)}
    for(let y=0;y<h;y+=42){ctx.moveTo(0,y);ctx.lineTo(w,y)}ctx.stroke();
  }
}
function fontOf(layer,fs,part){
  if(projectFonts.has(layer.font))return fs+'px Cover'+layer.font.split(".")[0]+', "Microsoft YaHei", sans-serif';
  if(layer.font==="ink")return /^[\x00-\x7F]+$/.test(part)?'italic 800 '+fs+'px Arial':fs+'px CoverBrush,"Kaiti SC",KaiTi,STKaiti,cursive';
  return (layer.id==="series"?550:780)+" "+fs+"px "+(layer.font==="serif"?'"Noto Serif SC","Songti SC","SimSun",serif':'"Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif');
}
function textLayer(ctx,l,p) {
  if(l.art && l.text===l.artText && l.font===(l.artFont||"ink")){
    const im=l.color===l.artColor?bitmap(l.art):inkBitmap(l.art,l.color);
    if(im){const scale=Math.min(p.w/im.width,p.h/im.height);ctx.drawImage(im,0,0,im.width*scale,im.height*scale);return;}
  }
  const lines=l.text.split("\n");
  const parts=lines.map(line=>l.font==="ink"?(line.match(/[\x00-\x7F]+|[^\x00-\x7F]+/g)||[""]):[line]);
  function measure(line,fs){return line.reduce((total,s)=>{ctx.font=fontOf(l,fs,s);return total+ctx.measureText(s).width},0)}
  const fs=Math.max(1,Math.min(p.fs,p.h/(lines.length*1.13)));
  ctx.fillStyle=l.color;ctx.textBaseline="alphabetic";
  parts.forEach((line,i)=>{
    const length=measure(line,fs);ctx.save();ctx.translate(0,(i*1.13+.87)*fs);ctx.scale(Math.min(1,p.w/(length||1)),1);
    let x=0;for(const s of line){ctx.font=fontOf(l,fs,s);ctx.fillText(s,x,0);x+=ctx.measureText(s).width;}ctx.restore();
  });
}
function picture(ctx,l,p){
  const images=(l.parts?.length?l.parts:[l.src]).map(bitmap).filter(Boolean);
  if(!images.length)return;
  const b=l.frame?Math.max(7,p.w*.024):0,r=b*1.75;
  ctx.save();
  if(b){ctx.fillStyle=l.frameColor||"#fffdf9";ctx.shadowColor="#36312625";ctx.shadowBlur=b*1.8;ctx.shadowOffsetY=b*.72;
    ctx.beginPath();ctx.roundRect(0,0,p.w,p.h,r);ctx.fill();ctx.shadowColor="transparent";
  }
  const iw=Math.max(1,p.w-b*2),ih=Math.max(1,p.h-b*2);
  ctx.beginPath();ctx.roundRect(b,b,iw,ih,b?b*.8:0);ctx.clip();ctx.translate(b,b);
  if(images.length===1){fillImage(ctx,images[0],iw,ih,l.fit||"contain");}
  else{
    const gap=b*.75,weight=images.reduce((n,im)=>n+im.height/im.width,0);
    let top=0;for(const im of images){const height=(ih-gap*(images.length-1))*im.height/im.width/weight;ctx.drawImage(im,0,top,iw,height);top+=height+gap;}
  }
  ctx.restore();
}
export function draw(canvas,doc,key) {
  const [width,height]=sizes[key];if(canvas.width!==width)canvas.width=width;if(canvas.height!==height)canvas.height=height;
  const ctx=canvas.getContext("2d");ctx.clearRect(0,0,width,height);ctx.imageSmoothingQuality="high";
  const layers=new Map(doc.layers.map(l=>[l.id,l]));
  for(const p of doc.layouts[key]){
    if(!p.visible)continue;const l=layers.get(p.id);if(!l)continue;
    ctx.save(); ctx.translate(p.x+p.w/2,p.y+p.h/2);ctx.rotate(p.rotation*Math.PI/180);ctx.translate(-p.w/2,-p.h/2);
    if(l.kind==="background")background(ctx,l,p.w,p.h,key);
    else if(l.kind==="text")textLayer(ctx,l,p);
    else picture(ctx,l,p);
    ctx.restore();
  }
}
export function hit(p,x,y){
  const dx=x-p.x-p.w/2,dy=y-p.y-p.h/2,r=-p.rotation*Math.PI/180;
  return Math.abs(dx*Math.cos(r)-dy*Math.sin(r))<=p.w/2 && Math.abs(dx*Math.sin(r)+dy*Math.cos(r))<=p.h/2;
}
