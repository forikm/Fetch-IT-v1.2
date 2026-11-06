"use client";

import { Component, type ReactNode } from "react";

// A failed QR chunk must not prevent a passenger from sharing their digits.
export class PickupQrFallback extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed
      ? <p role="status" className="text-sm text-muted-foreground">Pickup QR is unavailable. Tell your driver the code below.</p>
      : this.props.children;
  }
}
