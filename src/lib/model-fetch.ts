/** One bounded retry for read-only inference transport/5xx failures; never retry quota/auth errors. */
export async function modelFetch(url:string,init:RequestInit) {
  for(let attempt=0;attempt<2;attempt++){
    try{
      const response=await fetch(url,{...init,signal:AbortSignal.timeout(15000)});
      if(response.status<500||attempt===1)return response;
      await response.body?.cancel().catch(()=>{});
    }catch(error){if(attempt===1)throw error;}
  }
  throw new Error("Model request did not finish.");
}
