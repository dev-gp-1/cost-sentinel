/**
 * casper-proxy
 *
 * Production-ready Cloudflare Worker reverse proxy for the ShadowForge Cost Sentinel
 * Vue.js SPA deployed on Google Cloud Run.
 *
 * Features:
 * - Full request/response passthrough (method, headers, body, cookies, auth)
 * - Proper URL rewriting + X-Forwarded-* headers
 * - Redirect (3xx) Location header rewriting (critical for correct operation)
 * - SPA routing handled transparently by Cloud Run's nginx
 * - Cloudflare Access JWT validation stub (auth is primarily enforced via Access policy)
 * - Commented production-grade CORS handler (enable only if you expose cross-origin APIs)
 * - Hop-by-hop header cleanup
 * - Robust error handling and logging
 *
 * Deployment:
 *   cd cloudflare-worker
 *   npm install
 *   npx wrangler login
 *   # Set real backend (recommended):
 *   npx wrangler secret put BACKEND_URL
 *   npx wrangler deploy
 *
 * Then attach Cloudflare Access (Zero Trust) to the route or custom domain.
 */

export interface Env {
  // Set via wrangler.toml [vars] or `wrangler secret put BACKEND_URL`
  BACKEND_URL: string;
}

// Hop-by-hop headers that MUST NOT be forwarded per RFC 2616 / modern proxies
const HOP_BY_HOP_HEADERS = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
];

/**
 * Remove hop-by-hop headers + normalize for proxying.
 */
function sanitizeHeaders(headers: Headers, targetHost: string, isRequest: boolean): Headers {
  const sanitized = new Headers(headers);

  // Capture the original public hostname BEFORE we rewrite it
  const originalHost = sanitized.get('host') || sanitized.get('x-forwarded-host') || '';

  // Remove all hop-by-hop headers (case-insensitive match)
  for (const header of HOP_BY_HOP_HEADERS) {
    sanitized.delete(header);
  }

  // Always rewrite Host for the backend
  sanitized.set('host', targetHost);

  if (isRequest) {
    // Cloudflare provides these; forward them cleanly
    const cfConnectingIp = sanitized.get('cf-connecting-ip');
    const existingForwardedFor = sanitized.get('x-forwarded-for');

    if (cfConnectingIp) {
      const forwardedFor = existingForwardedFor
        ? `${existingForwardedFor}, ${cfConnectingIp}`
        : cfConnectingIp;
      sanitized.set('x-forwarded-for', forwardedFor);
    }

    // Preserve original public hostname for the backend (very useful for logging / Access)
    sanitized.set('x-forwarded-host', originalHost || targetHost);
    sanitized.set('x-forwarded-proto', sanitized.get('x-forwarded-proto') || 'https');
  }

  return sanitized;
}

/**
 * Rewrite redirect Location headers that point at the internal Cloud Run backend
 * so the browser follows them against the public Worker hostname.
 */
function rewriteRedirectLocation(
  response: Response,
  originalUrl: URL,
  backendUrl: URL
): Response {
  const location = response.headers.get('location');
  if (!location || (response.status < 300 || response.status >= 400)) {
    return response;
  }

  try {
    // Resolve relative redirects against the backend
    const redirectUrl = new URL(location, backendUrl);

    // Only rewrite if the redirect targets the backend origin
    if (redirectUrl.hostname === backendUrl.hostname) {
      redirectUrl.protocol = originalUrl.protocol;
      redirectUrl.hostname = originalUrl.hostname;
      redirectUrl.port = originalUrl.port;

      const newHeaders = new Headers(response.headers);
      newHeaders.set('location', redirectUrl.toString());

      // Clean hop-by-hop from response too
      for (const h of HOP_BY_HOP_HEADERS) {
        newHeaders.delete(h);
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });
    }
  } catch (err) {
    console.warn('Failed to rewrite redirect Location:', err);
  }

  return response;
}

/**
 * OPTIONAL: Simple CORS handler (commented out by default).
 *
 * Enable this ONLY if you ever need to allow cross-origin requests directly to the Worker
 * (e.g. if you later expose a public API from the same Worker or add a hosted connector).
 *
 * For the current architecture (SPA served from the same origin + local connector on localhost),
 * CORS is unnecessary and should remain disabled.
 */
// function handleCORS(request: Request): Response | null {
//   const origin = request.headers.get('Origin');
//
//   // Example: restrict to your production domains only
//   const allowedOrigins = [
//     'https://casper.ghostprotocol.us',
//     'https://casper-staging.ghostprotocol.us',
//   ];
//
//   if (request.method === 'OPTIONS') {
//     // Preflight
//     if (origin && allowedOrigins.includes(origin)) {
//       return new Response(null, {
//         status: 204,
//         headers: {
//           'Access-Control-Allow-Origin': origin,
//           'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
//           'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
//           'Access-Control-Max-Age': '86400',
//           'Access-Control-Allow-Credentials': 'true',
//         },
//       });
//     }
//     return new Response(null, { status: 204 });
//   }
//
//   return null; // Continue to proxy
// }

