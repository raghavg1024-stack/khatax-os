export type OfflineDraft = {id:string;kind:"text"|"audio";text?:string;audio?:Blob;language:string;createdAt:string};
async function database() {
  return new Promise<IDBDatabase>((resolve,reject)=>{
    const request=indexedDB.open("khatax-offline",1);
    request.onupgradeneeded=()=>request.result.createObjectStore("drafts",{keyPath:"id"});
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(new Error("Offline storage is unavailable."));
  });
}
async function access<T>(mode:IDBTransactionMode,run:(store:IDBObjectStore)=>IDBRequest<T>) {
  const db=await database();
  return new Promise<T>((resolve,reject)=>{
    const tx=db.transaction("drafts",mode),request=run(tx.objectStore("drafts"));
    tx.oncomplete=()=>{db.close();resolve(request.result);};
    tx.onerror=tx.onabort=()=>{db.close();reject(new Error("Could not save the offline draft."));};
  });
}
export const offlineDrafts=()=>access("readonly",store=>store.getAll()) as Promise<OfflineDraft[]>;
export const removeOfflineDraft=(id:string)=>access("readwrite",store=>store.delete(id));
export async function saveOfflineDraft(draft:Omit<OfflineDraft,"id"|"createdAt">) {
  const row={...draft,id:crypto.randomUUID(),createdAt:new Date().toISOString()};
  await access("readwrite",store=>store.add(row));return row;
}
export async function recordOfflineVoice(onAudio:(blob:Blob)=>Promise<void>,onEnd:()=>void,onError:(message:string)=>void) {
  if(!window.MediaRecorder || !MediaRecorder.isTypeSupported("audio/webm"))throw new Error("Offline voice recording requires a browser with WebM recording. You can save a typed command instead.");
  const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1}});
  let recorder:MediaRecorder;
  try {recorder=new MediaRecorder(stream,{mimeType:"audio/webm",audioBitsPerSecond:32000});}
  catch(error){stream.getTracks().forEach(t=>t.stop());throw error;}
  const chunks:BlobPart[]=[];
  const stop=()=>{if(recorder.state!=="inactive")recorder.stop();};
  const timer=window.setTimeout(stop,25000);
  recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
  recorder.onerror=()=>{clearTimeout(timer);stream.getTracks().forEach(t=>t.stop());onError("Offline recording failed. Try a typed command.");onEnd();};
  recorder.onstop=async()=>{clearTimeout(timer);stream.getTracks().forEach(t=>t.stop());try{await onAudio(new Blob(chunks,{type:"audio/webm"}));}catch{onError("Could not save this recording on your device.");}finally{onEnd();}};
  recorder.start();return {stop};
}
