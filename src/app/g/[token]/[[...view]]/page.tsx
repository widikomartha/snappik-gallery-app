import { notFound } from "next/navigation";
import { Gallery } from "@/ui/gallery";
export const metadata={title:"Snappik · Gallery",referrer:"no-referrer"};

export default async function Page({params}:{params:Promise<{token:string;view?:string[]}>}) {
  const {token,view}=await params;const route=view?.join("/")??"";
  if(!/^[\w-]{32}$/.test(token)||!["","main","main/review","download"].includes(route))notFound();
  return <Gallery token={token} view={route}/>;
}
