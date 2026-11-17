// Shared bits for every page that shows Home Assistant data.
import { pill } from "../atoms/badge";
import { button } from "../atoms/button";
import { card } from "../molecules/card";
import { empty } from "../molecules/empty";
import { toast } from "../molecules/toast";
import { ha, haConfig } from "../services/home-assistant";

/**
 * What to show instead of the page while Home Assistant is not connected:
 * a "connect" card, or the connection status. Null when the data is there.
 */
export function haGate(what: string, goTo: (page: string) => void): HTMLElement | null {
  if (!haConfig()) {
    return card({ title: "Home Assistant", icon: "home", wide: true, cls: "card-hero" },
      empty(`Connect Home Assistant to see ${what}.`, {
        icon: "plug",
        action: button("Connect in Settings", () => goTo("settings"), { variant: "primary", icon: "plug" }),
      }));
  }
  if (ha.status !== "online" && !ha.entities().length) {
    return card({ title: "Home Assistant", icon: "home", wide: true, aside: pill(ha.status, ha.status === "error" ? "bad" : "info") },
      empty(ha.error || "Connecting to Home Assistant…", { icon: "home" }));
  }
  return null;
}

/** Calls a Home Assistant service and reports the outcome as a toast. */
export async function act(domain: string, service: string, target: Record<string, unknown> | null, data: Record<string, unknown> = {}, done?: string): Promise<void> {
  try {
    await ha.call(domain, service, target, data);
    if (done) toast(done, "ok");
  } catch (e) {
    toast(`${domain}.${service} failed: ${(e as Error).message}`, "bad");
  }
}
