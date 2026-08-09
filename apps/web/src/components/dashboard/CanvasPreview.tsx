import { Workflow } from "lucide-react";
import { Panel, EmptyRow } from "./Panel";

type CanvasLike = {
  nodes?: Array<{
    id: string;
    position?: { x: number; y: number };
    data?: { label?: string; provider?: string };
  }>;
  edges?: Array<{ id: string; source: string; target: string }>;
} | null;

// Static mini topology preview. The full interactive Canvas editor is a later phase.
export function CanvasPreview({
  canvas,
}: {
  canvas: CanvasLike;
  projectId: string;
}) {
  const nodes = canvas?.nodes ?? [];
  const edges = canvas?.edges ?? [];

  return (
    <Panel title="Project Topology" icon={Workflow} bodyClassName="p-0">
      {nodes.length === 0 ? (
        <EmptyRow>No services yet</EmptyRow>
      ) : (
        <div
          className="relative h-[220px] overflow-hidden rounded-b-md"
          style={{
            backgroundImage:
              "radial-gradient(circle, var(--color-border) 1px, transparent 1px)",
            backgroundSize: "16px 16px",
          }}
        >
          <svg className="absolute inset-0 h-full w-full">
            {edges.map((e) => {
              const s = nodes.find((n) => n.id === e.source);
              const t = nodes.find((n) => n.id === e.target);
              if (!s?.position || !t?.position) return null;
              return (
                <line
                  key={e.id}
                  x1={s.position.x * 0.18 + 30}
                  y1={s.position.y * 0.18 + 20}
                  x2={t.position.x * 0.18 + 30}
                  y2={t.position.y * 0.18 + 20}
                  stroke="var(--color-border)"
                  strokeWidth={1}
                />
              );
            })}
          </svg>
          {nodes.slice(0, 12).map((n) => (
            <div
              key={n.id}
              className="absolute rounded border border-border bg-secondary px-2 py-1 font-mono text-[9px]"
              style={{
                left: (n.position?.x ?? 0) * 0.18 + 12,
                top: (n.position?.y ?? 0) * 0.18 + 12,
              }}
            >
              {n.data?.label ?? n.data?.provider ?? n.id.slice(0, 6)}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
