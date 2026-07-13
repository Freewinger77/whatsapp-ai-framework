import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const isProtectedRoute = createRouteMatcher([
  '/dashboard(.*)',
  '/api/v3(.*)'
]);

const isPublicPairingRoute = createRouteMatcher(['/api/v3/public/pair(.*)']);

const allowedCorsOrigins = new Set([
  'https://wasuppolymetapp.z16.web.core.windows.net',
  'https://dev.wasup.co',
  'https://dashboard.wasup.co',
  'https://app.wasup.co'
]);

export default clerkMiddleware(async (auth, req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS' && req.nextUrl.pathname.startsWith('/api/v3/')) {
    return new NextResponse(null, {
      status: corsHeaders ? 204 : 403,
      headers: corsHeaders ?? undefined
    });
  }

  if (isProtectedRoute(req) && !isApiKeyApiRequest(req) && !isPublicPairingRoute(req)) {
    await auth.protect();
  }

  const response = NextResponse.next();
  if (corsHeaders && req.nextUrl.pathname.startsWith('/api/v3/')) {
    corsHeaders.forEach((value, key) => response.headers.set(key, value));
  }
  return response;
});

export const config = {
  matcher: [
    '/dashboard(.*)',
    '/api/v3/(.*)'
  ]
};

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('origin');
  if (!origin || !allowedCorsOrigins.has(origin)) return null;

  return new Headers({
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, X-Requested-With, X-API-Key, X-Pairing-Token',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  });
}

function isApiKeyApiRequest(req: Request & { nextUrl: URL }) {
  if (!req.nextUrl.pathname.startsWith('/api/v3/')) return false;
  const xApiKey = req.headers.get('x-api-key') || '';
  const authorization = req.headers.get('authorization') || '';
  return xApiKey.startsWith('wsp_v3_') || /^Bearer\s+wsp_v3_/i.test(authorization);
}
