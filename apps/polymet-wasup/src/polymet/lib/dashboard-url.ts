const DEFAULT_DASHBOARD_ORIGIN = "https://dev.wasup.co";
const HASH_ROUTED_PATHS = new Set([
  "/",
  "/sign-in",
  "/sign-up",
  "/sso-callback",
  "/connection",
  "/accept-invitation",
  "/instances",
  "/playground",
  "/deep-dive",
  "/docs",
  "/settings",
]);
const CLERK_REDIRECT_PARAM_NAMES = [
  "redirect_url",
  "sign_in_force_redirect_url",
  "sign_up_force_redirect_url",
  "sign_in_fallback_redirect_url",
  "sign_up_fallback_redirect_url",
  "fallback_redirect_url",
  "after_sign_out_url",
];

type SearchInput = URLSearchParams | Record<string, string | null | undefined>;

export function getDashboardOrigin() {
  const configured = import.meta.env.VITE_WASUP_APP_URL?.trim();
  const configuredOrigin = configured ? normalizeOrigin(configured) : "";
  if (configuredOrigin) return configuredOrigin;

  if (isLocalHost(window.location.hostname)) return window.location.origin;
  return DEFAULT_DASHBOARD_ORIGIN;
}

export function buildDashboardUrl(hashRoute: string, search?: SearchInput) {
  const url = new URL(getDashboardOrigin());
  applySearchParams(url, search);
  url.hash = normalizeHashRoute(hashRoute);
  return url.toString();
}

export function buildChooseOrganizationTaskUrl(search?: SearchInput) {
  return buildDashboardUrl("/sign-up/tasks/choose-organization", search);
}

export function normalizeClerkNavigationUrl(to: string) {
  const destination = to.trim();
  if (!destination) return buildDashboardUrl("/sign-in");

  if (isChooseOrganizationTaskDestination(destination)) {
    return buildChooseOrganizationTaskUrl(getDestinationSearchParams(destination));
  }

  if (destination.startsWith("/#/")) {
    return sanitizeDashboardUrl(`${getDashboardOrigin()}${destination}`);
  }

  if (destination.startsWith("#/")) {
    return sanitizeDashboardUrl(`${getDashboardOrigin()}/${destination}`);
  }

  const parsed = parseDestination(destination);
  if (parsed) {
    const hashRoute = getHashRouteFromUrl(parsed);
    if (hashRoute) {
      return buildDashboardUrl(hashRoute, sanitizeClerkRedirectParams(parsed.searchParams));
    }

    if (isDashboardOrigin(parsed.origin) && isHashRoutedPath(parsed.pathname)) {
      return buildDashboardUrl(parsed.pathname, sanitizeClerkRedirectParams(parsed.searchParams));
    }
  }

  if (destination.startsWith("/") && isHashRoutedPath(getPathnameFromRelativeDestination(destination))) {
    const relative = new URL(destination, getDashboardOrigin());
    return buildDashboardUrl(relative.pathname, sanitizeClerkRedirectParams(relative.searchParams));
  }

  return destination;
}

export function rescueUnexpectedClerkTaskUrl() {
  if (!isChooseOrganizationTaskDestination(window.location.href)) return;

  const rescuedUrl = buildChooseOrganizationTaskUrl(new URLSearchParams(window.location.search));
  if (rescuedUrl !== window.location.href) {
    window.location.replace(rescuedUrl);
  }
}

export function rescueUnexpectedDashboardPathUrl() {
  if (!isDashboardOrigin(window.location.origin) || !isHashRoutedPath(window.location.pathname)) {
    return;
  }

  if (window.location.pathname === "/" && window.location.hash.startsWith("#/")) {
    const rescuedUrl = sanitizeDashboardUrl(window.location.href);
    if (rescuedUrl !== window.location.href) {
      window.history.replaceState(null, "", rescuedUrl);
    }
    return;
  }

  const hashRoute = window.location.pathname;
  const rescuedUrl = buildDashboardUrl(
    hashRoute,
    sanitizeClerkRedirectParams(new URLSearchParams(window.location.search)),
  );
  if (rescuedUrl !== window.location.href) {
    window.location.replace(rescuedUrl);
  }
}

export function getSanitizedSignedOutAuthUrl() {
  const hashRoute = getHashRouteFromUrl(new URL(window.location.href));
  if (hashRoute !== "/sign-in" && hashRoute !== "/sign-up") return "";

  const queryStart = window.location.hash.indexOf("?");
  if (queryStart === -1) return "";

  return buildDashboardUrl(hashRoute, sanitizeClerkRedirectParams(getHashSearchParams()));
}

