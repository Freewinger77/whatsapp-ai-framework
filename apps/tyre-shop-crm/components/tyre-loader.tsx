"use client";

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
  return (
    <div className="rs-page-load" role="status" aria-live="polite" aria-label="Loading">
      <TyreLoader />
    </div>
  );
}
