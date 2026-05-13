import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isProtectedRoute = createRouteMatcher([
  '/dashboard(.*)',
  '/api/v3/me(.*)',
  '/api/v3/orgs(.*)',
  '/api/v3/provision(.*)'
]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    '/dashboard(.*)',
    '/api/v3/me(.*)',
    '/api/v3/orgs(.*)',
    '/api/v3/provision(.*)'
  ]
};
