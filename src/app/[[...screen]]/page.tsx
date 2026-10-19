import { notFound, redirect } from "next/navigation";
import { Foundation } from "@/ui/foundation";

export default async function Page({ params }: { params: Promise<{ screen?: string[] }> }) {
  const path = (await params).screen?.join("/") ?? "";
  if (!path) redirect("/login");
  if (!["login", "recover", "onboarding", "account", "app", "app/settings"].includes(path)) notFound();
  return <Foundation screen={path} />;
}
