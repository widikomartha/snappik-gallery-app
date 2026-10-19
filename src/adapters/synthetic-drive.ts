import sharp from "sharp";
import { localPublicDrive } from "./drive-local-config";
import { checkAbort, FOLDER, MAX_BYTES, SourceError, type InventoryProvider, type ProviderFile, type SourceScope, type ScopedInventorySource } from "../modules/inventory/provider";

export const SYNTHETIC_ROOT = "synthetic-folder-00001";
// Generated colors only. No filesystem paths, arbitrary URLs, credentials or real photographs.
export class SyntheticDrive implements InventoryProvider {
  readonly origin = "synthetic" as const;
  private authorize(scope: SourceScope, signal: AbortSignal) {
    checkAbort(signal); if (scope.rootId !== SYNTHETIC_ROOT) throw new SourceError("SOURCE_PERMISSION_LOST");
  }
  async folder(scope: SourceScope, id: string, signal: AbortSignal): Promise<ProviderFile> {
    this.authorize(scope,signal);
    if (id !== SYNTHETIC_ROOT) throw new SourceError("INVALID_SOURCE");
    return { id, name: "Synthetic root", parentId: null, mime: FOLDER, size: 0, version: "1" };
  }
  async list(scope: SourceScope, id: string, cursor: string | null, signal: AbortSignal) {
    this.authorize(scope,signal);
    const files: ProviderFile[] = id === SYNTHETIC_ROOT ? [
      { id: "synthetic-child-00001", name: "Portraits", parentId: id, mime: FOLDER, size: 0, version: "1" },
      await this.photo("synthetic-photo-00001", "IMG_001.jpg", id),
      { id: "synthetic-unsupported", name: "notes.txt", parentId: id, mime: "text/plain", size: 12, version: "1" },
      { id: "synthetic-oversize-01", name: "large.jpg", parentId: id, mime: "image/jpeg", size: MAX_BYTES+1, version: "1" },
      { id: "synthetic-trashed-001", name: "deleted.jpg", parentId: id, mime: "image/jpeg", size: 12, version: "1", trashed: true },
    ] : id === "synthetic-child-00001" ? [await this.photo("synthetic-photo-00002", "IMG_001.jpg", id),await this.photo("synthetic-photo-00003", "IMAGE.JPG", id)] : [];
    if (id !== SYNTHETIC_ROOT && id !== "synthetic-child-00001") throw new SourceError("SOURCE_PERMISSION_LOST");
    if (cursor !== null && cursor !== "2" && cursor !== "4") throw new SourceError("INVALID_PROVIDER_CURSOR");
    const start = Number(cursor ?? 0); return { files: files.slice(start,start+2), next: files.length > start+2 ? String(start+2) : null };
  }
  private async bytes(id: string) { return sharp({create:{width:1200,height:800,channels:3,background:id.endsWith("1")?"#3b7197":"#a57950"}}).jpeg().toBuffer(); }
  private async photo(id: string, name: string, parentId: string): Promise<ProviderFile> { return {id,name,parentId,mime:"image/jpeg",size:(await this.bytes(id)).length,version:"synthetic-v1"}; }
  async *read(scope: SourceScope, file: ProviderFile, signal: AbortSignal) {
    this.authorize(scope,signal);
    if (!["synthetic-photo-00001","synthetic-photo-00002","synthetic-photo-00003"].includes(file.id)) throw new SourceError("SOURCE_PERMISSION_LOST");
    yield await this.bytes(file.id); checkAbort(signal);
  }
}
export function configuredInventoryProvider(): InventoryProvider | ScopedInventorySource | null {
  if (process.env.INVENTORY_ADAPTER === undefined || process.env.INVENTORY_ADAPTER === "disabled") return null;
  if (process.env.APP_MODE === "local" && process.env.INVENTORY_ADAPTER === "google_public") return {origin:"google_public",forScope:localPublicDrive};
  if (process.env.APP_MODE !== "local" || process.env.INVENTORY_ADAPTER !== "synthetic") throw new SourceError("PROVIDER_NOT_CONFIGURED");
  return new SyntheticDrive();
}
