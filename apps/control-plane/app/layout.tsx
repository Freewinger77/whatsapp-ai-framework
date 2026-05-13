import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import { AuthNav } from '../components/auth-nav';
import './globals.css';

export const metadata: Metadata = {
  title: 'Wasup v3 Control Plane',
  description: 'Central SaaS control plane for Wasup organizations, instances, proxies, and workers.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ClerkProvider>
          <main className="shell">
            <header className="topbar">
              <div className="brand">
                <h1>Wasup v3 Control Plane</h1>
                <span>Organizations, isolated workers, regional proxies, and fleet health.</span>
              </div>
              <AuthNav />
            </header>
            {children}
          </main>
        </ClerkProvider>
      </body>
    </html>
  );
}
