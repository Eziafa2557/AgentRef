"use client";

import { AgentRefProvider } from "@/lib/agentref-provider";

/** Client boundary: mounts the app store above the navigation and pages. */
export function Providers({ children }: { children: React.ReactNode }) {
  return <AgentRefProvider>{children}</AgentRefProvider>;
}
