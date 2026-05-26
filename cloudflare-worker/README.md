# casper-proxy

**Production Cloudflare Worker reverse proxy** for the ShadowForge Cost Sentinel Vue.js application deployed on Google Cloud Run.

This Worker sits in front of your Cloud Run service and enables:

- Custom domain on Cloudflare (e.g. `casper.ghostprotocol.us`)
- **Cloudflare Access / Zero Trust** authentication (SSO, email allowlists, device posture, etc.)
- Global CDN + DDoS protection from Cloudflare
- Clean separation of concerns (auth at the edge, app on Cloud Run)

The Worker is a **transparent, high-fidelity reverse proxy** — every header, cookie, method, body, and query parameter is preserved.

---

## Directory Layout

```
cloudflare-worker/
├── src/
│   └── index.ts          # The Worker (TypeScript)
├── wrangler.toml         # Configuration + BACKEND_URL
├── package.json
├── tsconfig.json
└── README.md             # You are here
```

---

## Prerequisites

- A Cloudflare account with a zone (recommended: `ghostprotocol.us` or similar)
- Wrangler CLI (installed via npm)
- The Cost Sentinel service already deployed on Cloud Run

---

## Quick Start

### 1. Install dependencies

```bash
cd cloudflare-worker
npm install
```

### 2. Configure the backend URL

**Option A (easiest for development):**

Edit `wrangler.toml` and replace the placeholder:

```toml
[vars]
BACKEND_URL = "https://cost-sentinel-xxxxx-uc.a.run.app"
```

**Option B (recommended for production):**

Use a secret so the URL is never committed to git:

```bash
npx wrangler secret put BACKEND_URL
# Paste your real Cloud Run URL when prompted
```

You can still keep the placeholder in `wrangler.toml` — secrets override vars.

### 3. Local testing

```bash
npm run dev
```

Visit the local URL shown by wrangler. All traffic will be proxied to your Cloud Run backend.

### 4. Deploy

```bash
npm run deploy
# or
npx wrangler deploy
```

After the first successful deploy you will get a `*.workers.dev` URL for testing.

---

## Connecting Your Custom Domain

### Recommended: Custom Domains (simplest)

1. In the Cloudflare dashboard → Workers & Pages → your `casper-proxy` Worker
2. Go to **Triggers** → **Custom Domains**
3. Click **Add Custom Domain**
4. Enter `casper.ghostprotocol.us` (or your chosen subdomain)
5. Cloudflare will automatically:
   - Create the necessary DNS record (CNAME)
   - Issue a certificate
   - Route all traffic for that hostname through the Worker

### Alternative: Routes (advanced)

Uncomment the `[[routes]]` block in `wrangler.toml` and redeploy. Requires your zone to be active on Cloudflare.

---

## Securing with Cloudflare Access (Zero Trust)

This is the **primary reason** to use this Worker.

### Steps

1. Go to **Cloudflare Zero Trust** → **Access** → **Applications**
2. Create a new **Self-hosted** application
3. Set the **Application URL** to your custom domain:
   - `https://casper.ghostprotocol.us`
4. Add your identity providers (Google Workspace, GitHub, email, etc.)
5. Create an Access Policy:
   - Allow specific emails, groups, or everyone in the domain
   - (Optional) Add device posture checks
6. Save

Once the policy is active, **every request** to the Worker must present a valid Cloudflare Access JWT. Unauthenticated users see the Access login page.

The Worker receives the validated JWT in the `Cf-Access-Jwt-Assertion` header (see source for stub).

---

## Architecture Notes

- **SPA Routing**: Fully handled by the nginx configuration inside the Cloud Run container (`try_files $uri $uri/ /index.html`). The Worker does zero special routing.
- **Static Assets**: Served by Cloud Run + aggressively cached by Cloudflare edge (via normal caching behavior + any Cache Rules you create).
- **Local Connector**: Users of the app still run `./start-gcloud-connector.sh` locally on their machine. The browser talks directly to `localhost:8787`. Nothing changes.
- **Redirects**: The Worker intelligently rewrites `Location` headers on 3xx responses so that any redirects (trailing slashes, http→https, etc.) point back at the public hostname.
- **Headers**: All headers including `Authorization`, cookies, custom headers, and `CF-Connecting-IP` are preserved and properly forwarded.

---

## Environment Variables

| Variable       | Source                  | Required | Notes |
|----------------|-------------------------|----------|-------|
| `BACKEND_URL`  | `[vars]` or secret      | Yes      | Full Cloud Run URL including `https://` |
| (future)       | Add more via wrangler   | -        | e.g. `ALLOWED_ORIGINS` if you enable CORS |

---

## Production Hardening Recommendations

1. **Always use Cloudflare Access** on the production route.
2. Use `wrangler secret put` for `BACKEND_URL`.
3. Create a **Cache Rule** in Cloudflare for `*.js`, `*.css`, `*.svg`, images with long TTL (the nginx already sets `Cache-Control: immutable` for many assets).
4. Enable **Logpush** for the Worker to your SIEM or R2 for audit logs (especially useful with Access identities).
5. Consider adding a **Rate Limiting Rule** at the zone level for the hostname.
6. (Advanced) Uncomment the Access JWT validation stub inside `src/index.ts` if you want to log user emails or perform extra checks.

---

## Useful Commands

```bash
# Development with live reload
npm run dev

# Deploy to production
npm run deploy

# Stream live logs
npm run tail
# or
npx wrangler tail

# Generate latest TypeScript types from your wrangler.toml
npm run cf-typegen

# Delete the Worker completely
npx wrangler delete
```

---

## Updating After Cloud Run Redeploys

Cloud Run URLs are stable **only if you use a custom domain on Cloud Run** or pin to a specific revision.

Most teams use the generated `*.a.run.app` URL. When you redeploy the Cloud Run service you usually get a **new URL**.

**Process:**

1. Get the new URL:
   ```bash
   gcloud run services describe cost-sentinel --region=us-central1 --format='value(status.url)'
   ```
2. Update the secret:
   ```bash
   cd cloudflare-worker
   npx wrangler secret put BACKEND_URL
   ```
3. Redeploy the Worker:
   ```bash
   npm run deploy
   ```

If you map a custom domain directly on the Cloud Run service, you can use that stable URL instead and avoid frequent updates.

---

## Troubleshooting

**502 Bad Gateway**

- `BACKEND_URL` is wrong or the Cloud Run service is not allowing unauthenticated traffic from the Worker's egress IPs.
- Fix: Make sure Cloud Run allows **allUsers** or add the Worker's service account (advanced).

**Redirect loops**

- Usually caused by missing redirect rewriting. This Worker includes robust `Location` rewriting — if you see loops, check that your `BACKEND_URL` exactly matches the hostname the Cloud Run container sees.

**Access login page not showing**

- The policy is not attached to the exact hostname, or you are testing on the workers.dev URL instead of the custom domain.

**CORS errors in browser**

- Not expected in normal operation. The app is served from the same origin. If you see them, you have enabled the commented CORS handler incorrectly or you are making cross-origin calls to `localhost:8787` from a production domain (expected — that's the local connector flow).

---

## License & Attribution

Part of the ShadowForge / Ghost Protocol Cost Sentinel toolkit.

Built for sovereign, high-security deployments.
