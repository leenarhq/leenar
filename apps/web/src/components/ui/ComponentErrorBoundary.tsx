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
        <div className="flex h-full w-full items-center justify-center bg-crit/5">
          <div className="space-y-1 px-4 text-center">
            <p className="text-[11px] font-semibold text-crit">
              {this.props.name} crashed
            </p>
            <p className="font-mono text-[10px] text-dim">{this.state.error}</p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
