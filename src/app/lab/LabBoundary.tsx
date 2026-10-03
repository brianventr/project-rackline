import { Component, type ReactNode } from "react";

/**
 * Keeps a lab failure inside the lab: a stale chunk after a deploy, or WebGL / the path tracer failing to
 * start, shows a sentence instead of unmounting the whole app.
 */
export class LabBoundary extends Component<{ children: ReactNode; fallback: (message: string) => ReactNode }, { message: string | null }> {
  state = { message: null as string | null };

  static getDerivedStateFromError(error: unknown) {
    return { message: error instanceof Error && error.message ? error.message : "Something went wrong." };
  }

  componentDidCatch(error: unknown) {
    console.error(error);
  }

  render() {
    return this.state.message ? this.props.fallback(this.state.message) : this.props.children;
  }
}
