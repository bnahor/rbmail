import type { MailAddress } from "@/lib/mail/types";

export function decodeBase64Url(value: string | undefined): string {
  if (!value) return "";
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
    "utf8",
  );
}

export function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function cleanText(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

export function parseAddress(value: string | undefined): MailAddress {
  if (!value) return { name: "Unknown", address: "" };
  const bracket = value.match(/^(.*?)\s*<([^>]+)>$/);
  if (bracket) {
    return {
      name: bracket[1].replace(/^"|"$/g, "").trim() || bracket[2],
      address: bracket[2].trim().toLowerCase(),
    };
  }
  const address = value.trim().toLowerCase();
  return { name: address.split("@")[0] || "Unknown", address };
}

export function parseAddressList(value: string | undefined): MailAddress[] {
  if (!value) return [];
  return value.split(",").map((entry) => parseAddress(entry.trim()));
}
