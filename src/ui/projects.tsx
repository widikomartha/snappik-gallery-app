"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { ResultsPanel } from "./results";

const copy = {
  en: { projects:"Projects", dashboard:"Studio overview", create:"Create project", label:"Client label", source:"Drive folder ID or folder link", sourceHint:"Public-only Drive access requires approved local configuration. Synthetic previews are explicitly labeled.", main:"Main selection", download:"Original downloads", enabled:"Enabled", quota:"Maximum selection", deadline:"Deadline (UTC)", noDeadline:"An empty deadline means no deadline.", password:"New password (optional, 8–128 characters)", remove:"Remove saved password", passwordSet:"Password is set", notes:"Allow photo notes", folders:"Detect subfolders", clientPhone:"Client phone (optional E.164)", adminPhone:"Studio phone (optional E.164)", save:"Save changes", retry:"Retry", refresh:"Refresh", reload:"Reload saved project", edit:"Edit project", archive:"Archive", restore:"Restore", rotate:"Rotate share link", copy:"Copy share link", copied:"Link copied. Open the gallery to enter client access.", archiveConfirm:"Archive this project? Client access stops immediately and the active slot is freed. Restore is available for 30 days.", rotateConfirm:"Rotate this link? The old link and all existing gallery grants will stop working.", restoreConfirm:"Restore this project? Its original deadlines remain unchanged and current quota applies.", pending:"Preparing", ready:"Ready", failed:"Failed", empty:"No projects match this view.", search:"Search clients", state:"Lifecycle", active:"Active", archived:"Archived", all:"All", inventory:"Source status", next:"Load more", busy:"Working…", saved:"Saved.", uncertain:"We couldn't confirm the request. Your entries are preserved. Retry the same request.", conflict:"This project changed in another tab. Your entries are preserved. Reload saved project before editing again.", limit:"Project allowance reached. Archive a project to free a slot.", expired:"Your entitlement has expired. You can read projects, archive them, or rotate links.", invalid:"Check the client label, folder ID, phone format, workflow, quota and deadlines.", denied:"This project is unavailable or this action is not permitted.", loading:"Loading projects…", job:"Inventory job", selected:"Selected", selection:"Selection", not_started:"Not started", selecting:"Selecting", confirmed:"Confirmed", total:"Total projects", deadlines:"Deadlines in the next 7 days", none:"None scheduled.", recent:"Recent projects", updated:"Refreshed", retryNotice:"The create result is uncertain. Fields are held for an identical retry. Check the project list before starting another create.", created:"Project saved. Open project", back:"All projects", retention:"Archived projects can be restored within 30 days. Original deadlines are retained.", sourceFilter:"Filter source status", selectionFilter:"Filter selection status", unsaved:"Unsaved changes" },
  id: { projects:"Proyek", dashboard:"Ringkasan studio", create:"Buat proyek", label:"Nama klien", source:"ID atau tautan folder Drive", sourceHint:"Akses Drive publik memerlukan konfigurasi lokal yang disetujui. Pratinjau sintetis diberi label.", main:"Pilihan utama", download:"Unduhan asli", enabled:"Aktif", quota:"Maksimum pilihan", deadline:"Tenggat (UTC)", noDeadline:"Tenggat kosong berarti tanpa tenggat.", password:"Kata sandi baru (opsional, 8–128 karakter)", remove:"Hapus kata sandi tersimpan", passwordSet:"Kata sandi terpasang", notes:"Izinkan catatan foto", folders:"Deteksi subfolder", clientPhone:"Telepon klien (opsional E.164)", adminPhone:"Telepon studio (opsional E.164)", save:"Simpan perubahan", retry:"Coba lagi", refresh:"Segarkan", reload:"Muat proyek tersimpan", edit:"Edit proyek", archive:"Arsipkan", restore:"Pulihkan", rotate:"Ganti tautan berbagi", copy:"Salin tautan berbagi", copied:"Tautan disalin. Buka galeri untuk masuk sebagai klien.", archiveConfirm:"Arsipkan proyek ini? Akses klien langsung berhenti dan kuota aktif tersedia kembali. Pemulihan tersedia selama 30 hari.", rotateConfirm:"Ganti tautan? Tautan lama dan seluruh izin galeri yang ada akan berhenti berlaku.", restoreConfirm:"Pulihkan proyek ini? Tenggat asli tetap berlaku dan kuota terkini diperiksa.", pending:"Disiapkan", ready:"Siap", failed:"Gagal", empty:"Tidak ada proyek pada tampilan ini.", search:"Cari klien", state:"Status proyek", active:"Aktif", archived:"Diarsipkan", all:"Semua", inventory:"Status sumber", next:"Muat lagi", busy:"Memproses…", saved:"Tersimpan.", uncertain:"Permintaan belum dapat dipastikan. Isian Anda tetap ada. Ulangi permintaan yang sama.", conflict:"Proyek berubah di tab lain. Isian Anda tetap ada. Muat proyek tersimpan sebelum mengedit lagi.", limit:"Kuota proyek tercapai. Arsipkan proyek untuk menyediakan kuota.", expired:"Hak akses berakhir. Anda dapat membaca, mengarsipkan, atau mengganti tautan proyek.", invalid:"Periksa nama klien, ID folder, format telepon, alur, kuota, dan tenggat.", denied:"Proyek tidak tersedia atau tindakan tidak diizinkan.", loading:"Memuat proyek…", job:"Pekerjaan inventaris", selected:"Dipilih", selection:"Pilihan", not_started:"Belum dimulai", selecting:"Memilih", confirmed:"Dikonfirmasi", total:"Total proyek", deadlines:"Tenggat dalam 7 hari", none:"Tidak ada jadwal.", recent:"Proyek terbaru", updated:"Diperbarui", retryNotice:"Hasil pembuatan belum pasti. Isian dikunci untuk percobaan ulang yang sama. Periksa daftar sebelum membuat proyek lain.", created:"Proyek tersimpan. Buka proyek", back:"Semua proyek", retention:"Proyek arsip dapat dipulihkan dalam 30 hari. Tenggat asli tetap berlaku.", sourceFilter:"Filter status sumber", selectionFilter:"Filter status pilihan", unsaved:"Perubahan belum tersimpan" },
};
type Lang = "en" | "id";
type Workflow = { enabled:boolean; quota?:number|null; expires_at:string|null; password_set?:boolean; password?:string|null };
type Defaults = { detect_subfolders:boolean; notes_enabled:boolean; layout:"grid"; main:Workflow; download:Workflow };
type Project = Defaults & { id:string; client_label:string; client_phone:string|null; admin_phone:string|null; drive_folder_id:string; revision:number; inventory_status:"pending"|"ready"|"failed"; archived_at:string|null; public_url:string; job_id:string; selected_count:number; selection_revision:number; selection_status:"not_started"|"selecting"|"confirmed"; workflows:(Workflow & {kind:"main"|"download"})[] };
type ListRow = Pick<Project,"id"|"client_label"|"inventory_status"|"archived_at"|"selection_status">;
type Dashboard = { counts:Record<string,number>; recent_projects:ListRow[]; next_deadlines:{id:string;client_label:string;kind:"main"|"download";expires_at:string}[]; generated_at:string; entitlement:{active_project_usage:number;project_limit:number;grants:{source:string;active:boolean;ends_at:string}[]} };
class RequestError extends Error { constructor(public code:string,public status:number) { super(code); } }
async function api(path:string,method="GET",body?:unknown,key?:string) {
  const response = await fetch(`/api/v1/${path}`,{method,cache:"no-store",headers:{...(body===undefined?{}:{"Content-Type":"application/json"}),...(key?{"Idempotency-Key":key}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const data = await response.json(); if(!response.ok) throw new RequestError(data.error?.code??"UNKNOWN",response.status); return data.data;
}
function candidate(value:string) {
  try { const url=new URL(value); if(url.protocol==="https:" && url.hostname==="drive.google.com") return /^\/drive\/folders\/([\w-]+)\/?$/.exec(url.pathname)?.[1]??value; } catch {}
  return value.trim();
}

export function ProjectsWorkspace({screen,lang,defaults,zone,expired}:{screen:string;lang:Lang;defaults:Defaults;zone:string;expired:boolean}) {
  const t=copy[lang]; const [project,setProject]=useState<Project|null>(null); const [dashboard,setDashboard]=useState<Dashboard|null>(null);
  const [rows,setRows]=useState<ListRow[]>([]); const [cursor,setCursor]=useState<string|null>(null);
  const [q,setQ]=useState(""); const [state,setState]=useState("active"); const [inventory,setInventory]=useState(""); const [selection,setSelection]=useState("");
  const loadSequence=useRef(0);
  const [error,setError]=useState(""); const [message,setMessage]=useState(""); const [busy,setBusy]=useState(false); const [loading,setLoading]=useState(true); const [conflict,setConflict]=useState(false); const [stamp,setStamp]=useState("");
  const parts=screen.split("/"); const id=parts[2]; const editing=parts[3]==="edit"; const creating=id==="new";
  const detail=!!id&&!creating; const isDashboard=screen==="app";
  const format=(value:string)=>new Intl.DateTimeFormat(lang,{dateStyle:"medium",timeStyle:"short",timeZone:zone}).format(new Date(value));
  const listPath=(next?:string)=>`projects?${new URLSearchParams({q,state,limit:"20",...(inventory?{inventory_status:inventory}:{}),...(selection?{selection_status:selection}:{}),...(next?{cursor:next}:{})})}`;
  function explain(e:unknown) {
    if(!(e instanceof RequestError)||e.status>=500) return t.uncertain;
    if(e.code==="REVISION_CONFLICT") { setConflict(true); return t.conflict; }
    if(e.code==="PROJECT_LIMIT_REACHED") return t.limit;
    if(e.code==="ENTITLEMENT_EXPIRED") return t.expired;
    if(e.status===401) { location.assign("/login"); return t.denied; }
    if(e.status===403||e.status===404) return t.denied;
    if(e.code==="IDEMPOTENCY_CONFLICT"||e.code==="IDEMPOTENCY_EXPIRED") return t.retryNotice;
    return t.invalid;
  }
  async function load(next?:string) {
    if(creating) return;
    const sequence=++loadSequence.current;
    const data=await api(isDashboard?"dashboard":detail?`projects/${id}`:listPath(next));
    if(sequence!==loadSequence.current) return;
    if(isDashboard) setDashboard(data);
    else if(detail) setProject(data);
    else { setRows(old=>next?[...old,...data.items]:data.items); setCursor(data.next_cursor); }
    setStamp(new Date().toISOString());
  }
  async function run(action:()=>Promise<void>) {
    setBusy(true);setError("");setMessage(""); try { await action(); } catch(e) {setError(explain(e));} finally {setBusy(false);}
  }
  useEffect(()=>{let live=true;load().then(()=>{if(live)setError("");}).catch(e=>{if(live)setError(explain(e));}).finally(()=>{if(live)setLoading(false);}); return()=>{live=false;loadSequence.current++;};},[screen,q,state,inventory,selection]); // eslint-disable-line react-hooks/exhaustive-deps
  // Refresh visible read views only. Forms retain unsaved input and their original revision.
  useEffect(()=>{if(creating||editing)return;let timer:ReturnType<typeof setTimeout>;let stopped=false;let delay=15000;
    const tick=async()=>{if(!document.hidden&&!stopped){try{await load();setError("");delay=15000;}catch(e){setError(explain(e));delay=Math.min(delay*2,60000);}}if(!stopped)timer=setTimeout(tick,document.hidden?60000:delay);};
    timer=setTimeout(tick,15000);return()=>{stopped=true;clearTimeout(timer);};
  },[screen,q,state,inventory,selection]); // eslint-disable-line react-hooks/exhaustive-deps
  const links=(items:ListRow[])=><div className="project-list">{items.map(p=><a className="project-row" key={p.id} href={`/app/projects/${p.id}`}><strong>{p.client_label}</strong><span>{t[p.inventory_status]} · {t[p.selection_status]??(p.archived_at?t.archived:t.active)}</span>{p.archived_at&&<small>{t.archived}</small>}</a>)}</div>;
  async function operation(action:string,prompt:string) {if(!project||!window.confirm(prompt))return;await run(async()=>{setProject(await api(`projects/${project.id}/${action}`,"POST",{expected_revision:project.revision}));setMessage(t.saved);});}
  return <section className="projects-workspace">
    <div className="project-actions"><a href="/app/projects">{t.back}</a>{!expired&&<a className="action-link" href="/app/projects/new">+ {t.create}</a>}{!creating&&<button disabled={busy} onClick={()=>run(async()=>{await load();setConflict(false);})}>{editing?t.reload:t.refresh}</button>}</div>
    {expired&&<p className="error">{t.expired}</p>}
    {loading?<p role="status">{t.loading}</p>:creating?<><h2>{t.create}</h2><ProjectForm key="new" lang={lang} defaults={defaults} disabled={expired} onSaved={p=>{setMessage(t.created);location.assign(`/app/projects/${p.id}`);}} onError={e=>setError(explain(e))}/></>:isDashboard&&dashboard?<>
      <h2>{t.dashboard}</h2><div className="project-metrics">{["total","active","archived","selecting","confirmed","pending","failed"].map(key=><div key={key}><strong>{dashboard.counts[key]}</strong><span>{key==="total"?t.total:t[key as keyof typeof t]}</span></div>)}</div>
      <p>{dashboard.entitlement.active_project_usage} / {dashboard.entitlement.project_limit} {t.active.toLowerCase()}</p><ul>{dashboard.entitlement.grants.filter(g=>g.active).map((g,i)=><li key={i}>{g.source === "trial" ? (lang === "en" ? "Trial ends" : "Uji coba berakhir") : (lang === "en" ? "Allowance ends" : "Hak akses berakhir")}: {format(g.ends_at)}</li>)}</ul><h3>{t.recent}</h3>{dashboard.recent_projects.length?links(dashboard.recent_projects):<p>{t.empty}</p>}
      <h3>{t.deadlines}</h3>{dashboard.next_deadlines.length?<ul>{dashboard.next_deadlines.map(d=><li key={`${d.id}-${d.kind}`}><a href={`/app/projects/${d.id}`}>{d.client_label}</a> · {t[d.kind]} · {format(d.expires_at)}</li>)}</ul>:<p>{t.none}</p>}
    </>:detail&&project?<><h2>{project.client_label}</h2>{editing?<ProjectForm key={project.revision} lang={lang} project={project} defaults={defaults} disabled={expired||conflict} onSaved={p=>{setProject(p);setMessage(t.saved);}} onError={e=>setError(explain(e))}/>:<>
      <p className={`inventory-badge inventory-${project.inventory_status}`}>{t.inventory}: {t[project.inventory_status]}</p><p>{t.sourceHint}</p>
      <p>{t.selection}: {t[project.selection_status]} · {project.selected_count} {t.selected.toLowerCase()}</p><p>{project.archived_at?`${t.archived}: ${format(project.archived_at)}`:t.active}</p>
      <dl className="workflow-summary">{project.workflows.map(w=><div key={w.kind}><dt>{t[w.kind]}</dt><dd>{w.enabled?t.enabled:"—"}{w.kind==="main"&&w.quota!=null?` · ${t.quota}: ${w.quota}`:""} · {w.expires_at?format(w.expires_at):t.noDeadline}{w.password_set?` · ${t.passwordSet}`:""}</dd></div>)}</dl>
      <div className="project-actions">{!expired&&!project.archived_at&&<a href={`/app/projects/${id}/edit`}>{t.edit}</a>}<button disabled={busy||conflict} onClick={()=>operation("access/rotate",t.rotateConfirm)}>{t.rotate}</button><button disabled={busy} onClick={()=>run(async()=>{await navigator.clipboard.writeText(`${location.origin}${project.public_url}`);setMessage(t.copied);})}>{t.copy}</button>{project.archived_at?<button disabled={busy||expired||conflict} onClick={()=>operation("restore",t.restoreConfirm)}>{t.restore}</button>:<button disabled={busy||conflict} onClick={()=>operation("archive",t.archiveConfirm)}>{t.archive}</button>}</div><p>{t.retention}</p><ResultsPanel id={project.id} lang={lang} expired={expired} archived={!!project.archived_at} version={project.selection_revision}/><InventoryPanel project={project} lang={lang} expired={expired} refresh={()=>load()}/>
    </>}</>:!detail?<><h2>{t.projects}</h2><div className="project-filters"><label>{t.search}<input value={q} onChange={e=>setQ(e.target.value)} maxLength={100}/></label><label>{t.state}<select value={state} onChange={e=>setState(e.target.value)}>{["active","archived","all"].map(v=><option key={v} value={v}>{t[v as "active"]}</option>)}</select></label><label>{t.sourceFilter}<select value={inventory} onChange={e=>setInventory(e.target.value)}><option value="">{t.all}</option>{["pending","ready","failed"].map(v=><option key={v} value={v}>{t[v as "pending"]}</option>)}</select></label><label>{t.selectionFilter}<select value={selection} onChange={e=>setSelection(e.target.value)}><option value="">{t.all}</option>{["not_started","selecting","confirmed"].map(v=><option key={v} value={v}>{t[v as "not_started"]}</option>)}</select></label></div>{rows.length?links(rows):<p>{t.empty}</p>}{cursor&&<button disabled={busy} onClick={()=>run(()=>load(cursor))}>{t.next}</button>}</>:null}
    {stamp&&!creating&&<small>{t.updated}: {format(stamp)}</small>}<div aria-live="polite">{error&&<p role="alert" className="error">{error}</p>}{message&&<p role="status" className="success">{message}</p>}</div>
  </section>;
}

type InventoryPage={items:{id:string;filename:string;folder_path:string;available:boolean;preview_status:string;preview_url:string|null}[];next_cursor:string|null;generation:number;origin:string|null;failure_code:string|null;summary:{photos:number;skipped:Record<string,number>}|null;last_successful_sync_at:string|null};
function InventoryPanel({project,lang,expired,refresh}:{project:Project;lang:Lang;expired:boolean;refresh:()=>Promise<void>}) {
  const en=lang==="en";const [inventory,setInventory]=useState<InventoryPage|null>(null);const [job,setJob]=useState<{id:string;status:string;failure_code:string|null}|null>(null);
  const [error,setError]=useState("");const [busy,setBusy]=useState(false);const syncKey=useRef<string|null>(null);
  const [previewErrors,setPreviewErrors]=useState<Set<string>>(new Set());
  const [uncertain,setUncertain]=useState(false);
  async function photos(cursor?:string) {const data=await api(`projects/${project.id}/photos?limit=24${cursor?`&cursor=${encodeURIComponent(cursor)}`:""}`);setInventory(old=>cursor&&old?{...data,items:[...old.items,...data.items]}:data);}
  useEffect(()=>{let active=true;Promise.all([api(`projects/${project.id}/photos?limit=24`),api(`jobs/${project.job_id}`)]).then(([data,j])=>{if(active){setInventory(data);setJob(j);setError("");setPreviewErrors(new Set());}}).catch(()=>{if(active)setError(en?"Inventory could not be loaded. Retry refresh.":"Inventaris belum dapat dimuat. Coba segarkan.");});return()=>{active=false;};},[project,en]);
  async function sync() {
    setBusy(true);setError("");syncKey.current??=crypto.randomUUID();
    try{const data=await api(`projects/${project.id}/sync`,"POST",{},syncKey.current);setJob(await api(`jobs/${data.job_id}`));await refresh();syncKey.current=null;setUncertain(false);}
    catch{setUncertain(true);setError(en?"Sync result is uncertain. Retry uses the same request key.":"Hasil sinkronisasi belum pasti. Coba lagi dengan kunci permintaan yang sama.");}finally{setBusy(false);}
  }
  async function cancel() {
    if(!job)return;setBusy(true);setError("");try{await api(`projects/${project.id}/sync/cancel`,"POST",{job_id:job.id});await refresh();}catch{setError(en?"Cancellation could not be confirmed. Refresh or retry.":"Pembatalan belum dapat dipastikan. Segarkan atau coba lagi.");}finally{setBusy(false);}
  }
  const activeJob=job?.status==="pending"||job?.status==="running";
  const stateNames:Record<string,string>=en?{pending:"Queued",running:"Scanning",succeeded:"Complete",failed:"Failed",cancelled:"Cancelled"}:{pending:"Mengantre",running:"Memindai",succeeded:"Selesai",failed:"Gagal",cancelled:"Dibatalkan"};
  return <section aria-label={en?"Photo inventory":"Inventaris foto"}>
    <h3>{en?"Photo inventory":"Inventaris foto"}</h3>
    <p>{inventory?.origin==="google_public"?(en?"Public Google Drive inventory. Only publicly visible items are included.":"Inventaris Google Drive publik. Hanya item yang terlihat secara publik yang disertakan."):inventory?.origin==="synthetic"?(en?"Synthetic fixture — generated colors only. Google Drive has not been verified.":"Fixture sintetis — hanya warna buatan. Google Drive belum diverifikasi."):(en?"No completed scan yet. Run the configured worker and sync the approved source.":"Belum ada pemindaian lengkap. Jalankan worker yang dikonfigurasi dan sinkronkan sumber yang disetujui.")}</p>
    {job&&<p role="status">{en?"Inventory job":"Pekerjaan inventaris"}: {stateNames[job.status]??"—"}</p>}
    {(inventory?.failure_code||job?.failure_code)&&<p role="alert">{en?"The scan did not complete. The previous complete inventory is retained. Review source access or retry.":"Pemindaian belum selesai. Inventaris lengkap sebelumnya dipertahankan. Periksa akses sumber atau coba lagi."}</p>}
    <div className="project-actions"><button disabled={busy||expired||!!project.archived_at||(activeJob&&!uncertain)} onClick={sync}>{uncertain?(en?"Retry sync request":"Ulangi permintaan sinkronisasi"):(en?"Sync photos":"Sinkronkan foto")}</button>{activeJob&&<button disabled={busy} onClick={cancel}>{en?"Cancel scan":"Batalkan pemindaian"}</button>}</div>
    {inventory&&<><p>{en?"Complete generation":"Generasi lengkap"}: {inventory.generation}{inventory.last_successful_sync_at?` · ${new Intl.DateTimeFormat(lang,{dateStyle:"medium",timeStyle:"short"}).format(new Date(inventory.last_successful_sync_at))}`:""}</p>
      {inventory.summary&&<p>{en?"Photos checked":"Foto diperiksa"}: {inventory.summary.photos} · {en?"Skipped (unsupported / trashed / oversize / invalid content)":"Dilewati (tidak didukung / dihapus / terlalu besar / konten tidak valid)"}: {["unsupported","trashed","oversize","invalid_content"].map(k=>inventory.summary!.skipped[k]??0).join(" / ")}</p>}
      <div className="inventory-grid">{inventory.items.map(photo=><figure key={photo.id}>{photo.preview_url&&!project.archived_at&&!previewErrors.has(photo.id)?<img src={photo.preview_url} alt={photo.filename} loading="lazy" width={256} height={192} onError={()=>setPreviewErrors(previous=>new Set([...previous,photo.id]))}/>:<p>{en?"Preview unavailable. Refresh or sync to recheck the source.":"Pratinjau tidak tersedia. Segarkan atau sinkronkan untuk memeriksa sumber."}</p>}<figcaption>{photo.filename}<small>{photo.folder_path||"/"} · {photo.available?(en?"Available":"Tersedia"):(en?"Unavailable":"Tidak tersedia")}</small></figcaption></figure>)}</div>
      {!inventory.items.length&&<p>{en?"No published photos yet.":"Belum ada foto yang diterbitkan."}</p>}
      {inventory.next_cursor&&<button disabled={busy} onClick={async()=>{setBusy(true);try{await photos(inventory.next_cursor!);}catch{setError(en?"Page unavailable. Retry.":"Halaman belum tersedia. Coba lagi.");}finally{setBusy(false);}}}>{en?"Load more photos":"Muat foto lainnya"}</button>}</>}
    {error&&<p role="alert" className="error">{error}</p>}
  </section>;
}

function ProjectForm({lang,defaults,project,disabled,onSaved,onError}:{lang:Lang;defaults:Defaults;project?:Project;disabled:boolean;onSaved:(p:Project)=>void;onError:(e:unknown)=>void}) {
  const t=copy[lang]; const [busy,setBusy]=useState(false); const [uncertain,setUncertain]=useState(false); const [dirty,setDirty]=useState(false);
  const [enabled,setEnabled]=useState({main:project?.workflows.find(w=>w.kind==="main")?.enabled??defaults.main.enabled,download:project?.workflows.find(w=>w.kind==="download")?.enabled??defaults.download.enabled});
  const attempt=useRef<{key:string;body:unknown}|null>(null);
  const lock=disabled||busy||uncertain;
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); const f=new FormData(event.currentTarget);
    const next:Record<string,unknown>={client_label:String(f.get("client_label")),client_phone:f.get("client_phone")||null,admin_phone:f.get("admin_phone")||null,notes_enabled:f.has("notes_enabled"),detect_subfolders:f.has("detect_subfolders")};
    if(project) next.expected_revision=project.revision; else next.drive_folder_id=candidate(String(f.get("drive_folder_id")));
    for(const kind of ["main","download"] as const){
      const w:Record<string,unknown>={enabled:enabled[kind]};
      const current=project?.workflows.find(w=>w.kind===kind);
      if(kind==="main") w.quota=Number(f.get("quota"))||null;
      const deadline=String(f.get(`${kind}_deadline`)??""); const initial=current?.expires_at?new Date(current.expires_at).toISOString().slice(0,16):"";
      if(!project||deadline!==initial) w.expires_at=deadline?new Date(`${deadline}:00Z`).toISOString():null;
      if(f.has(`${kind}_remove`))w.password=null;else if(f.get(`${kind}_password`))w.password=f.get(`${kind}_password`);
      next[kind]=w;
    }
    if(!project&&!attempt.current)attempt.current={key:crypto.randomUUID(),body:next};
    setBusy(true);
    try{const p=await api(project?`projects/${project.id}`:"projects",project?"PATCH":"POST",project?next:attempt.current!.body,project?undefined:attempt.current!.key);setDirty(false);setUncertain(false);onSaved(p);}
    catch(e){if(!project){const unknown=!(e instanceof RequestError)||e.status>=500||e.code.startsWith("IDEMPOTENCY_");setUncertain(unknown);if(!unknown)attempt.current=null;}onError(e);}
    finally{setBusy(false);}
  }
  return <form className="project-form" onChange={()=>setDirty(true)} onSubmit={submit}>
    <fieldset disabled={lock}><label>{t.label}<input name="client_label" required defaultValue={project?.client_label}/></label>{!project&&<label>{t.source}<input aria-label={t.source} name="drive_folder_id" required/><small>{t.sourceHint}</small></label>}
    <label>{t.clientPhone}<input name="client_phone" type="tel" defaultValue={project?.client_phone??""} pattern="\+[1-9][0-9]{1,14}"/></label><label>{t.adminPhone}<input name="admin_phone" type="tel" defaultValue={project?.admin_phone??""} pattern="\+[1-9][0-9]{1,14}"/></label>
    <label className="checkbox"><input name="notes_enabled" type="checkbox" defaultChecked={project?.notes_enabled??defaults.notes_enabled}/>{t.notes}</label><label className="checkbox"><input name="detect_subfolders" type="checkbox" defaultChecked={project?.detect_subfolders??defaults.detect_subfolders}/>{t.folders}</label>
    {(["main","download"] as const).map(kind=>{const w=project?.workflows.find(w=>w.kind===kind)??defaults[kind];return <fieldset key={kind}><legend>{t[kind]}</legend><label className="checkbox"><input type="checkbox" checked={enabled[kind]} onChange={e=>setEnabled({...enabled,[kind]:e.target.checked})}/>{t.enabled}</label>{kind==="main"&&<label>{t.quota}<input name="quota" type="number" min={1} max={500} required={enabled.main} defaultValue={w.quota??20}/></label>}<label>{t.deadline}<input aria-label={t.deadline} name={`${kind}_deadline`} type="datetime-local" defaultValue={w.expires_at?new Date(w.expires_at).toISOString().slice(0,16):""}/><small>{t.noDeadline}</small></label><label>{t.password}<input name={`${kind}_password`} type="password" minLength={8} maxLength={128} autoComplete="new-password"/></label>{w.password_set&&<><small>{t.passwordSet}</small><label className="checkbox"><input name={`${kind}_remove`} type="checkbox"/>{t.remove}</label></>}</fieldset>;})}
    </fieldset>{dirty&&!uncertain&&<p role="status">{t.unsaved}</p>}{uncertain&&<p role="alert">{t.retryNotice}</p>}<button className="primary" type="submit" disabled={disabled||busy}>{busy?t.busy:uncertain?t.retry:project?t.save:t.create}</button>
  </form>;
}
