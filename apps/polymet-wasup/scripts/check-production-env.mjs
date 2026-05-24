import { loadEnv } from "vite";

const env = {
  ...loadEnv(process.env.MODE || "production", process.cwd(), ""),
  ...process.env,
};

const required = [
  "VITE_CLERK_PUBLISHABLE_KEY",
  "VITE_CONTROL_PLANE_API_BASE_URL",
  "VITE_WASUP_APP_URL",
];

const missing = required.filter((name) => !String(env[name] || "").trim());

if (missing.length > 0) {
  console.error(
    [
      "Production dashboard build is missing required environment variables:",
      ...missing.map((name) => `- ${name}`),
      "Set these values before running npm run build.",
    ].join("\n"),
  );
  process.exit(1);
}

const clerkKey = String(env.VITE_CLERK_PUBLISHABLE_KEY).trim();
if (!/^pk_(test|live)_/.test(clerkKey)) {
  console.error(
    "Production dashboard build has an invalid VITE_CLERK_PUBLISHABLE_KEY format.",
  );
  process.exit(1);
}

const appUrl = String(env.VITE_WASUP_APP_URL).trim();
if (!/^https?:\/\/[^/]+/i.test(appUrl)) {
  console.error(
    "Production dashboard build has an invalid VITE_WASUP_APP_URL. Use an absolute URL such as https://dev.wasup.co.",
  );
  process.exit(1);
}

