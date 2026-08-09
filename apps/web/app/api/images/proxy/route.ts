import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

import { requireUser, unauthorized } from "@/lib/server/auth";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

function isPrivateHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (isIP(host) === 4) {
    const [a, b] = host.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (isIP(host) === 6) {
    return host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80");
  }
  return false;
}

export async function GET(request: Request) {
  const user = await requireUser(request);
  if (!user) return unauthorized();
  const input = new URL(request.url).searchParams.get("url");
  let remote: URL;
  try {
    remote = new URL(input || "");
  } catch {
    return Response.json({ error: "Invalid image URL." }, { status: 400 });
  }
  if (remote.protocol !== "https:" || isPrivateHost(remote.hostname) || remote.username || remote.password) {
    return Response.json({ error: "Image URL is not allowed." }, { status: 400 });
  }
  try {
    const addresses = await lookup(remote.hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(({ address }) => isPrivateHost(address))) {
      return Response.json({ error: "Image host is not allowed." }, { status: 400 });
    }
    const response = await fetch(remote, {
      redirect: "error",
      headers: {
        accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8",
        "user-agent": "Rubidium-Image-Proxy/1.0",
      },
      signal: AbortSignal.timeout(15_000),
    });
    const mimeType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() || "";
    const declared = Number(response.headers.get("content-length") || 0);
    if (!response.ok || !mimeType.startsWith("image/") || declared > MAX_IMAGE_BYTES) {
      return Response.json({ error: "Remote image was rejected." }, { status: 415 });
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_IMAGE_BYTES) {
      return Response.json({ error: "Remote image is too large." }, { status: 413 });
    }
    const url = new URL(request.url);
    if (url.searchParams.get("encoding") === "base64") {
      return Response.json({ contentBase64: bytes.toString("base64"), mimeType, size: bytes.length });
    }
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": mimeType,
        "content-length": String(bytes.length),
        "cache-control": "private, max-age=86400",
        "content-security-policy": "default-src 'none'; sandbox",
        "cross-origin-resource-policy": "same-origin",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: "Remote image could not be loaded privately." }, { status: 502 });
  }
}