export function isChooseOrganizationTaskDestination(destination: string) {
  const parsed = parseDestination(destination);
  if (!parsed) {
    return /^\/?tasks\/choose-organization(?:[/?#]|$)/.test(destination);
  }

  const path = parsed.pathname.replace(/^\/+/, "");
  return (
    parsed.hostname === "tasks" ||
    path === "tasks/choose-organization" ||
    path === "sign-up/tasks/choose-organization" ||
    parsed.hash.startsWith("#/sign-up/tasks/choose-organization")
  );
}

function normalizeOrigin(value: string) {
  try {
    const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    return new URL(withProtocol).origin;
  } catch {
    return "";
  }
}

function normalizeHashRoute(route: string) {
  const withoutHash = route.startsWith("#") ? route.slice(1) : route;
  return withoutHash.startsWith("/") ? withoutHash : `/${withoutHash}`;
}

function applySearchParams(url: URL, search?: SearchInput) {
  if (!search) return;

  const params = search instanceof URLSearchParams ? search : new URLSearchParams();
  if (!(search instanceof URLSearchParams)) {
    for (const [key, value] of Object.entries(search)) {
      if (value) params.set(key, value);
    }
  }

  params.forEach((value, key) => {
    if (value) url.searchParams.set(key, value);
  });
}

function sanitizeDashboardUrl(value: string) {
  const parsed = parseDestination(value);
  if (!parsed) return value;

  const hashRoute = getHashRouteFromUrl(parsed);
  if (!hashRoute) return value;

  return buildDashboardUrl(hashRoute, sanitizeClerkRedirectParams(parsed.searchParams));
}

function sanitizeClerkRedirectParams(params: URLSearchParams) {
  const sanitized = new URLSearchParams(params);

  for (const name of CLERK_REDIRECT_PARAM_NAMES) {
    const value = sanitized.get(name);
    if (!value) continue;
    sanitized.set(name, normalizeNestedClerkRedirectUrl(value));
  }

  return sanitized;
}

function normalizeNestedClerkRedirectUrl(value: string) {
  const parsed = parseDestination(value);
  if (!parsed) return value;

  const hashRoute = getHashRouteFromUrl(parsed);
  if (hashRoute) {
    return buildDashboardUrl(hashRoute, sanitizeClerkRedirectParams(parsed.searchParams));
  }

  if (isDashboardOrigin(parsed.origin) && isHashRoutedPath(parsed.pathname)) {
    return buildDashboardUrl(parsed.pathname, sanitizeClerkRedirectParams(parsed.searchParams));
  }

  return value;
}

function getHashRouteFromUrl(url: URL) {
  if (!url.hash.startsWith("#/")) return "";
  const routeWithQuery = url.hash.slice(1);
  const queryStart = routeWithQuery.indexOf("?");
  const route = queryStart === -1 ? routeWithQuery : routeWithQuery.slice(0, queryStart);
  return normalizeHashRoute(route);
}

function getHashSearchParams() {
  const queryStart = window.location.hash.indexOf("?");
  if (queryStart === -1) return new URLSearchParams();
  return new URLSearchParams(window.location.hash.slice(queryStart + 1));
}

function isHashRoutedPath(pathname: string) {
  if (HASH_ROUTED_PATHS.has(pathname)) return true;
  return pathname.startsWith("/instances/");
}

function getPathnameFromRelativeDestination(destination: string) {
  try {
    return new URL(destination, getDashboardOrigin()).pathname;
  } catch {
    return "";
  }
}

function getDestinationSearchParams(destination: string) {
  const parsed = parseDestination(destination);
  if (parsed) return parsed.searchParams;

  const queryStart = destination.indexOf("?");
  if (queryStart === -1) return new URLSearchParams();
  const hashStart = destination.indexOf("#", queryStart);
  const query = destination.slice(queryStart + 1, hashStart === -1 ? undefined : hashStart);
  return new URLSearchParams(query);
}

function parseDestination(destination: string) {
  try {
    return new URL(destination, getDashboardOrigin());
  } catch {
    return null;
  }
}

function isDashboardOrigin(origin: string) {
  return origin === getDashboardOrigin() || (isLocalHost(window.location.hostname) && origin === window.location.origin);
}

function isLocalHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}
