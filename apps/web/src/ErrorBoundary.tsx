import { Component, type ReactNode } from "react";

/** Shows `fallback` instead of an empty page when rendering below it throws. */
export class ErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: unknown) {
    console.error(error);
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
