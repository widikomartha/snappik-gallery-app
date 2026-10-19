import { auth } from "../auth/provider";

// Called only after a successful actual provider TOTP verification, inside its
// adapter transaction. Provider cookies may rotate during sign-in/enrollment.
export async function recordOperatorMfa(request: Request, response: Response) {
  const cookies = new Map((request.headers.get("cookie") ?? "").split(/;\s*/).filter(Boolean).map(p => { const i=p.indexOf("="); return [p.slice(0,i),p.slice(i+1)]; }));
  for (const cookie of response.headers.getSetCookie()) {
    const pair=cookie.split(";")[0], i=pair.indexOf("=");
    if (!pair.slice(i+1) || /max-age=0/i.test(cookie)) cookies.delete(pair.slice(0,i)); else cookies.set(pair.slice(0,i),pair.slice(i+1));
  }
  const headers = new Headers(request.headers); headers.set("cookie", [...cookies].map(([k,v])=>`${k}=${v}`).join("; "));
  const session = await auth().api.getSession({ headers, query: { disableCookieCache: true } });
  if (!session?.user.twoFactorEnabled) throw new Error("Verified factor session missing");
  // Use the same adapter transaction rather than a separate PostgreSQL connection.
  const adapter = (await auth().$context).adapter;
  const existing = await adapter.findOne<{id:string}>({ model: "operatorMfaProof", where: [{ field: "sessionId", value: session.session.id }] });
  if (existing) await adapter.update({ model:"operatorMfaProof",where:[{field:"sessionId",value:session.session.id}],update:{verifiedAt:new Date()} });
  else await adapter.create({ model:"operatorMfaProof",data:{sessionId:session.session.id,verifiedAt:new Date()} });
}
