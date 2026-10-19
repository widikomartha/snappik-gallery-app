import { ownerHandler } from "@/modules/onboarding/service";
import { failure } from "@/modules/http";
import { galleryHandler } from "@/modules/gallery/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handler(request: Request) {
  try { return await (new URL(request.url).pathname.startsWith("/api/v1/g/") ? galleryHandler(request) : ownerHandler(request)); } catch (error) { return failure(error); }
}
export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const PUT = handler;
