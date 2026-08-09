import type { MailAddress } from "@/lib/mail/types";
import sanitizeHtml from "sanitize-html";

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

export function decodeBase64Url(
  value: string | undefined,
  charset = "utf-8",
): string {
  if (!value) return "";
  const bytes = Buffer.from(
    value.replace(/-/g, "+").replace(/_/g, "/"),
    "base64",
  );
  const label = charset.trim().replace(/^['"]|['"]$/g, "") || "utf-8";
  try {
    return new TextDecoder(label, { fatal: false }).decode(bytes);
  } catch {
    return bytes.toString("utf8");
  }
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
  return value
    .split(/,(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/)
    .map((entry) => parseAddress(entry.trim()))
    .filter((entry) => entry.address);
}

export function normalizeContentId(value: string | undefined): string | null {
  const normalized = value?.trim().replace(/^<|>$/g, "").toLowerCase();
  return normalized || null;
}

export function safeMailHeader(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export function sanitizeEmailHtml(
  html: string,
  options: { allowRemoteImages?: boolean } = {},
): string {
  return sanitizeHtml(html, {
    allowedTags: [
      "a", "abbr", "address", "article", "aside", "b", "blockquote", "br",
      "caption", "center", "cite", "code", "col", "colgroup", "dd", "del",
      "details", "div", "dl", "dt", "em", "figcaption", "figure", "font",
      "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "i",
      "img", "ins", "kbd", "li", "main", "mark", "ol", "p", "pre", "q",
      "s", "section", "small", "span", "strike", "strong", "sub", "summary",
      "sup", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "tt",
      "u", "ul",
    ],
    allowedAttributes: {
      "*": ["class", "dir", "lang", "style", "title"],
      a: ["href", "name", "target", "rel"],
      img: [
        "src", "alt", "width", "height", "title", "data-remote-src",
        "data-content-id",
      ],
      table: ["border", "cellpadding", "cellspacing", "width", "align"],
      td: ["colspan", "rowspan", "width", "height", "align", "valign"],
      th: ["colspan", "rowspan", "width", "height", "align", "valign"],
      col: ["span", "width"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel", "cid", "data"],
    allowedSchemesByTag: {
      a: ["http", "https", "mailto", "tel"],
      img: ["http", "https", "cid", "data"],
    },
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    allowedStyles: {
      "*": {
        color: [/^(?:#[0-9a-f]{3,8}|rgba?\([\d\s,.%]+\)|[a-z]{1,24})$/i],
        "background-color": [/^(?:#[0-9a-f]{3,8}|rgba?\([\d\s,.%]+\)|[a-z]{1,24}|transparent)$/i],
        "font-family": [/^[\w\s,'"-]{1,120}$/],
        "font-size": [/^\d{1,3}(?:\.\d+)?(?:px|pt|em|rem|%)$/i],
        "font-style": [/^(?:normal|italic|oblique)$/i],
        "font-weight": [/^(?:normal|bold|bolder|lighter|[1-9]00)$/i],
        "line-height": [/^(?:normal|\d{1,3}(?:\.\d+)?(?:px|pt|em|rem|%)?)$/i],
        "text-align": [/^(?:start|end|left|right|center|justify)$/i],
        "text-decoration": [/^(?:none|underline|line-through)(?:\s+(?:solid|double|dotted|dashed|wavy))?$/i],
        "white-space": [/^(?:normal|pre|pre-wrap|pre-line|nowrap)$/i],
      },
    },
    transformTags: {
      a: (_tagName, attributes) => ({
        tagName: "a",
        attribs: {
          ...attributes,
          target: "_blank",
          rel: "noopener noreferrer nofollow",
        },
      }),
      img: (_tagName, attributes) => {
        const source = attributes.src?.trim() || "";
        if (/^cid:/i.test(source)) {
          return {
            tagName: "img",
            attribs: {
              ...attributes,
              src: source,
              "data-content-id": normalizeContentId(source.slice(4)) || "",
            },
          };
        }
        if (/^https?:\/\//i.test(source) && !options.allowRemoteImages) {
          const { src: _src, ...rest } = attributes;
          return {
            tagName: "img",
            attribs: { ...rest, "data-remote-src": source },
          };
        }
        return { tagName: "img", attribs: attributes };
      },
    },
  });
}
