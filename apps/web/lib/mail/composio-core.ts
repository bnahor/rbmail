import type { Provider } from "./types.ts";

export function composioToolkit(provider: Provider) {
  return provider === "google" ? "gmail" : "outlook";
}

export function composioEnabled(enabled?: string, apiKey?: string) {
  return Boolean(
    enabled?.trim().toLowerCase() === "true" && apiKey?.trim(),
  );
}

export function normalizedComposioStatus(status: number) {
  return status === 401 || status === 403 ? 401 : status;
}
