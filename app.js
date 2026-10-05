const MODEL={id:"dolphin-2.6-phi-2-q4km",name:"Dolphin 2.6 Phi 2 Q4_K_M",size:1790000000,url:"https://huggingface.co/TheBloke/dolphin-2_6-phi-2-GGUF/resolve/main/dolphin-2_6-phi-2.Q4_K_M.gguf?download=true",fileName:"dolphin-2_6-phi-2.Q4_K_M.gguf"};
const $=id=>document.getElementById(id);
const state={messages:[],settings:{systemPrompt:"You are Dolphin, a helpful AI assistant.",ctx:2048,temperature:.7},wllama:null,engine:"none",generating:false,cancel:false};
const DB_NAME="rc-dolphin-ai",DB_VERSION=1;let db;
function openDB(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{const d=r.result;if(!d.objectStoreNames.contains("kv"))d.createObjectStore("kv");if(!d.objectStoreNames.contains("messages"))d.createObjectStore("messages",{keyPath:"id",autoIncrement:true})};r.onsuccess=()=>{db=r.result;resolve(db)};r.onerror=()=>reject(r.error)})}
function idbGet(s,k){return new Promise((a,b)=>{const r=db.transaction(s).objectStore(s).get(k);r.onsuccess=()=>a(r.result);r.onerror=()=>b(r.error)})}
function idbPut(s,v,k){return new Promise((a,b)=>{const store=db.transaction(s,"readwrite").objectStore(s);const key=k??(store.keyPath?undefined:v?.key);const r=key===undefined?store.put(v):store.put(v,key);r.onsuccess=()=>a(r.result);r.onerror=()=>b(r.error)})}
function idbClear(s){return new Promise((a,b)=>{const r=db.transaction(s,"readwrite").objectStore(s).clear();r.onsuccess=()=>a();r.onerror=()=>b(r.error)})}
function idbAll(s){return new Promise((a,b)=>{const r=db.transaction(s).objectStore(s).getAll();r.onsuccess=()=>a(r.result);r.onerror=()=>b(r.error)})}
async function modelDir(){if(!navigator.storage?.getDirectory)throw new Error("OPFS is not supported in this browser.");const root=await navigator.storage.getDirectory();return root.getDirectoryHandle("models",{create:true})}
async function modelHandle(create=false){const d=await modelDir();try{return await d.getFileHandle(MODEL.fileName,{create})}catch{return null}}
async function modelFile(){const h=await modelHandle(false);return h?h.getFile():null}
async function modelBytes(){try{const f=await modelFile();return f?.size||0}catch{return 0}}
function fmt(n){if(!n)return"0 B";const u=["B","KB","MB","GB"],i=Math.min(Math.floor(Math.log(n)/Math.log(1024)),3);return(n/1024**i).toFixed(i?2:0)+" "+u[i]}
async function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
async function updateDownloadMeta(status,bytes,total){try{await idbPut("kv",{key:"modelMeta",status,bytes,total,updatedAt:Date.now()})}catch{}}
async function downloadModel(){
  state.cancel=false;
  $("progressPanel").classList.remove("hidden");
  $("downloadBtn").disabled=true;
  $("dialogDownload").disabled=true;
  let loaded=await modelBytes();
  const expectedTotal=MODEL.size;
  let lastError=null;
  try{
    if(loaded>=expectedTotal-1024*1024){
      await setModelState();
      return;
    }
    await updateDownloadMeta("partial",loaded,expectedTotal);
    $("progressText").textContent=loaded?"Resuming from "+fmt(loaded)+"…":"Starting download…";
    for(let attempt=1;attempt<=10;attempt++){
      if(state.cancel)throw new Error("Download cancelled.");
      let writer=null;
      try{
        const headers=loaded?{Range:"bytes="+loaded+"-"}:{};
        const res=await fetch(MODEL.url,{headers,cache:"no-store"});
        if(!res.ok)throw new Error("Model download failed (HTTP "+res.status+")");

        let startOffset=loaded;
        if(loaded){
          const range=res.headers.get("Content-Range")||"";
          const serverStarts=range.match(/^bytes\\s+(\\d+)-/i);
          if(res.status!==206 || (serverStarts && Number(serverStarts[1])!==loaded)){
            startOffset=0;
            loaded=0;
          }
        }
        const contentLength=Number(res.headers.get("Content-Length")||0);
        const total=(startOffset===0?contentLength:expectedTotal)||expectedTotal;
        const h=await modelHandle(true);
        writer=await h.createWritable({keepExistingData:startOffset>0});
        if(startOffset>0)await writer.seek(startOffset);

        let checkpointBytes=loaded;
        const reader=res.body?.getReader();
        if(!reader)throw new Error("Download stream is unavailable.");
        while(true){
          if(state.cancel){await writer.close();writer=null;throw new Error("Download cancelled.")}
          const x=await reader.read();
          if(x.done)break;
          await writer.write(x.value);
          loaded+=x.value.byteLength;
          const pct=total?Math.min(100,loaded/total*100):0;
          $("progressBar").style.width=pct.toFixed(1)+"%";
          $("progressPct").textContent=pct.toFixed(0)+"%";
          $("progressText").textContent="Downloading "+fmt(loaded)+(total?" / "+fmt(total):"");
          if(loaded-checkpointBytes>=8*1024*1024){
            await writer.close();
            writer=null;
            checkpointBytes=loaded;
            await updateDownloadMeta("partial",loaded,total);
            if(state.cancel)throw new Error("Download cancelled.");
            writer=await h.createWritable({keepExistingData:true});
            await writer.seek(loaded);
          }
        }
        if(writer){await writer.close();writer=null}
        loaded=await modelBytes();
        if(loaded>=expectedTotal-1024*1024){
          await updateDownloadMeta("ready",loaded,total||loaded);
          await setModelState();
          return;
        }
        throw new Error("Download ended early at "+fmt(loaded)+".");
      }catch(e){
        lastError=e;
        try{if(writer)await writer.close()}catch{}
        loaded=await modelBytes();
        await updateDownloadMeta("partial",loaded,expectedTotal);
        if(e.message==="Download cancelled.")throw e;
        if(attempt>=10)throw new Error("Network error after "+attempt+" attempts. Saved "+fmt(loaded)+"; press Resume to continue.");
        const wait=Math.min(15000,1000*2**(attempt-1));
        $("progressText").textContent="Network error. Saved "+fmt(loaded)+". Retrying in "+Math.ceil(wait/1000)+"s…";
        await sleep(wait);
      }
    }
    throw lastError||new Error("Download failed.");
  }catch(e){
    loaded=await modelBytes();
    await updateDownloadMeta("partial",loaded,expectedTotal);
    $("progressText").textContent=e.message+" Saved: "+fmt(loaded);
    throw e;
  }finally{
    $("downloadBtn").disabled=false;
    $("dialogDownload").disabled=false;
    setTimeout(()=>$("progressPanel").classList.add("hidden"),1800);
  }
}
function newWllama(){const w=new Wllama({default:"https://cdn.jsdelivr.net/npm/@wllama/wllama@3.8.1/src/wasm/wllama.wasm"});w.setCompat("default");return w}
async function webGpuReady(){try{if(!navigator.gpu)return false;const a=await navigator.gpu.requestAdapter();return !!a}catch{return false}}
function deviceProfile(){const hc=Math.max(1,navigator.hardwareConcurrency||8);return {threads:Math.max(3,Math.min(4,Math.floor(hc/2))),ctx:state.settings.ctx<=2048?state.settings.ctx:2048}}
async function loadEngine(){
  const file=await modelFile();
  if(!file||file.size<1000000000)throw new Error("Model is not installed.");
  $("engineBadge").textContent="Engine: loading…";
  const p=deviceProfile();
  let gpuError=null;
  if(await webGpuReady()){
    try{
      state.wllama=newWllama();
      await state.wllama.loadModel([file],{n_ctx:p.ctx,n_batch:64,n_threads:p.threads,n_gpu_layers:-1,offload_kqv:true});
      state.engine="WebGPU";
    }catch(e){
      gpuError=e;
      console.warn("WebGPU unavailable/unstable; switching to CPU/WASM.",e);
      try{await state.wllama?.exit?.()}catch{}
      state.wllama=null;
    }
  }
  if(state.engine!=="WebGPU"){
    state.wllama=newWllama();
    try{
      await state.wllama.loadModel([file],{n_ctx:p.ctx,n_batch:64,n_threads:p.threads,n_gpu_layers:0,offload_kqv:false});
      state.engine="CPU/WASM";
    }catch(cpuError){
      try{await state.wllama?.exit?.()}catch{}
      state.wllama=null;
      throw new Error("Dolphin engine could not load. WebGPU: "+(gpuError?.message||"unavailable")+" CPU/WASM: "+(cpuError?.message||"failed"));
    }
  }
  $("engineBadge").textContent="Engine: "+state.engine+" · "+p.threads+"T · ctx "+p.ctx;
  $("prompt").disabled=false;
  $("sendBtn").disabled=false;
}
async function addMessage(role,content){const m={role,content:String(content),createdAt:Date.now()};state.messages.push(m);await idbPut("messages",m);renderMessages();$("welcome").classList.add("hidden");$("chat").classList.remove("hidden")}
function renderMessages(){const box=$("messages");box.innerHTML="";for(const m of state.messages){const row=document.createElement("div");row.className="message "+m.role;const b=document.createElement("div");b.className="bubble";const r=document.createElement("div");r.className="role";r.textContent=m.role==="user"?"YOU":"DOLPHIN";const c=document.createElement("div");c.textContent=m.content;b.append(r,c);row.appendChild(b);box.appendChild(row)}box.scrollTop=box.scrollHeight}
async function sendMessage(text){if(!state.wllama||state.generating)return;state.generating=true;$("sendBtn").disabled=true;$("typing").classList.remove("hidden");await addMessage("user",text);const messages=[{role:"system",content:state.settings.systemPrompt},...state.messages.map(m=>({role:m.role,content:m.content}))];try{const result=await state.wllama.createChatCompletion({messages,max_tokens:512,temperature:Number(state.settings.temperature),top_p:.9,top_k:40});const answer=result?.choices?.[0]?.message?.content||"(empty response)";await addMessage("assistant",answer)}catch(e){await addMessage("assistant","Inference error: "+(e?.message||e));console.error(e)}finally{$("typing").classList.add("hidden");state.generating=false;$("sendBtn").disabled=false}}
async function setModelState(){const bytes=await modelBytes(),ready=bytes>1000000000;$("storageBadge").textContent=ready?"Model: installed":bytes?"Model: "+fmt(bytes)+" saved":"Model: not installed";$("modelState").textContent=ready?"Installed":bytes?"Partial / resumable":"Not installed";$("downloadBtn").textContent=ready?"Load Dolphin Phi 2":bytes?"Resume download":"Download Dolphin Phi 2"}
async function saveSettings(){state.settings.systemPrompt=$("systemPrompt").value.trim()||"You are Dolphin, a helpful AI assistant.";state.settings.ctx=Number($("ctxSize").value);state.settings.temperature=Number($("temperature").value);await idbPut("kv",{key:"settings",value:state.settings});$("settingsDialog").close()}
async function boot(){await openDB();const s=await idbGet("kv","settings");if(s?.value)state.settings=s.value;state.messages=await idbAll("messages");$("systemPrompt").value=state.settings.systemPrompt;$("ctxSize").value=String(state.settings.ctx);$("temperature").value=String(state.settings.temperature);$("tempValue").textContent=Number(state.settings.temperature).toFixed(2);renderMessages();await setModelState();if(state.messages.length){$("welcome").classList.add("hidden");$("chat").classList.remove("hidden")}if(await modelBytes()){try{await loadEngine()}catch(e){$("engineBadge").textContent="Engine: tap Load";console.warn(e)}}}
$("composer").addEventListener("submit",async e=>{e.preventDefault();const p=$("prompt"),text=p.value.trim();if(!text||state.generating)return;p.value="";p.style.height="auto";await sendMessage(text)});
$("prompt").addEventListener("input",e=>{e.target.style.height="auto";e.target.style.height=Math.min(140,e.target.scrollHeight)+"px"});
$("downloadBtn").onclick=async()=>{try{if(await modelBytes()>1000000000)await loadEngine();else await downloadModel()}catch(e){alert(e.message)}};
$("dialogDownload").onclick=async()=>{try{await downloadModel()}catch(e){if(e.message!=="Download cancelled.")alert(e.message)}};
$("cancelDownload").onclick=()=>{state.cancel=true};
$("modelBtn").onclick=()=>$("modelDialog").showModal();
$("settingsBtn").onclick=()=>$("settingsDialog").showModal();
$("saveSettings").onclick=saveSettings;
$("temperature").oninput=e=>$("tempValue").textContent=Number(e.target.value).toFixed(2);
$("deleteModel").onclick=async()=>{if(!confirm("Delete the local Dolphin model?"))return;try{const d=await modelDir();await d.removeEntry(MODEL.fileName);try{await state.wllama?.exit?.()}catch{}state.wllama=null;state.engine="none";$("engineBadge").textContent="Engine: not loaded";$("prompt").disabled=true;$("sendBtn").disabled=true;await setModelState()}catch(e){alert(e.message)}};
document.querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>$(b.dataset.close).close());
if("serviceWorker"in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(console.warn));
boot().catch(e=>{console.error(e);alert("Dolphin could not start: "+e.message)});