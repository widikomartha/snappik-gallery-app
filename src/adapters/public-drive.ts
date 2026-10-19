import { z } from "zod";
import { FOLDER, MAX_BYTES, SourceError, checkAbort, providerId, type InventoryProvider, type ProviderFile, type SourceScope } from "../modules/inventory/provider";

const fields="id,name,mimeType,size,version,parents,trashed,resourceKey";
const metadata=z.object({id:z.string(),name:z.string().min(1).max(1024),mimeType:z.string(),size:z.string().regex(/^\d+$/).optional(),version:z.string().min(1).max(256),parents:z.array(z.string()).max(1).optional(),trashed:z.boolean().optional(),resourceKey:z.string().regex(/^[\w-]{1,200}$/).optional()});
type Entry={file:ProviderFile;resourceKey?:string};
// Public-only protocol adapter. Local runtime activation requires approved root/cache
// configuration; hosted operation remains gated by D-03. No OAuth/account actions.
// Official protocol references are recorded in docs/EPIC-03-EVIDENCE.md.
export class PublicDrive implements InventoryProvider {
  readonly origin="google_public" as const;
  private entries=new Map<string,Entry>();
  private requestCount=0;
  private listingPages=0;
  private continuations=0;
  diagnostics(){return {requests:this.requestCount,listing_pages:this.listingPages,pagination_continuations:this.continuations,resource_keys_observed:[...this.entries.values()].filter(entry=>!!entry.resourceKey).length};}
  constructor(private options:{apiKey:string;scope:SourceScope;rootResourceKey?:string;transport?:typeof fetch;pageSize?:number}) {
    if(!options.apiKey||!providerId(options.scope.rootId)||(options.rootResourceKey!==undefined&&!/^[\w-]{1,200}$/.test(options.rootResourceKey))||!Number.isInteger(options.pageSize??1000)||(options.pageSize??1000)<1||(options.pageSize??1000)>1000)throw new SourceError("PROVIDER_NOT_CONFIGURED");
  }
  private authorize(scope:SourceScope) {
    const approved=this.options.scope;
    if(scope.studioId!==approved.studioId||scope.projectId!==approved.projectId||scope.rootId!==approved.rootId)throw new SourceError("SOURCE_PERMISSION_LOST");
  }
  private async bounded(response:Response,limit:number) {
    const reader=response.body?.getReader();const chunks:Uint8Array[]=[];let size=0;
    try {if(reader)for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw new SourceError("INVALID_PROVIDER_RESPONSE");chunks.push(value);}}
    finally{await reader?.cancel().catch(()=>{});}
    try{return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;}catch{throw new SourceError("INVALID_PROVIDER_RESPONSE");}
  }
  private async request(path:string,params:Record<string,string>,id:string,signal:AbortSignal) {
    this.requestCount++;
    checkAbort(signal);
    const url=new URL(`https://www.googleapis.com/drive/v3/files${path}`);
    for(const [key,value]of Object.entries(params))url.searchParams.set(key,value);
    const resourceKey=id===this.options.scope.rootId?this.options.rootResourceKey??this.entries.get(id)?.resourceKey:this.entries.get(id)?.resourceKey;
    let response:Response;
    try{response=await(this.options.transport??fetch)(url,{headers:{"X-Goog-Api-Key":this.options.apiKey,...(resourceKey?{"X-Goog-Drive-Resource-Keys":`${id}/${resourceKey}`}:{})},redirect:"error",cache:"no-store",signal});}
    catch{throw new SourceError(signal.aborted?"SOURCE_TIMEOUT":"SOURCE_UNAVAILABLE",true);}
    if(!response.ok){
      let reason="";
      try{const data=await this.bounded(response,16384);const parsed=z.object({error:z.object({errors:z.array(z.object({reason:z.string()})).optional()})}).safeParse(data);reason=parsed.success?parsed.data.error.errors?.[0]?.reason??"":"";}catch{}
      if(response.status===429||["rateLimitExceeded","userRateLimitExceeded","downloadQuotaExceeded"].includes(reason)){
        const hint=response.headers.get("retry-after");let seconds=hint?Number(hint):0;if(!Number.isFinite(seconds))seconds=hint?(Date.parse(hint)-Date.now())/1000:0;
        throw new SourceError("SOURCE_RATE_LIMITED",true,Number.isFinite(seconds)?Math.min(3600,Math.max(0,Math.ceil(seconds))):0);
      }
      if(response.status===403||response.status===404)throw new SourceError("SOURCE_PERMISSION_LOST");
      if(response.status===400)throw new SourceError("INVALID_SOURCE");
      throw new SourceError("SOURCE_UNAVAILABLE",response.status>=500);
    }
    return response;
  }
  private parse(value:unknown,parentId?:string):Entry {
    const parsed=metadata.safeParse(value);if(!parsed.success)throw new SourceError("INVALID_PROVIDER_METADATA");
    const raw=parsed.data;
    if(!providerId(raw.id)||(parentId!==undefined&&raw.parents!==undefined&&(raw.parents.length!==1||raw.parents[0]!==parentId)))throw new SourceError("INVALID_PROVIDER_METADATA");
    const size=raw.size===undefined?0:Number(raw.size);
    if(!Number.isSafeInteger(size)||size<0||(raw.mimeType!==FOLDER&&raw.size===undefined&&["image/jpeg","image/png","image/webp"].includes(raw.mimeType)))throw new SourceError("INVALID_PROVIDER_METADATA");
    // Public files.get can omit parents. A parent is inferred only from the
    // server-generated parent query or an edge freshly proved by membership().
    return {file:{id:raw.id,name:raw.name,parentId:raw.parents?.[0]??parentId??null,mime:raw.mimeType,size,version:raw.version,trashed:raw.trashed},resourceKey:raw.resourceKey};
  }
  private async get(id:string,signal:AbortSignal,parentId?:string) {
    if(!providerId(id))throw new SourceError("INVALID_SOURCE");
    const response=await this.request(`/${id}`,{fields,supportsAllDrives:"true"},id,signal);
    const entry=this.parse(await this.bounded(response,65536),parentId);
    if(entry.file.id!==id)throw new SourceError("INVALID_PROVIDER_METADATA");return entry;
  }
  private ancestry(id:string) {
    const result:string[]=[];let current:string|null=id;
    while(current!==null&&result.length<=11){
      result.push(current);if(current===this.options.scope.rootId)return result;
      const entry=this.entries.get(current);if(!entry)break;current=entry.file.parentId;
    }
    throw new SourceError("SOURCE_PERMISSION_LOST");
  }
  async folder(scope:SourceScope,id:string,signal:AbortSignal) {
    this.authorize(scope);if(id!==scope.rootId)throw new SourceError("INVALID_SOURCE");this.entries.clear();
    const entry=await this.get(id,AbortSignal.any([signal,AbortSignal.timeout(15000)]));
    if(entry.file.mime!==FOLDER||entry.file.trashed)throw new SourceError("INVALID_SOURCE");this.entries.set(id,entry);return entry.file;
  }
  async assertPreviewVisible(scope:SourceScope,expected:{id:string;version:string;mime:string;size:number;ancestry:string[]|null},signal:AbortSignal) {
    this.authorize(scope);
    const abort=AbortSignal.any([signal,AbortSignal.timeout(10000)]);
    const path=z.array(z.string().refine(providerId)).min(1).max(11).safeParse(expected.ancestry);
    if(!path.success||path.data[0]!==scope.rootId||new Set([...path.data,expected.id]).size!==path.data.length+1)throw new SourceError("SOURCE_PERMISSION_LOST");
    await this.folder(scope,scope.rootId,abort);
    for(let index=1;index<path.data.length;index++){
      const folder=await this.membership(path.data[index-1],path.data[index],abort);
      if(folder.file.mime!==FOLDER||folder.file.trashed)throw new SourceError("SOURCE_PERMISSION_LOST");
    }
    const listed=await this.membership(path.data.at(-1)!,expected.id,abort);
    if(listed.file.trashed)throw new SourceError("SOURCE_PERMISSION_LOST");
    const photo=await this.get(expected.id,abort,path.data.at(-1));
    if(photo.file.trashed)throw new SourceError("SOURCE_PERMISSION_LOST");
    if(photo.file.version!==expected.version||photo.file.mime!==expected.mime||photo.file.size!==expected.size)throw new SourceError("SOURCE_VERSION_CHANGED",true);
  }
  private async listing(id:string,cursor:string|null,signal:AbortSignal){
    this.listingPages++;if(cursor)this.continuations++;
    const response=await this.request("",{q:`'${id}' in parents`,fields:`files(${fields}),nextPageToken,incompleteSearch`,pageSize:String(this.options.pageSize??1000),spaces:"drive",supportsAllDrives:"true",includeItemsFromAllDrives:"true",...(cursor?{pageToken:cursor}:{})},id,signal);
    const data=z.object({files:z.array(z.unknown()).max(1000),nextPageToken:z.string().min(1).max(2048).optional(),incompleteSearch:z.boolean().optional()}).safeParse(await this.bounded(response,4*1024*1024));
    if(!data.success)throw new SourceError("INVALID_PROVIDER_RESPONSE");if(data.data.incompleteSearch)throw new SourceError("INCOMPLETE_PROVIDER_SEARCH");
    return {entries:data.data.files.map(value=>this.parse(value,id)),next:data.data.nextPageToken??null};
  }
  private async membership(parentId:string,id:string,signal:AbortSignal){
    this.ancestry(parentId);let cursor:string|null=null;const seen=new Set<string>();
    for(let page=0;page<20;page++){
      const result=await this.listing(parentId,cursor,signal);const entry=result.entries.find(entry=>entry.file.id===id);
      if(entry){this.entries.set(id,entry);return entry;}
      if(!result.next)break;if(seen.has(result.next))throw new SourceError("INVALID_PROVIDER_CURSOR");seen.add(result.next);cursor=result.next;
    }
    throw new SourceError("SOURCE_PERMISSION_LOST");
  }
  async list(scope:SourceScope,id:string,cursor:string|null,signal:AbortSignal) {
    this.authorize(scope);this.ancestry(id);
    if(this.entries.get(id)?.file.mime!==FOLDER)throw new SourceError("INVALID_SOURCE");
    const abort=AbortSignal.any([signal,AbortSignal.timeout(15000)]);
    const {entries,next}=await this.listing(id,cursor,abort);
    if(this.entries.size+entries.length>22000)throw new SourceError("SCAN_ENTRY_LIMIT");
    for(const entry of entries){if(this.entries.has(entry.file.id))throw new SourceError("DUPLICATE_PROVIDER_ID");this.entries.set(entry.file.id,entry);}
    return {files:entries.map(e=>e.file),next};
  }
  async *read(scope:SourceScope,file:ProviderFile,signal:AbortSignal) {
    this.authorize(scope);const path=this.ancestry(file.id);const known=this.entries.get(file.id);
    if(!known||known.file.mime===FOLDER||file.size>MAX_BYTES||file.version!==known.file.version)throw new SourceError("INVALID_SOURCE");
    const abort=AbortSignal.any([signal,AbortSignal.timeout(60000)]);
    // Revalidate public visibility/ancestry, including the root, without following shortcuts.
    const root=await this.get(scope.rootId,abort);if(root.file.trashed||root.file.mime!==FOLDER)throw new SourceError("SOURCE_PERMISSION_LOST");
    for(let index=path.length-2;index>=0;index--){const entry=await this.membership(path[index+1],path[index],abort);if(entry.file.trashed||(index>0&&entry.file.mime!==FOLDER))throw new SourceError("SOURCE_PERMISSION_LOST");}
    const fresh=await this.get(file.id,abort,file.parentId!);if(fresh.file.trashed)throw new SourceError("SOURCE_PERMISSION_LOST");if(fresh.file.version!==file.version||fresh.file.size!==file.size||fresh.file.mime!==file.mime)throw new SourceError("SOURCE_VERSION_CHANGED",true);
    const response=await this.request(`/${file.id}`,{alt:"media",supportsAllDrives:"true"},file.id,abort);
    const length=response.headers.get("content-length");
    if(length!==null&&(!/^\d+$/.test(length)||Number(length)!==file.size)){await response.body?.cancel();throw new SourceError("SOURCE_SIZE_CHANGED",true);}
    const mime=response.headers.get("content-type")?.split(";")[0];
    if(mime!==file.mime){await response.body?.cancel();throw new SourceError("INVALID_PROVIDER_CONTENT");}
    const reader=response.body?.getReader();let size=0;
    try{if(reader)for(;;){if(abort.aborted)throw new SourceError("SOURCE_TIMEOUT",true);const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_BYTES||size>file.size)throw new SourceError("SOURCE_SIZE_CHANGED",true);yield value;}}
    finally{await reader?.cancel().catch(()=>{});}
    if(size!==file.size)throw new SourceError("SOURCE_SIZE_CHANGED",true);
    const after=await this.get(file.id,abort,file.parentId!);
    if(after.file.version!==file.version||after.file.trashed)throw new SourceError("SOURCE_VERSION_CHANGED",true);
  }
}
