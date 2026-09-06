"use client";

import { DotLottieReact } from "@lottiefiles/dotlottie-react";

export function TyreLoader({ size = 168 }: { size?: number }) {
  return (
    <div className="rs-tyre-load" style={{ width: size, height: size }} aria-hidden>
      <DotLottieReact src="/tyre.lottie?v=2" loop autoplay style={{ width: size, height: size }} />
    </div>
  );
}
