import type { ReactNode } from "react";
import { Github, Triangle, Database, Mail, Cloud, Box } from "lucide-react";

/**
 * Provider identity, without colour.
 *
 * The old PROVIDER_META carried an `accent` and a `dim` per provider —
 * #3ecf8e, #7c6ef7, #f6821f and two CSS vars — which is what made a canvas
 * of five services read as five hues and left `ok` with nothing to say.
 * Recognition now lives in the glyph and the lowercase provider line.
 * See the spec's D3.
 */
const LABELS: Record<string, string> = {
  github: "GitHub",
  vercel: "Vercel",
  supabase: "Supabase",
  resend: "Resend",
  cloudflare: "Cloudflare",
};

export function providerLabel(provider: string): string {
  if (!provider) return "service";
  return LABELS[provider.toLowerCase()] ?? provider;
}

/** 15px stroke glyph, always `currentColor`: a provider mark carries no hue
 *  of its own, because colour in this console marks state and nothing else. */
export function providerIcon(provider: string): ReactNode {
  const p = provider?.toLowerCase();
  const cls = "h-[15px] w-[15px]";
  if (p === "github") return <Github className={cls} strokeWidth={1.4} />;
  if (p === "vercel") return <Triangle className={cls} strokeWidth={1.4} />;
  if (p === "supabase") return <Database className={cls} strokeWidth={1.4} />;
  if (p === "resend") return <Mail className={cls} strokeWidth={1.4} />;
  if (p === "cloudflare") return <Cloud className={cls} strokeWidth={1.4} />;
  return <Box className={cls} strokeWidth={1.4} />;
}
