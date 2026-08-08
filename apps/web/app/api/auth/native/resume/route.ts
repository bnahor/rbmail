import { nativeAuthError } from "@/lib/server/auth";

export const runtime = "nodejs";

const providers = new Set(["google", "microsoft"]);

function document(token: string, provider: string, direct: boolean) {
  const encodedToken = JSON.stringify(token).replaceAll("<", "\\u003c");
  const next = JSON.stringify(
    direct
      ? `/api/oauth/${provider}/start?native=1`
      : `/api/composio/connect/${provider}?native=1`,
  ).replaceAll("<", "\\u003c");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Continuing to Rubidium</title></head><body>
<p>Continuing securely to your email provider…</p>
<script>
(async () => {
  const response = await fetch('/api/auth/one-time-token/verify', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({token: ${encodedToken}}),
    credentials: 'include'
  });
  if (!response.ok) throw new Error('Rubidium session handoff failed.');
  location.replace(${next});
})().catch(error => {
  location.replace('rubidium://auth/error?message=' + encodeURIComponent(error.message));
});
</script></body></html>`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || "";
  const provider = url.searchParams.get("provider") || "";
  if (!token || !providers.has(provider)) {
    return nativeAuthError("The Rubidium session handoff is invalid.");
  }
  const direct =
    provider === "google"
      ? Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
      : Boolean(
          process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET,
        );
  return new Response(document(token, provider, direct), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; connect-src 'self'",
    },
  });
}
