import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { MAX_BYTES, checkAbort, SourceError, type InventoryProvider, type ProviderFile, type SourceScope } from "./provider";

export type Preview = { bytes: Buffer | null; status: "ready" | "invalid_content" | "decoder_timeout" };
export async function preview(provider: InventoryProvider, scope: SourceScope, file: ProviderFile, signal: AbortSignal): Promise<Preview> {
  checkAbort(signal);
  const deadline=new AbortController();const abort=AbortSignal.any([signal,deadline.signal]);
  const child = spawn(process.execPath,["--max-old-space-size=128",path.resolve("src/adapters/decode-preview.mjs"),file.mime],{windowsHide:true,stdio:["pipe","pipe","ignore"]});
  const ended = new Promise<number | null>((resolve,reject) => { child.once("error",reject); child.once("close",resolve); });
  // Attach rejection immediately, including failures while provider reads are still pending.
  void ended.catch(()=>{});
  let transferTimedOut = false, decoderTimedOut=false, outputSize = 0; const chunks: Buffer[] = [];
  const stop = () => { child.kill(); };
  const transferTimer = setTimeout(()=>{transferTimedOut=true;deadline.abort();stop();},60000);
  let decoderTimer:ReturnType<typeof setTimeout>|undefined;
  abort.addEventListener("abort",stop,{once:true});
  child.stdout.on("data",(chunk:Buffer)=>{ outputSize+=chunk.length; if(outputSize>524288) stop(); else chunks.push(chunk); });
  child.stdin.on("error",()=>{});
  let received = 0;
  try {
    for await (const chunk of provider.read(scope,file,abort)) {
      checkAbort(abort); received+=chunk.length;
      if (received>MAX_BYTES || received>file.size) throw new SourceError("SOURCE_SIZE_CHANGED",true);
      if (child.stdin.destroyed) break;
      if (!child.stdin.write(chunk)) await Promise.race([once(child.stdin,"drain"),ended]);
    }
    checkAbort(signal);
    if (received!==file.size) throw new SourceError("SOURCE_SIZE_CHANGED",true);
    clearTimeout(transferTimer);
    decoderTimer=setTimeout(()=>{decoderTimedOut=true;stop();},10000);
    child.stdin.end(); const exit = await ended; checkAbort(signal);
    if (decoderTimedOut) return {bytes:null,status:"decoder_timeout"};
    if (exit!==0 || outputSize===0 || outputSize>524288) return {bytes:null,status:"invalid_content"};
    return {bytes:Buffer.concat(chunks),status:"ready"};
  } catch(error) {
    checkAbort(signal);
    if(transferTimedOut)throw new SourceError("SOURCE_TIMEOUT",true);
    if(decoderTimedOut)return {bytes:null,status:"decoder_timeout"};
    throw error;
  } finally { clearTimeout(transferTimer);clearTimeout(decoderTimer);abort.removeEventListener("abort",stop);stop();await ended.catch(()=>{}); }
}
