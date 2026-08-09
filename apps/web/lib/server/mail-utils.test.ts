import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeBase64Url,
  normalizeContentId,
  safeMailHeader,
  sanitizeEmailHtml,
} from "./mail-utils.ts";

test("email sanitizer removes active and navigable content", () => {
  const value = sanitizeEmailHtml(`
    <script>alert(1)</script><form action="https://evil.test"><input autofocus></form>
    <iframe src="https://evil.test"></iframe><a href="javascript:alert(1)">bad</a>
    <p onclick="alert(1)">Safe text</p>
  `);
  assert.doesNotMatch(value, /script|iframe|form|input|onclick|javascript:/i);
  assert.match(value, /Safe text/);
});

test("email sanitizer blocks remote images but keeps cid content", () => {
  const value = sanitizeEmailHtml(`
    <img src="https://track.example/pixel.gif?user=7">
    <img src="cid:<Logo-1>">
  `);
  assert.doesNotMatch(value, /<img\s+src="https:/i);
  assert.match(value, /data-remote-src="https:\/\/track\.example/);
  assert.match(value, /src="cid:&lt;Logo-1&gt;"/);
});

test("email sanitizer can retain remote sources only after explicit consent", () => {
  const value = sanitizeEmailHtml(
    `<img src="https://images.example/photo.png" style="position:fixed;width:9999px">`,
    { allowRemoteImages: true },
  );
  assert.match(value, /src="https:\/\/images\.example\/photo\.png"/);
  assert.doesNotMatch(value, /position\s*:/i);
});

test("mail headers cannot inject a second MIME header", () => {
  assert.equal(safeMailHeader("Subject\r\nBcc: attacker@example.com"), "Subject Bcc: attacker@example.com");
  assert.equal(normalizeContentId(" <Logo-1> "), "logo-1");
});

test("Gmail body bytes honor the declared MIME character set", () => {
  const encoded = Buffer.from([0x93, 0x48, 0x69, 0x94]).toString("base64url");
  assert.equal(decodeBase64Url(encoded, "windows-1252"), "“Hi”");
});
