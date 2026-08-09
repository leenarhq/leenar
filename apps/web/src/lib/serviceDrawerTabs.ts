export type TabKey = "overview" | "variables" | "domains" | "settings";

export const TAB_LABELS: Record<TabKey, string> = {
  overview: "Overview",
  variables: "Variables",
  domains: "Domains",
  settings: "Settings",
};

// Which providers surface which tabs today (grounded in the existing
// Sidebar/SidebarAdvanced content). Overview + Settings are always present.
// `isProvisioned` is accepted so callers can pass it uniformly; it gates
// in-tab actions (Redeploy, provisioned-resource block), NOT tab visibility.
// `resend` is included so its provider-agnostic per-node "Env Overrides"
// editor stays reachable (the Vercel/Cloudflare env editors self-gate and
// render nothing for Resend), preserving pre-tab-drawer parity.
const VARIABLES_PROVIDERS = new Set([
  "vercel",
  "supabase",
  "cloudflare",
  "resend",
]);
const DOMAINS_PROVIDERS = new Set(["vercel", "resend"]);

export function serviceDrawerTabs(
  provider: string,
  _isProvisioned: boolean,
): TabKey[] {
  const tabs: TabKey[] = ["overview"];
  if (VARIABLES_PROVIDERS.has(provider)) tabs.push("variables");
  if (DOMAINS_PROVIDERS.has(provider)) tabs.push("domains");
  tabs.push("settings");
  return tabs;
}
