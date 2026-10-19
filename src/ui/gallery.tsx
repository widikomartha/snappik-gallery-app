"use client";

import { useEffect, useRef, useState } from "react";

const words={
  en:{title:"Your photo gallery",intro:"One shared draft: everyone with main access edits the same selection.",main:"Choose photos",download:"Download access",password:"Gallery password",enter:"Enter gallery",unavailable:"Gallery unavailable. Access may have expired. Return to the menu or retry.",retry:"Retry",gateDenied:"Access could not be verified. Check the password and retry.",rateLimited:"Too many access attempts. Wait one minute before retrying.",menu:"Gallery menu",load:"Loading…",root:"Root folder",all:"All folders",folder:"Folder",next:"Load more",empty:"No photos in this folder yet.",preparing:"Photos are still being prepared.",source:"Photos could not be refreshed. Retry later.",synthetic:"Synthetic fixture — generated colors only.",select:"Select",remove:"Remove",enlarge:"Enlarge",close:"Close viewer",previous:"Previous photo",nextPhoto:"Next photo",zoom:"Zoom",reset:"Reset zoom",note:"Photo note (maximum 500 characters)",quota:"Maximum",unsaved:"Unsaved",saving:"Saving…",saved:"Saved",failed:"Save not acknowledged. Your local choices remain unsaved. Retry or review the server draft.",conflict:"Another client changed this shared draft. Your choices are unsaved. Review the server draft before deliberately reapplying.",save:"Save draft",server:"Review server draft",use:"Use server draft",reapply:"Reapply my choices to this revision",serverTitle:"Current server draft",localTitle:"Your unsaved choices",review:"Review choices",back:"Back to photos",confirm:"Confirmation arrives in EPIC-05. No choices are locked yet.",locked:"Confirmed — editing is locked.",unavailablePhoto:"Photo unavailable. Remove it before saving.",preview:"Preview unavailable. Retry from the gallery.",invalid:"Check the maximum quota, notes and photo availability. Choices remain unsaved.",notesDisabled:"Notes are disabled. Existing saved notes are retained until you remove their photo.",downloadLater:"Original downloads arrive in EPIC-05. This independent access does not permit selection.",light:"Light",dark:"Dark",theme:"Theme",language:"Language",deadline:"Access deadline",noDeadline:"No deadline",count:"selected",none:"No choices yet.",changed:"The shared draft has changed. Refresh the server draft.",blocked:"Save all changes before confirmation.",refresh:"Refresh gallery"},
  id:{title:"Galeri foto Anda",intro:"Satu draf bersama: semua penerima akses utama mengedit pilihan yang sama.",main:"Pilih foto",download:"Akses unduhan",password:"Kata sandi galeri",enter:"Buka galeri",unavailable:"Galeri tidak tersedia. Akses mungkin berakhir. Kembali ke menu atau coba lagi.",retry:"Coba lagi",gateDenied:"Akses belum dapat diverifikasi. Periksa kata sandi dan coba lagi.",rateLimited:"Terlalu banyak percobaan akses. Tunggu satu menit sebelum mencoba lagi.",menu:"Menu galeri",load:"Memuat…",root:"Folder utama",all:"Semua folder",folder:"Folder",next:"Muat lagi",empty:"Belum ada foto di folder ini.",preparing:"Foto masih disiapkan.",source:"Foto belum dapat diperbarui. Coba lagi nanti.",synthetic:"Contoh sintetis — hanya warna buatan.",select:"Pilih",remove:"Hapus",enlarge:"Perbesar",close:"Tutup penampil",previous:"Foto sebelumnya",nextPhoto:"Foto berikutnya",zoom:"Zum",reset:"Atur ulang zum",note:"Catatan foto (maksimum 500 karakter)",quota:"Maksimum",unsaved:"Belum tersimpan",saving:"Menyimpan…",saved:"Tersimpan",failed:"Penyimpanan belum diakui. Pilihan lokal belum tersimpan. Coba lagi atau tinjau draf server.",conflict:"Klien lain mengubah draf bersama. Pilihan Anda belum tersimpan. Tinjau draf server sebelum menerapkan ulang.",save:"Simpan draf",server:"Tinjau draf server",use:"Gunakan draf server",reapply:"Terapkan ulang pilihan saya ke revisi ini",serverTitle:"Draf server terkini",localTitle:"Pilihan Anda yang belum tersimpan",review:"Tinjau pilihan",back:"Kembali ke foto",confirm:"Konfirmasi hadir di EPIC-05. Pilihan belum dikunci.",locked:"Dikonfirmasi — pengeditan terkunci.",unavailablePhoto:"Foto tidak tersedia. Hapus sebelum menyimpan.",preview:"Pratinjau tidak tersedia. Coba lagi dari galeri.",invalid:"Periksa kuota maksimum, catatan, dan ketersediaan foto. Pilihan belum tersimpan.",notesDisabled:"Catatan dinonaktifkan. Catatan tersimpan dipertahankan sampai foto dihapus.",downloadLater:"Unduhan asli hadir di EPIC-05. Akses terpisah ini tidak mengizinkan pemilihan.",light:"Terang",dark:"Gelap",theme:"Tema",language:"Bahasa",deadline:"Tenggat akses",noDeadline:"Tanpa tenggat",count:"dipilih",none:"Belum ada pilihan.",changed:"Draf bersama telah berubah. Muat draf server.",blocked:"Simpan semua perubahan sebelum konfirmasi.",refresh:"Segarkan galeri"}
};
type Lang="en"|"id";
type Photo={id:string;filename:string;folder_path:string;preview_url:string};
type Item={photo_id:string;note:string;filename:string;folder_path:string;available:boolean};
type Draft={status:string;revision:number;quota:number;notes_enabled:boolean;items:Item[];saved_at:string|null};
type Catalog={items:Photo[];next_cursor:string|null;folders:string[];inventory_status:string;origin:string|null};
type Bootstrap={locale:Lang;workflows:{kind:"main"|"download";password_required:boolean;expires_at:string|null}[]};
class ApiError extends Error {constructor(public code:string,public status:number){super(code);}}
export function Gallery({token,view}:{token:string;view:string}) {
  const [lang,setLang]=useState<Lang>("id"),[theme,setTheme]=useState("light"),[bootstrap,setBootstrap]=useState<Bootstrap|null>(null);
  const [allowed,setAllowed]=useState(false),[error,setError]=useState(""),[busy,setBusy]=useState(false),[password,setPassword]=useState("");
  const [catalog,setCatalog]=useState<Catalog|null>(null),[previewEpoch,setPreviewEpoch]=useState(0),[folder,setFolder]=useState("*"),[draft,setDraft]=useState<Draft|null>(null),[items,setItems]=useState<Item[]>([]);
  const [status,setStatus]=useState<"saved"|"unsaved"|"saving"|"failed"|"conflict">("unsaved"),[server,setServer]=useState<Draft|null>(null),[review,setReview]=useState(view.endsWith("/review"));
  const [viewer,setViewer]=useState<string|null>(null);const generation=useRef(0);
  const kind=view==="download"?"download":"main",t=words[lang];
  async function api(path:string,method="GET",body?:unknown) {
    const r=await fetch(`/api/v1/g/${token}${path}`,{method,cache:"no-store",headers:body===undefined?{}:{"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
    const result=await r.json();if(!r.ok)throw new ApiError(result.error?.code??"UNKNOWN",r.status);return result.data;
  }
  function explain(e:unknown) {if(e instanceof ApiError&&e.code==="ACCESS_DENIED")return "gateDenied";if(e instanceof ApiError&&e.status===429)return "rateLimited";if(e instanceof ApiError&&[401,403,404].includes(e.status)){setAllowed(false);setViewer(null);return "unavailable";}return e instanceof ApiError&&e.status===422?"invalid":"source";}
  async function photos(next?:string) {
    const seq=++generation.current;const data:Catalog=await api(`/photos?${new URLSearchParams({workflow:kind,limit:"50",...(folder!=="*"?{folder}:{}),...(next?{cursor:next}:{})})}`);
    if(seq===generation.current){setCatalog(old=>({...data,items:next?[...(old?.items??[]),...data.items]:data.items}));setPreviewEpoch(n=>n+1);}
  }
  async function load() {
    setError("");setBusy(true);
    try {
      const b:Bootstrap=await api("");setBootstrap(b);
      const pref=localStorage.getItem("snappik-gallery-language");setLang(pref==="en"||pref==="id"?pref:b.locale);setTheme(localStorage.getItem("snappik-gallery-theme")??"light");
      if(view)try {
        if(kind==="main") {const s:Draft=await api("/selection");setDraft(s);setItems(s.items);setStatus("saved");}
        await photos();setAllowed(true);
      }catch(e){if(!(e instanceof ApiError&&e.status===401))setError(explain(e));}
    }catch(e){setError(explain(e));}finally{setBusy(false);}
  }
  useEffect(()=>{void load();},[token,view]); // Initial fetch only; never refresh over local intent.
  useEffect(()=>{document.documentElement.lang=lang;},[lang]);
  useEffect(()=>{if(allowed){void photos().catch(e=>setError(explain(e)));}return()=>{generation.current++;};},[folder]);
  // Poll only canonical revision, never overwrite local choices. Hidden pages back off.
  useEffect(()=>{if(!allowed||kind!=="main"||!draft)return;let stop=false;let timer:ReturnType<typeof setTimeout>;let delay=15000;
    const tick=async()=>{if(!document.hidden){try{const s:Draft=await api("/selection");if(!stop&&s.revision!==draft.revision){setServer(s);setStatus("conflict");}delay=15000;}catch(e){if(!stop)setError(explain(e));delay=Math.min(delay*2,60000);}}if(!stop)timer=setTimeout(tick,document.hidden?60000:delay);};
    timer=setTimeout(tick,15000);return()=>{stop=true;clearTimeout(timer);};
  },[allowed,draft?.revision]);
  const locked=draft?.status==="confirmed",editable=!busy&&status!=="saving"&&!locked&&status!=="conflict";
  function toggle(p:Photo|Item) {
    if(!editable||!draft)return;const id="id" in p?p.id:p.photo_id;
    if(items.some(i=>i.photo_id===id))setItems(items.filter(i=>i.photo_id!==id));
    else {if(items.length>=draft.quota){setError("invalid");return;}setItems([...items,{photo_id:id,filename:p.filename,folder_path:p.folder_path,note:"",available:true}]);}
    setStatus("unsaved");setServer(null);setError("");
  }
  function note(id:string,note:string) {if(!editable)return;setItems(items.map(i=>i.photo_id===id?{...i,note}:i));setStatus("unsaved");setServer(null);}
  async function save() {
    if(!draft||!editable)return;setStatus("saving");setError("");
    try{const s:Draft=await api("/selection","PUT",{expected_revision:draft.revision,items:items.map(({photo_id,note})=>({photo_id,note}))});setDraft(s);setItems(s.items);setServer(null);setStatus("saved");}
    catch(e){if(e instanceof ApiError&&["REVISION_CONFLICT","SELECTION_LOCKED"].includes(e.code)){setStatus("conflict");try{setServer(await api("/selection"));}catch(fetchError){setError(explain(fetchError));}}else{setStatus("failed");if(e instanceof ApiError&&e.status<500)setError(explain(e));}}
  }
  async function serverDraft(){setBusy(true);try{setServer(await api("/selection"));setError("");}catch(e){setError(explain(e));}finally{setBusy(false);}}
  const chosen=(p:Photo)=>items.some(i=>i.photo_id===p.id);
  const noteField=(i:Item)=>draft?.notes_enabled?<label>{t.note}<textarea aria-label={t.note} disabled={!editable} value={i.note} onChange={e=>note(i.photo_id,e.target.value)} aria-invalid={[...i.note].length>500}/><span>{[...i.note].length} / 500</span></label>:i.note?<p>{i.note}</p>:null;
  const selectionList=(list:Item[])=><ul className="gallery-review">{list.map(i=><li key={i.photo_id}><strong>{i.filename}</strong><p>{i.folder_path||t.root}</p><p>{i.note}</p>{!i.available&&<p role="alert">{t.unavailablePhoto}</p>}</li>)}</ul>;
  return <main className={`gallery gallery-${theme}`}>
    <header className="gallery-header"><a className="wordmark" href={`/g/${token}`}>snappik<span className="wordmark-dot">.</span></a><div className="gallery-tools"><label>{t.language}<select aria-label={t.language} value={lang} onChange={e=>{const v=e.target.value as Lang;setLang(v);localStorage.setItem("snappik-gallery-language",v);}}><option value="id">Indonesia</option><option value="en">English</option></select></label><label>{t.theme}<select aria-label={t.theme} value={theme} onChange={e=>{setTheme(e.target.value);localStorage.setItem("snappik-gallery-theme",e.target.value);}}><option value="light">{t.light}</option><option value="dark">{t.dark}</option></select></label></div></header>
    <div className="gallery-content"><h1>{t.title}</h1>{view&&<a href={`/g/${token}`}>{t.menu}</a>}
    {error&&<div role="alert" className="error">{t[error as "source"]}<button disabled={busy} onClick={()=>allowed?photos().then(()=>setError("")).catch(e=>setError(explain(e))):load()}>{t.retry}</button></div>}
    {!bootstrap&&busy&&<p role="status">{t.load}</p>}
    {!view&&bootstrap&&<nav className="gallery-menus">{bootstrap.workflows.map(w=><a key={w.kind} href={`/g/${token}/${w.kind}`}><strong>{t[w.kind]}</strong><span>{w.expires_at?`${t.deadline}: ${new Date(w.expires_at).toLocaleString(lang)}`:t.noDeadline}</span></a>)}</nav>}
    {view&&!allowed&&bootstrap&&<form onSubmit={async e=>{e.preventDefault();setBusy(true);setError("");try{await api("/access","POST",{workflow:kind,...(password?{password}:{})});setPassword("");await load();}catch(err){setError(explain(err));}finally{setBusy(false);}}}>{bootstrap.workflows.find(w=>w.kind===kind)?.password_required&&<label>{t.password}<input type="password" autoComplete="off" value={password} onChange={e=>setPassword(e.target.value)} maxLength={128} required/></label>}<button disabled={busy}>{t.enter}</button></form>}
    {allowed&&<>
      {kind==="main"?<p>{t.intro}</p>:<p>{t.downloadLater}</p>}
      {catalog?.origin==="synthetic"&&<p className="gallery-fixture">{t.synthetic}</p>}
      {catalog?.inventory_status==="pending"&&<p role="status">{t.preparing}</p>}
      {catalog?.inventory_status==="failed"&&<p role="status">{t.source}</p>}
      {draft&&kind==="main"&&<section className="selection-bar" aria-label={t.review}><p>{items.length} / {draft.quota} {t.count} · {t.quota} {draft.quota}</p><p role="status" aria-live="polite">{locked?t.locked:t[status]}</p><button disabled={!editable||status==="saved"} onClick={save}>{t.save}</button><button disabled={busy||status==="saving"} onClick={serverDraft}>{t.server}</button><button onClick={()=>setReview(!review)}>{review?t.back:t.review}</button></section>}
      {server&&<section className="gallery-conflict" aria-label={t.serverTitle}><h2>{t.serverTitle} · {server.revision}</h2>{selectionList(server.items)}<button disabled={busy||status==="saving"} onClick={()=>{setDraft(server);setItems(server.items);setStatus("saved");setServer(null);}}>{t.use}</button>{server.status!=="confirmed"&&<><h3>{t.localTitle}</h3>{selectionList(items)}<button disabled={busy||status==="saving"} onClick={()=>{setDraft(server);setStatus("unsaved");setServer(null);}}>{t.reapply}</button></>}</section>}
      {review&&draft?<section aria-label={t.review}>{!items.length&&<p>{t.none}</p>}{items.map(i=><article key={i.photo_id} className="gallery-review-item"><h2>{i.filename}</h2><p>{i.folder_path||t.root}</p>{!i.available&&<p className="error">{t.unavailablePhoto}</p>}{noteField(i)}<button disabled={!editable} onClick={()=>toggle(i)}>{t.remove}</button></article>)}{!draft.notes_enabled&&<p>{t.notesDisabled}</p>}<p>{status!=="saved"?t.blocked:t.confirm}</p></section>:<>
        <div className="gallery-controls"><label>{t.folder}<select aria-label={t.folder} value={folder} onChange={e=>setFolder(e.target.value)}><option value="*">{t.all}</option>{(catalog?.folders??[]).map(f=><option key={f} value={f}>{f||t.root}</option>)}</select></label><button disabled={busy} onClick={()=>{setBusy(true);photos().then(()=>setError("")).catch(e=>setError(explain(e))).finally(()=>setBusy(false));}}>{t.refresh}</button></div>
        <div className="gallery-grid">{catalog?.items.map(p=><article key={p.id} className={chosen(p)?"photo-card is-selected":"photo-card"}><button className="photo-open" aria-label={`${t.enlarge} ${p.filename} · ${p.folder_path||t.root}`} onClick={()=>setViewer(p.id)}><Preview key={`${p.preview_url}:${previewEpoch}`} src={p.preview_url} name={p.filename} fallback={t.preview}/></button><div className="photo-caption"><strong>{p.filename}</strong><p>{p.folder_path||t.root}</p>{kind==="main"&&<button disabled={!editable||(!chosen(p)&&items.length>=(draft?.quota??0))} aria-pressed={chosen(p)} onClick={()=>toggle(p)}>{chosen(p)?`✓ ${t.remove}`:t.select}</button>}</div></article>)}</div>
        {catalog&&!catalog.items.length&&<p>{t.empty}</p>}{catalog?.next_cursor&&<button disabled={busy} onClick={()=>{setBusy(true);photos(catalog.next_cursor!).catch(e=>setError(explain(e))).finally(()=>setBusy(false));}}>{t.next}</button>}
      </>}
      {viewer&&catalog&&<Viewer photo={catalog.items.find(p=>p.id===viewer)!} t={t} close={()=>setViewer(null)} move={delta=>{const index=catalog.items.findIndex(p=>p.id===viewer);setViewer(catalog.items[(index+delta+catalog.items.length)%catalog.items.length].id);}}>{kind==="main"&&<><button disabled={!editable||(!chosen(catalog.items.find(p=>p.id===viewer)!)&&items.length>=(draft?.quota??0))} aria-pressed={items.some(i=>i.photo_id===viewer)} onClick={()=>toggle(catalog.items.find(p=>p.id===viewer)!)}>{items.some(i=>i.photo_id===viewer)?t.remove:t.select}</button>{items.find(i=>i.photo_id===viewer)&&noteField(items.find(i=>i.photo_id===viewer)!)}</>}</Viewer>}
    </>}
    </div>
  </main>;
}
function Preview({src,name,fallback}:{src:string;name:string;fallback:string}){const [failed,setFailed]=useState(false);useEffect(()=>setFailed(false),[src]);return failed?<span className="preview-failed" role="status">{fallback}</span>:<img src={src} alt={name} loading="lazy" onError={()=>setFailed(true)}/>;}
function Viewer({photo,t,close,move,children}:{photo:Photo;t:typeof words.en;close:()=>void;move:(n:number)=>void;children:React.ReactNode}) {
  const ref=useRef<HTMLDialogElement>(null),[zoom,setZoom]=useState(1);const actions=useRef({close,move});actions.current={close,move};
  useEffect(()=>setZoom(1),[photo.id]);
  useEffect(()=>{const active=document.activeElement as HTMLElement;const dialog=ref.current!;dialog.showModal();const handler=(e:KeyboardEvent)=>{if((e.target as HTMLElement).matches("textarea,input,select"))return;if(e.key==="ArrowLeft"){e.preventDefault();actions.current.move(-1);}if(e.key==="ArrowRight"){e.preventDefault();actions.current.move(1);}};dialog.addEventListener("keydown",handler);return()=>{dialog.close();dialog.removeEventListener("keydown",handler);active?.focus();};},[]);
  return <dialog ref={ref} className="photo-viewer" aria-label={`${photo.filename} · ${photo.folder_path||t.root}`} onCancel={e=>{e.preventDefault();close();}}><div className="viewer-actions"><button autoFocus onClick={close}>{t.close}</button><button onClick={()=>move(-1)}>{t.previous}</button><button onClick={()=>move(1)}>{t.nextPhoto}</button><button onClick={()=>setZoom(Math.min(zoom+0.5,3))}>{t.zoom} +</button><button onClick={()=>setZoom(1)}>{t.reset}</button></div><div className="viewer-image" style={{["--zoom" as string]:zoom}}><Preview src={photo.preview_url} name={photo.filename} fallback={t.preview}/></div><h2>{photo.filename}</h2><p>{photo.folder_path||t.root}</p>{children}</dialog>;
}
