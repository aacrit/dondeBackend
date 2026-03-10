// Allowed origins — add production domain when launched
const ALLOWED_ORIGINS = new Set([
  "https://dondeai.com",
  "https://www.dondeai.com",
  "http://localhost:3000",
  "http://localhost:5500",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5500",
]);

function getAllowedOrigin(requestOrigin?: string | null): string {
  if (requestOrigin && ALLOWED_ORIGINS.has(requestOrigin)) {
    return requestOrigin;
  }
  // During alpha: allow file:// and null origins (local dev opening index.html directly)
  if (!requestOrigin || requestOrigin === "null") {
    return "*";
  }
  return "https://dondeai.com";
}

export function buildCorsHeaders(requestOrigin?: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": getAllowedOrigin(requestOrigin),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, x-client-info, apikey",
    "Vary": "Origin",
  };
}

// Backwards-compatible static export for code that references corsHeaders directly
export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, x-client-info, apikey",
};

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
