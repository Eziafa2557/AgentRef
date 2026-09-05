import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { AppNav } from "@/components/app-nav";

export const metadata: Metadata = {
  title: {
    default: "AgentRef — challengeable AI work receipts",
    template: "%s · AgentRef",
  },
  description:
    "The missing referee for the agentic economy. Mint a receipt for AI-delivered work, challenge it with evidence, and let an adjudicator rule — with every byte hashed and auditable.",
  applicationName: "AgentRef",
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#05060f",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>
        <div className="aurora-bg pointer-events-none fixed inset-0 -z-20" />
        <div className="grid-lines pointer-events-none fixed inset-0 -z-10" />
        <Providers>
          <AppNav />
          <main className="overflow-safe mx-auto w-full max-w-5xl px-4 pt-6 sm:px-6">
            {children}
          </main>
          <footer className="mx-auto w-full max-w-5xl px-4 pb-10 pt-16 text-center sm:px-6">
            <p className="text-xs leading-relaxed text-slate-500">
              AgentRef — a hackathon MVP. Dispute rulings tagged “SIMULATED” are produced by a
              transparent local model, never a GenLayer validator. Settlement amounts are simulated.
            </p>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
