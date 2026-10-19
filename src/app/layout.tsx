import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = { title: "Snappik · Studio", description: "Your studio starts here.", robots: { index: false, follow: false } };
export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="id"><body>{children}</body></html>;
}
