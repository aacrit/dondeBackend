// Allowed origins — add production domain when launched
const ALLOWED_ORIGINS = [
  "https://dondeai.com",
  "https://www.dondeai.com",
  "https://aacrit.github.io",
  "http://localhost:3000",
  "http://localhost:5500",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5500",
];

const ALLOWED_ORIGINS_SET = new Set(ALLOWED_ORIGINS);

// Safe default origin (first in the allow list) — never return wildcard "*"
const DEFAULT_ORIGIN = ALLOWED_ORIGINS[0]; // "https://dondeai.com"

function getAllowedOrigin(requestOrigin?: string | null): string {
  if (requestOrigin && ALLOWED_ORIGINS_SET.has(requestOrigin)) {
    return requestOrigin;
  }
  // For null/missing origins (e.g. server-to-server, file://), return the safe default
  return DEFAULT_ORIGIN;
}

export function buildCorsHeaders(requestOrigin?: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": getAllowedOrigin(requestOrigin),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, x-client-info, apikey",
    "Access-Control-Expose-Headers": "X-Donde-Timing, X-API-Version, X-Engine",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  };
}

// Backwards-compatible static export — uses safe default origin (not wildcard)
export const corsHeaders: Record<string, string> = buildCorsHeaders();

export function jsonResponse(
  body: unknown,
  status = 200,
  requestOrigin?: string | null
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...buildCorsHeaders(requestOrigin), "Content-Type": "application/json" },
  });
}

export function corsPreflightResponse(requestOrigin?: string | null): Response {
  return new Response(null, { status: 204, headers: buildCorsHeaders(requestOrigin) });
}
