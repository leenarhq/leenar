import { ENV_FLOW } from "../../lib/envFlow";
import { applyAutoLayout } from "./workspaceHelpers";

const TEMPLATE_ICON: Record<string, string> = {
  github: "Github",
  vercel: "Triangle",
  supabase: "Database",
  resend: "Send",
};

const TEMPLATE_LABEL: Record<string, string> = {
  github: "GitHub",
  vercel: "Vercel",
  supabase: "Supabase",
  resend: "Resend",
};

type TemplateEdgeDef = { from: string; to: string };

interface TemplateDef {
  services: string[];
  edges: TemplateEdgeDef[];
  emoji: string;
  desc: string;
}

const TEMPLATES: Record<string, TemplateDef> = {
  "Full-Stack App": {
    services: ["github", "vercel", "supabase"],
    edges: [
      { from: "github", to: "vercel" },
      { from: "supabase", to: "vercel" },
    ],
    emoji: "⚡",
    desc: "GitHub + Vercel + Supabase",
  },
  "SaaS with Email": {
    services: ["github", "vercel", "supabase", "resend"],
    edges: [
      { from: "github", to: "vercel" },
      { from: "supabase", to: "vercel" },
      { from: "resend", to: "supabase" },
    ],
    emoji: "✉️",
    desc: "Full-stack + transactional email",
  },
  "API + Database": {
    services: ["vercel", "supabase"],
    edges: [{ from: "supabase", to: "vercel" }],
    emoji: "🗄️",
    desc: "Vercel API + Supabase",
  },
  "Marketing Site": {
    services: ["github", "vercel", "resend"],
    edges: [
      { from: "github", to: "vercel" },
      { from: "resend", to: "vercel" },
    ],
    emoji: "🚀",
    desc: "GitHub + Vercel + Resend",
  },
  "Landing Page": {
    services: ["github", "vercel"],
    edges: [{ from: "github", to: "vercel" }],
    emoji: "🌐",
    desc: "GitHub + Vercel — minimal",
  },
  "Email Service": {
    services: ["vercel", "resend"],
    edges: [{ from: "resend", to: "vercel" }],
    emoji: "📬",
    desc: "Vercel + Resend — email only",
  },
  "Auth + Database": {
    services: ["vercel", "supabase"],
    edges: [{ from: "supabase", to: "vercel" }],
    emoji: "🔐",
    desc: "Vercel + Supabase Auth",
  },
};

export interface TemplateInfo {
  name: string;
  emoji: string;
  desc: string;
  services: string[];
  edges: TemplateEdgeDef[];
}

export const TEMPLATE_LIST: TemplateInfo[] = Object.entries(TEMPLATES).map(
  ([name, tpl]) => ({
    name,
    emoji: tpl.emoji,
    desc: tpl.desc,
    services: tpl.services,
    edges: tpl.edges,
  }),
);

export function buildTemplateCanvas(templateName: string) {
  const tpl = TEMPLATES[templateName];
  if (!tpl) return null;
  const ts = Date.now();
  const nodes = tpl.services.map((svc, i) => ({
    id: `${svc}-${ts}-${i}`,
    type: "service",
    position: { x: 140 + i * 280, y: 220 },
    data: {
      label: TEMPLATE_LABEL[svc] ?? svc,
      iconName: TEMPLATE_ICON[svc] ?? "Box",
      provider: svc,
    },
  }));
  const edges = tpl.edges.flatMap((e, i) => {
    const src = nodes.find((n) => n.data.provider === e.from);
    const tgt = nodes.find((n) => n.data.provider === e.to);
    if (!src || !tgt) return [];
    const envVars = ENV_FLOW[e.from]?.[e.to] ?? [];
    return [
      {
        id: `edge-${ts}-${i}`,
        source: src.id,
        target: tgt.id,
        type: "blueprint",
        animated: false,
        // Leave envVars empty: backend resolves ENV_FLOW + framework at provision
        // time. Freezing names here would be treated as a user override.
        data: {},
        // No `color` — see BlueprintEdge: the arrowhead is derived.
        markerEnd: { type: "arrowclosed" },
      },
    ];
  });
  return {
    nodes: applyAutoLayout(nodes as any, edges as any) as typeof nodes,
    edges,
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}