/**
 * Cloudflare Access JWT Validation STUB
 *
 * When you protect this Worker (or its route) with a Cloudflare Access Application
 * in Zero Trust, Cloudflare performs JWT validation at the edge BEFORE the request
 * reaches your Worker. You will receive a validated Cf-Access-Jwt-Assertion header.
 *
 * You normally do NOT need to validate inside the Worker.
 *
 * This stub is provided for advanced use cases (e.g. extracting user identity,
 * logging who accessed the tool, or adding application-level checks).
 *
 * To fully implement validation here you would need:
 *   - The Access application's Audience (AUD) tag
 *   - Fetch Cloudflare's JWKS and use a JWT library (jose, etc.)
 *
 * For most deployments, leave this commented and rely on the Access policy.
 */
// async function validateAccessJWT(request: Request, env: Env): Promise<boolean> {
//   const jwt = request.headers.get('Cf-Access-Jwt-Assertion');
//   if (!jwt) {
//     console.log('No Cf-Access-Jwt-Assertion header present');
//     return false;
//   }
//
//   // Example: log identity (email) for audit
//   // const payload = decodeJwt(jwt); // lightweight decode only
//   // console.log('Access identity:', payload?.email);
//
//   // In production with full validation:
//   // const { payload } = await jwtVerify(jwt, getAccessPublicKey(env), { audience: '...' });
//   return true;
// }

/**
 * Main Worker fetch handler — transparent reverse proxy.
 */
export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    // === 1. (OPTIONAL) CORS preflight short-circuit ===
    // const corsResponse = handleCORS(request);
    // if (corsResponse) return corsResponse;

    // === 2. (OPTIONAL) Access JWT check inside Worker ===
    // Uncomment the block below ONLY if you want defense-in-depth beyond the Access policy.
    // if (!(await validateAccessJWT(request, env))) {
    //   return new Response('Unauthorized — Cloudflare Access required', {
    //     status: 403,
    //     headers: { 'Content-Type': 'text/plain' },
    //   });
    // }

    // === 3. Validate backend configuration ===
    if (!env.BACKEND_URL) {
      return new Response(
        'Worker misconfigured: BACKEND_URL environment variable is not set.\n' +
          'Run: wrangler secret put BACKEND_URL\n',
        { status: 500, headers: { 'Content-Type': 'text/plain' } }
      );
    }

    let backendOrigin: URL;
    try {
      backendOrigin = new URL(env.BACKEND_URL);
      // Ensure no trailing slash on origin for clean path joining
      if (backendOrigin.pathname !== '/') {
        backendOrigin.pathname = backendOrigin.pathname.replace(/\/$/, '');
      }
    } catch (err) {
      return new Response(`Invalid BACKEND_URL: ${env.BACKEND_URL}`, {
        status: 500,
      });
    }

    // === 4. Build backend URL (preserve full path + query string) ===
    const backendUrl = new URL(backendOrigin.toString());
    backendUrl.pathname =
      (backendOrigin.pathname === '/' ? '' : backendOrigin.pathname) + url.pathname;
    backendUrl.search = url.search;
    backendUrl.hash = ''; // never forward fragment

    // === 5. Prepare sanitized request headers ===
    const sanitizedHeaders = sanitizeHeaders(
      request.headers,
      backendOrigin.host,
      true
    );

    // === 6. Construct backend request (preserve body stream for all methods) ===
    const backendRequest = new Request(backendUrl.toString(), {
      method: request.method,
      headers: sanitizedHeaders,
      body: request.body, // ReadableStream — passed through efficiently
      redirect: 'manual', // We handle redirects ourselves for correct Location rewriting
      // You can add Cloudflare-specific options here:
      // cf: { cacheEverything: false, cacheTtl: 0 } for HTML, etc.
    });

    // === 7. Execute proxy fetch ===
    let response: Response;
    try {
      response = await fetch(backendRequest);

      // Log basic info (visible in `wrangler tail` and dashboard logs)
      console.log(
        `${request.method} ${url.pathname}${url.search} -> ${backendUrl.pathname}${backendUrl.search} [${response.status}]`
      );
    } catch (err: any) {
      console.error('Proxy fetch error:', err);
      return new Response(
        `Upstream error connecting to Cost Sentinel backend.\n\n` +
          `Backend: ${env.BACKEND_URL}\n` +
          `Error: ${err?.message || err}`,
        {
          status: 502,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        }
      );
    }

    // === 8. Rewrite redirects (critical for SPA + any server-side redirects) ===
    response = rewriteRedirectLocation(response, url, backendOrigin);

    // === 9. Sanitize response headers (remove hop-by-hop) ===
    const responseHeaders = new Headers(response.headers);
    for (const h of HOP_BY_HOP_HEADERS) {
      responseHeaders.delete(h);
    }

    // Optional: Add/override security headers at the edge (Cloudflare also adds many)
    // responseHeaders.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    // responseHeaders.set('X-Frame-Options', 'SAMEORIGIN'); // already set by nginx

    // === 10. Return the proxied response (body streamed) ===
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  },
};
