import type { MailAddress } from "@/lib/mail/types";

const namedEntities: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

function decodeEntities(value: string, named = false): string {
  return value.replace(
    /&(#(?:x[0-9a-f]+|\d+)|[a-z]+);/gi,
    (entity, code: string) => {
      if (code.startsWith("#")) {
        const numeric = code[1]?.toLowerCase() === "x";
        const point = Number.parseInt(
          code.slice(numeric ? 2 : 1),
          numeric ? 16 : 10,
        );
        if (!Number.isFinite(point) || point < 0 || point > 0x10ffff) return entity;
        try {
          return String.fromCodePoint(point);
        } catch {
          return entity;
        }
      }
      return named ? (namedEntities[code.toLowerCase()] ?? entity) : entity;
    },
  );
}

export function decodeBase64Url(value: string | undefined): string {
  if (!value) return "";
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
    "utf8",
  );
}

export function stripHtml(html: string): string {
  const text = html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:zwnj|zwj);/gi, "");
  return decodeEntities(text, true)
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function cleanText(value: string): string {
  return decodeEntities(value, true)
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .replace(
      /[\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g,
      "",
    )
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
