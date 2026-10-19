"use client";
import { useEffect, useState, type FormEvent } from "react";

const copy = {
  en: { title:"Platform operations", language:"Language", code:"Authenticator code", verify:"Verify fresh MFA", reference:"Studio support reference", search:"Read diagnostics", reason:"Reason (10–1000 characters)", suspend:"Suspend studio", reactivate:"Reactivate studio", grant:"Add manual grant", start:"Starts at (UTC)", end:"Ends at (UTC)", limit:"Project limit", retry:"Retry pending operation", uncertain:"Operation not acknowledged. Your request is preserved; retry it before starting another operation.", denied:"Access denied. Separate operator permission and a fresh authenticator verification are required.", unavailable:"Service unavailable. Retry safely.", saved:"Operation acknowledged.", verified:"Authenticator verified for five minutes in this session.", read:"Diagnostics", audit:"Redacted operator audit", refresh:"Refresh audit", metrics:"Operational metrics", refreshMetrics:"Read metrics", login:"Sign in", account:"Account security", empty:"No diagnostics loaded.", busy:"Working…", inspect:"Inspect the saved state before starting a new operation after a page reload." },
  id: { title:"Operasional platform", language:"Bahasa", code:"Kode autentikator", verify:"Verifikasi MFA terbaru", reference:"Referensi dukungan studio", search:"Baca diagnostik", reason:"Alasan (10–1000 karakter)", suspend:"Tangguhkan studio", reactivate:"Aktifkan kembali studio", grant:"Tambah hak akses manual", start:"Mulai (UTC)", end:"Berakhir (UTC)", limit:"Batas proyek", retry:"Ulangi operasi tertunda", uncertain:"Operasi belum diakui. Permintaan disimpan; ulangi sebelum memulai operasi lain.", denied:"Akses ditolak. Diperlukan izin operator terpisah dan verifikasi autentikator terbaru.", unavailable:"Layanan tidak tersedia. Silakan ulangi dengan aman.", saved:"Operasi telah diakui.", verified:"Autentikator diverifikasi selama lima menit untuk sesi ini.", read:"Diagnostik", audit:"Audit operator tersaring", refresh:"Muat ulang audit", metrics:"Metrik operasional", refreshMetrics:"Baca metrik", login:"Masuk", account:"Keamanan akun", empty:"Belum ada diagnostik.", busy:"Memproses…", inspect:"Periksa data tersimpan sebelum memulai operasi baru setelah memuat ulang halaman." },
};
type Pending = { path:string; value:Record<string,unknown>; key:string };
class ApiError extends Error { constructor(public status:number) { super(); } }
async function api(path:string,method="GET",value?:unknown,key?:string) {
  const r=await fetch(path,{method,cache:"no-store",headers:{...(value?{"Content-Type":"application/json"}:{}),...(key?{"Idempotency-Key":key}:{})},body:value?JSON.stringify(value):undefined});
  if(!r.ok)throw new ApiError(r.status);const data=await r.json();return path.startsWith("/api/v1")?data.data:data;
}
export function Operations() {
  const [lang,setLang]=useState<"en"|"id">("en"),t=copy[lang];
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(""),[error,setError]=useState("");
  const [ref,setRef]=useState(""),[studio,setStudio]=useState<Record<string,unknown>|null>(null);
  const [audit,setAudit]=useState<unknown>(null),[metrics,setMetrics]=useState<unknown>(null),[pending,setPending]=useState<Pending|null>(null);
  useEffect(()=>{document.documentElement.lang=lang;},[lang]);
  async function run(action:()=>Promise<void>) { setBusy(true);setError("");setMessage("");try{await action();}catch(e){setError(e instanceof ApiError&&[401,403].includes(e.status)?t.denied:t.unavailable);}finally{setBusy(false);} }
  async function send(p:Pending) {
    setPending(p);
    try { const saved=await api(p.path,"POST",p.value,p.key);setPending(null);setMessage(`${t.saved} ${saved.event_id}`);setStudio(null); }
    catch(e) {
      if(e instanceof ApiError&&e.status===422) {setPending(null);setError(lang==="en"?"Check the reason, UTC dates and project limit.":"Periksa alasan, tanggal UTC, dan batas proyek.");return;}
      setError(e instanceof ApiError&&[401,403].includes(e.status)?`${t.denied} ${t.uncertain}`:t.uncertain);
    }
  }
  function mutate(operation:string,form:HTMLFormElement) {
    if(operation==="suspend"&&!window.confirm(lang==="en"?"Suspend this studio? Owner and gallery access stops immediately. Previous gallery sessions stay revoked after reactivation.":"Tangguhkan studio ini? Akses pemilik dan galeri langsung dihentikan. Sesi galeri lama tetap dicabut setelah diaktifkan kembali."))return;
    const values=new FormData(form);const value:Record<string,unknown>={reason:values.get("reason")};
    if(operation==="grants")Object.assign(value,{starts_at:values.get("start"),ends_at:values.get("end"),project_limit:Number(values.get("limit"))});
    const p={path:`/api/v1/ops/studios/${studio!.id}/${operation}`,value,key:crypto.randomUUID()};void run(()=>send(p));
  }
  const submit=(action:(form:HTMLFormElement)=>Promise<void>)=>(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const f=e.currentTarget;void run(()=>action(f));};
  return <main className="ops-shell">
    <header><h1>{t.title}</h1><a href="/login">{t.login}</a>{" · "}<a href="/account">{t.account}</a><label>{t.language}<select aria-label={t.language} value={lang} onChange={e=>setLang(e.target.value as "en"|"id")}><option value="en">EN</option><option value="id">ID</option></select></label></header>
    <div aria-live="polite">{error&&<p role="alert" className="error">{error}</p>}{message&&<p role="status">{message}</p>}</div>
    <form onSubmit={submit(async f=>{await api("/api/auth/two-factor/verify-totp","POST",{code:new FormData(f).get("code"),trustDevice:false});f.reset();setMessage(t.verified);})}>
      <label>{t.code}<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required maxLength={6}/></label><button disabled={busy}>{t.verify}</button>
    </form>
    <form onSubmit={submit(async()=>{setStudio(await api(`/api/v1/ops/studios/${encodeURIComponent(ref)}`));})}>
      <label>{t.reference}<input required value={ref} disabled={!!pending||busy} onChange={e=>{setRef(e.target.value);setStudio(null);}} maxLength={36}/></label><button disabled={busy||!!pending}>{t.search}</button>
    </form>
    <section aria-label={t.read}><h2>{t.read}</h2>{studio?<pre>{JSON.stringify(studio,null,2)}</pre>:<p>{t.empty}</p>}</section>
    {pending&&<button disabled={busy} onClick={()=>void run(()=>send(pending))}>{t.retry}</button>}
    <p>{t.inspect}</p>
    {studio&&<form onSubmit={e=>e.preventDefault()}><fieldset disabled={busy||!!pending}>
      <label>{t.reason}<textarea name="reason" required minLength={10} maxLength={1000}/></label>
      <button type="button" onClick={e=>{const f=e.currentTarget.form!;if(f.reportValidity())mutate("suspend",f);}}>{t.suspend}</button>{" "}
      <button type="button" onClick={e=>{const f=e.currentTarget.form!;if(f.reportValidity())mutate("reactivate",f);}}>{t.reactivate}</button>
      <label>{t.start}<input name="start" placeholder="2026-10-20T00:00:00Z" maxLength={35}/></label>
      <label>{t.end}<input name="end" placeholder="2026-11-20T00:00:00Z" maxLength={35}/></label>
      <label>{t.limit}<input name="limit" type="number" min={1} max={1000} defaultValue={3}/></label>
      <button type="button" onClick={e=>{const f=e.currentTarget.form!;if(f.reportValidity())mutate("grants",f);}}>{t.grant}</button>
    </fieldset></form>}
    <section aria-label={t.audit}><h2>{t.audit}</h2><button disabled={busy} onClick={()=>void run(async()=>setAudit(await api("/api/v1/ops/audit-events?limit=20")))}>{t.refresh}</button>{audit!==null&&<pre>{JSON.stringify(audit,null,2)}</pre>}</section>
    <section aria-label={t.metrics}><h2>{t.metrics}</h2><button disabled={busy} onClick={()=>void run(async()=>setMetrics(await api("/api/v1/ops/metrics")))}>{t.refreshMetrics}</button>{metrics!==null&&<pre>{JSON.stringify(metrics,null,2)}</pre>}</section>
  </main>;
}
