import { notFound, redirect } from "next/navigation";
import { Foundation } from "@/ui/foundation";

export default async function Page({ params }: { params: Promise<{ screen?: string[] }> }) {
  const path = (await params).screen?.join("/") ?? "";
  if (!path) redirect("/login");
  if (!["login", "recover", "onboarding", "account", "app", "app/settings", "app/projects", "app/projects/new"].includes(path) && !/^app\/projects\/[0-9a-f-]{36}(\/edit)?$/.test(path)) notFound();
  return <Foundation screen={path} />;
}
