'use client';

import { Show, SignInButton, SignUpButton, UserButton } from '@clerk/nextjs';
import { usePathname } from 'next/navigation';

export function AuthNav() {
  const pathname = usePathname();

  if (pathname === '/') {
    return <a className="pill" href="/dashboard">Open dashboard</a>;
  }

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <Show when="signed-out">
        <SignInButton mode="modal">
          <button className="pill">Sign in</button>
        </SignInButton>
        <SignUpButton mode="modal">
          <button className="pill">Sign up</button>
        </SignUpButton>
      </Show>
      <Show when="signed-in">
        <UserButton />
      </Show>
    </div>
  );
}
