import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { App as CapApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";

// Android's back button used to close the app from anywhere, losing whatever was open.
// Now one press peels back one layer: first any open overlay, then the section's home,
// and only on the home screen does it send the app to the background (it stays running).

// Radix keeps an open overlay in the DOM with data-state="open"; popovers, selects,
// dropdowns and tooltips live inside a popper wrapper that only exists while open.
const OVERLAY_SELECTOR = [
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
  "[data-radix-popper-content-wrapper]",
  '[data-vaul-drawer][data-state="open"]',
].join(",");

// Each area of the app has its own home; anything else falls back to the entry screen.
const SECTION_HOMES = ["/admin", "/aluno", "/meu-painel"];

export function sectionHome(pathname: string): string {
  const match = SECTION_HOMES.find(h => pathname === h || pathname.startsWith(`${h}/`));
  return match ?? "/";
}

function closeTopOverlay(): boolean {
  if (!document.querySelector(OVERLAY_SELECTOR)) return false;
  // Every Radix layer closes on Escape, so one synthetic press dismisses the topmost one.
  document.dispatchEvent(new KeyboardEvent("keydown", {
    key: "Escape",
    code: "Escape",
    bubbles: true,
    cancelable: true,
  }));
  return true;
}

export default function AndroidBackButton() {
  const navigate = useNavigate();
  const location = useLocation();

  // The listener is registered once, so it reads the current path from a ref.
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let cancelled = false;
    let remove: (() => void) | undefined;

    CapApp.addListener("backButton", () => {
      if (closeTopOverlay()) return;
      const path = pathRef.current;
      const home = sectionHome(path);
      if (path === home) CapApp.minimizeApp();
      else navigate(home);
    }).then(handle => {
      if (cancelled) handle.remove();
      else remove = () => handle.remove();
    });

    return () => { cancelled = true; remove?.(); };
  }, [navigate]);

  return null;
}
