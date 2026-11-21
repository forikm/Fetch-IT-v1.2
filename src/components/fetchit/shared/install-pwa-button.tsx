"use client";

// Listens for the browser's "this can be installed as an app" signal.
// Only fires on browsers/OSes that support installable PWAs (mainly
// Chrome/Edge on Android, and some desktop Chromium browsers) — Safari on
// iOS doesn't support this event at all (iOS users install via
// Share → Add to Home Screen instead, which can't be triggered by JS).

import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

declare global {
  interface Window {
    __deferredInstallPrompt__?: BeforeInstallPromptEvent;
    __fetchItInstalled__?: boolean;
  }
}

/** Shared logic so any component (a button, a menu item, ...) can offer
 * the install prompt without duplicating the event-listener plumbing. */
function subscribeInstallPrompt(notify: () => void) {
  const onBeforeInstall = (event: Event) => {
    event.preventDefault();
    window.__fetchItInstalled__ = false;
    window.__deferredInstallPrompt__ = event as BeforeInstallPromptEvent;
    notify();
  };
  const onInstalled = () => {
    window.__fetchItInstalled__ = true;
    window.__deferredInstallPrompt__ = undefined;
    notify();
  };
  const displayMode = window.matchMedia("(display-mode: standalone)");
  window.addEventListener("fetchit:install-ready", notify);
  window.addEventListener("beforeinstallprompt", onBeforeInstall);
  window.addEventListener("appinstalled", onInstalled);
  displayMode.addEventListener("change", notify);
  return () => {
    window.removeEventListener("fetchit:install-ready", notify);
    window.removeEventListener("beforeinstallprompt", onBeforeInstall);
    window.removeEventListener("appinstalled", onInstalled);
    displayMode.removeEventListener("change", notify);
  };
}

function readInstallOffer() {
  const device = window.navigator as (Navigator & { standalone?: boolean }) | undefined;
  if (window.__fetchItInstalled__ || window.matchMedia("(display-mode: standalone)").matches || device?.standalone) return null;
  if (window.__deferredInstallPrompt__) return window.__deferredInstallPrompt__;
  if (device && (/iPhone|iPad|iPod/i.test(device.userAgent) || (device.platform === "MacIntel" && device.maxTouchPoints > 1))) return "ios" as const;
  return null;
}

export function useInstallPrompt() {
  // All install controls share the browser's one-use prompt, including an
  // event captured before React mounted. Consuming it updates every control.
  const offer = useSyncExternalStore(subscribeInstallPrompt, readInstallOffer, () => null);
  const deferredPrompt = offer === "ios" ? null : offer;
  const canInstall = !!deferredPrompt;

  async function install() {
    if (!deferredPrompt || readInstallOffer() !== deferredPrompt) return;
    // Consume before awaiting to prevent another control prompting twice.
    window.__deferredInstallPrompt__ = undefined;
    window.dispatchEvent(new Event("fetchit:install-ready"));
    try {
      await deferredPrompt.prompt();
      if ((await deferredPrompt.userChoice).outcome === "accepted") {
        window.__fetchItInstalled__ = true;
        window.dispatchEvent(new Event("fetchit:install-ready"));
      }
    } catch {
      // The browser may close the prompt as the app or tab changes.
    }
  }

  return { canInstall, install, showIOSInstructions: offer === "ios" };
}

export function InstallPwaButton() {
  const { canInstall, install, showIOSInstructions } = useInstallPrompt();
  if (showIOSInstructions) return (
    <details className="rounded-xl border bg-card">
      <summary className="min-h-12 cursor-pointer rounded-xl px-4 py-3 font-medium focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">Add Fetch-It to Home Screen</summary>
      <p className="px-4 pb-3 text-sm text-muted-foreground">Open Fetch-It in Safari, tap Share, then tap Add to Home Screen.</p>
    </details>
  );
  if (!canInstall) return null;

  return (
    <Button
      type="button"
      variant="outline"
      onClick={install}
      className="min-h-12 w-full justify-start"
    >
      <Download className="h-4 w-4" />
      Add Fetch-It to Home Screen
    </Button>
  );
}
