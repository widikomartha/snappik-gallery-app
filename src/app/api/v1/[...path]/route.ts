import { ownerHandler } from "@/modules/onboarding/service";
import { failure } from "@/modules/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handler(request: Request) {
  try { return await ownerHandler(request); } catch (error) { return failure(error); }
}
export const GET = handler;
export const POST = handler;
export const PATCH = handler;
