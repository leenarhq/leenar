import { Component } from "react";
import type { ReactNode, ErrorInfo } from "react";
import * as Sentry from "@sentry/react";

interface Props {
  name: string;
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  error: string | null;
}

export class ComponentErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(e: Error): State {
    return { error: e.message };
  }

  componentDidCatch(e: Error, info: ErrorInfo) {
    Sentry.captureException(e, {
      extra: {
        component: this.props.name,
        componentStack: info.componentStack,
      },
    });
    console.error(`[ErrorBoundary:${this.props.name}]`, e, info.componentStack);
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div
          className="flex items-center justify-center h-full w-full"
          style={{ background: "rgba(239,68,68,0.04)" }}
        >
          <div className="text-center space-y-1 px-4">
            <p className="text-[11px] text-red-400/80 font-semibold">
              {this.props.name} crashed
            </p>
            <p className="text-[10px] text-muted-foreground/60 font-mono">
              {this.state.error}
            </p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
