"use client";
import { useEffect, useRef, useState } from "react";

type Item={photo_id:string;provider_file_id:string;filename:string;folder_path:string;note:string};
type Snapshot={id:string;revision:number;confirmed_at:string;items:Item[]};
type Selection={status:string;revision:number;items:Item[];latest_confirmation:Snapshot|null};
export function ResultsPanel({id,lang,expired,archived,version}:{id:string;lang:"en"|"id";expired:boolean;archived:boolean;version:number}) {
  const en=lang==="en",base=`/api/v1/projects/${id}`;
  const [current,setCurrent]=useState<Selection|null>(null),[history,setHistory]=useState<Snapshot[]>([]),[cursor,setCursor]=useState<string|null>(null);
  const [view,setView]=useState("latest"),[reason,setReason]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
  const attempt=useRef<{key:string;body:{expected_revision:number;reason:string}}|null>(null);
  const [uncertain,setUncertain]=useState(false);
  async function get(path:string){const r=await fetch(base+path,{cache:"no-store"});if(!r.ok)throw Error();return (await r.json()).data;}
  async function load(){const [s,h]=await Promise.all([get("/selection"),get("/confirmations?limit=20")]);setCurrent(s);setHistory(h.items);setCursor(h.next_cursor);}
  const failed=en?"Results could not be acknowledged. Refresh or retry; previous confirmations are retained.":"Hasil belum dapat dipastikan. Segarkan atau coba lagi; konfirmasi sebelumnya dipertahankan.";
  useEffect(()=>{let live=true;Promise.all([get("/selection"),get("/confirmations?limit=20")]).then(([s,h])=>{if(live){setCurrent(s);setHistory(h.items);setCursor(h.next_cursor);setError("");}}).catch(()=>{if(live)setError(failed);});return()=>{live=false;};},[id,version]);
  const snapshot=view==="latest"?current?.latest_confirmation:history.find(h=>h.id===view);
  const isDraft=view==="draft",selected=isDraft?current:snapshot;
  const query=isDraft?"view=draft":snapshot?`confirmation_id=${snapshot.id}`:null;
  async function run(fn:()=>Promise<void>){setBusy(true);setError("");setMessage("");try{await fn();}catch{setError(failed);}finally{setBusy(false);}}
  async function reopen(){
    if(!current)return;
    if(!attempt.current){if(!window.confirm(en?"Reopen this selection? Existing choices and immutable confirmations will be retained.":"Buka kembali pilihan? Pilihan dan konfirmasi permanen akan dipertahankan."))return;attempt.current={key:crypto.randomUUID(),body:{expected_revision:current.revision,reason}};}
    await run(async()=>{try {
      const r=await fetch(base+"/selection/reopen",{method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":attempt.current!.key},body:JSON.stringify(attempt.current!.body)});
      if(!r.ok){setUncertain(r.status>=500);if(r.status<500)attempt.current=null;throw Error();}
      setCurrent((await r.json()).data);attempt.current=null;setUncertain(false);setReason("");setView("draft");setMessage(en?"Selection reopened. Prior confirmations remain available.":"Pilihan dibuka kembali. Konfirmasi sebelumnya tetap tersedia.");
    }catch(e){if(attempt.current)setUncertain(true);throw e;}
    });
  }
  return <section aria-label={en?"Selection results":"Hasil pilihan"}>
    <h3>{en?"Selection results":"Hasil pilihan"}</h3>
    <button disabled={busy||uncertain} onClick={()=>run(load)}>{en?"Refresh results":"Segarkan hasil"}</button>
    {current&&<><p>{en?"Current state":"Status terkini"}: {current.status} · {en?"Revision":"Revisi"} {current.revision}</p>
      <label>{en?"Result view":"Tampilan hasil"}<select aria-label={en?"Result view":"Tampilan hasil"} value={view} onChange={e=>setView(e.target.value)}><option value="latest">{en?"Last confirmed":"Konfirmasi terakhir"}</option><option value="draft">{en?"Current draft":"Draf terkini"}</option>{history.map(h=><option key={h.id} value={h.id}>{en?"Confirmation":"Konfirmasi"} #{h.revision} · {h.confirmed_at}</option>)}</select></label>
      {cursor&&<button disabled={busy} onClick={()=>run(async()=>{const h=await get(`/confirmations?limit=20&cursor=${cursor}`);setHistory([...history,...h.items]);setCursor(h.next_cursor);})}>{en?"More history":"Riwayat lainnya"}</button>}
      {selected?<><h4>{isDraft?(en?"Current draft":"Draf terkini"):`${en?"Immutable confirmation":"Konfirmasi permanen"} #${selected.revision}`}</h4>{snapshot&&!isDraft&&<p>{snapshot.confirmed_at}</p>}
        <div className="project-actions"><button disabled={busy||!query} onClick={()=>run(async()=>{const r=await fetch(base+`/results.csv?${query}`,{cache:"no-store"});if(!r.ok)throw Error();await navigator.clipboard.writeText(await r.text());setMessage(en?"Exact CSV copied.":"CSV lengkap disalin.");})}>{en?"Copy exact CSV":"Salin CSV lengkap"}</button><a href={base+`/results.csv?${query}`}>{en?"Download CSV":"Unduh CSV"}</a></div>
        <ul className="gallery-review">{selected.items.map(i=><li key={i.photo_id}><strong>{i.filename}</strong><p>{i.folder_path||"/"}</p><small>{i.photo_id} · {i.provider_file_id}</small><p>{i.note}</p></li>)}</ul>
      </>:<p>{en?"No confirmation yet.":"Belum ada konfirmasi."}</p>}
      {(current.status==="confirmed"||uncertain)&&<form onSubmit={e=>{e.preventDefault();void reopen();}}><label>{en?"Reason for reopening (10–1000 characters)":"Alasan membuka kembali (10–1000 karakter)"}<textarea aria-label={en?"Reason for reopening (10–1000 characters)":"Alasan membuka kembali (10–1000 karakter)"} disabled={busy||uncertain||expired||archived} value={reason} onChange={e=>setReason(e.target.value)} required/></label>{uncertain&&<p role="status">{en?"Reopen result uncertain. Retry uses the same request; fields are paused.":"Hasil pembukaan belum pasti. Ulangi permintaan yang sama; isian dijeda."}</p>}<button disabled={busy||(!uncertain&&(expired||archived||[...reason.trim()].length<10||[...reason.trim()].length>1000))}>{uncertain?(en?"Retry reopen":"Ulangi pembukaan"):(en?"Reopen selection":"Buka kembali pilihan")}</button></form>}
    </>}
    {error&&<p role="alert" className="error">{error}</p>}{message&&<p role="status">{message}</p>}
  </section>;
}
