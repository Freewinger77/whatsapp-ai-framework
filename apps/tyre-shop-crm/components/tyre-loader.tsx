"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { DotLottieReact } from "@lottiefiles/dotlottie-react";

const SIZE = 128;

export function TyreLoader({ size = SIZE }: { size?: number }) {
  return (
    <div style={{ width: size, height: size }} aria-hidden>
      <DotLottieReact src="/tyre.lottie?v=2" loop autoplay style={{ width: size, height: size }} />
    </div>
  );
}

export function PageLoader() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <div
      className="rs-page-load"
      role="status"
      aria-live="polite"
      aria-label="Loading"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 80,
        display: "grid",
        placeItems: "center",
        background: "rgba(0, 0, 0, 0.25)",
      }}
    >
      <TyreLoader />
    </div>,
    document.body,
  );
}
