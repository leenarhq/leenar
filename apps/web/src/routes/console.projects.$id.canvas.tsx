import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState, Component } from "react";
import type { ReactNode, ErrorInfo } from "react";
import * as Sentry from "@sentry/react";
import { useAuth } from "../context/auth";
import { useIsMobile } from "@/hooks/use-mobile";
import { z } from "zod";

const ProjectCanvas = lazy(() =>
  import("../components/canvas/WorkspaceCanvas").then((m) => ({
    default: m.ProjectCanvas,
  })),
);
const ProjectMobileView = lazy(() =>
  import("../components/canvas/WorkspaceMobileView").then((m) => ({
    default: m.ProjectMobileView,
  })),
);

export const Route = createFileRoute("/console/projects/$id/canvas")({
  validateSearch: z.object({ template: z.string().optional() }),
  component: ProjectCanvasPage,
});

const fallbackStyle: React.CSSProperties = {
  height: "100%",
  width: "100%",
  background: "var(--app-bg, #050505)",
};

class CanvasErrorBoundary extends Component<
  { children: ReactNode },
  { error: string | null }
> {
  state = { error: null };
  static getDerivedStateFromError(e: Error) {
    return { error: e.message };
  }
  componentDidCatch(e: Error, info: ErrorInfo) {
    Sentry.captureException(e, {
      extra: {
        component: "CanvasErrorBoundary",
        componentStack: info.componentStack,
      },
    });
  }
  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            ...fallbackStyle,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "column",
            gap: 12,
            color: "#ef4444",
            fontSize: 14,
          }}
        >
          <span>Canvas crashed — please refresh.</span>
          <code style={{ fontSize: 12, opacity: 0.6 }}>{this.state.error}</code>
        </div>
      );
    }
    return this.props.children;
  }
}

function ProjectCanvasPage() {
  const { session } = useAuth();
  const { id } = Route.useParams();
  const { template } = Route.useSearch();
  const [mounted, setMounted] = useState(false);
  const isMobile = useIsMobile();
  useEffect(() => {
    setMounted(true);
  }, []);
  if (!session || !mounted) return <div style={fallbackStyle} />;
  if (isMobile) {
    return (
      <Suspense fallback={<div style={fallbackStyle} />}>
        <ProjectMobileView projectId={id} template={template} />
      </Suspense>
    );
  }
  return (
    <div className="h-full w-full overflow-hidden">
      <CanvasErrorBoundary>
        <Suspense fallback={<div style={fallbackStyle} />}>
          <ProjectCanvas projectId={id} template={template} />
        </Suspense>
      </CanvasErrorBoundary>
    </div>
  );
}
