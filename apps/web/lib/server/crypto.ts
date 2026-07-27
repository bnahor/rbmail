import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const VERSION = 1;
let cachedKey: Buffer | null = null;

function dataDirectory() {
  return path.resolve(
    process.env.RBMAIL_DATA_DIR ?? path.join(process.cwd(), "data"),
  );
}

export function getMasterKey(): Buffer {
  if (cachedKey) return cachedKey;

  const configured = process.env.RBMAIL_MASTER_KEY?.trim();
  if (configured) {
    const decoded = Buffer.from(configured, "base64");
    if (decoded.length !== 32) {
      throw new Error("RBMAIL_MASTER_KEY must be a base64-encoded 32-byte key.");
    }
    cachedKey = decoded;
    return cachedKey;
  }

  const directory = dataDirectory();
  const keyPath = path.join(directory, "master.key");
  mkdirSync(directory, { recursive: true, mode: 0o700 });

  if (existsSync(keyPath)) {
    const decoded = Buffer.from(readFileSync(keyPath, "utf8").trim(), "base64");
    if (decoded.length !== 32) {
      throw new Error(`Invalid local encryption key at ${keyPath}.`);
    }
    cachedKey = decoded;
    return cachedKey;
  }

  const generated = randomBytes(32);
  writeFileSync(keyPath, generated.toString("base64"), {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  chmodSync(keyPath, 0o600);
  cachedKey = generated;
  return cachedKey;
}

export function encryptString(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getMasterKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    VERSION.toString(),
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptString(envelope: string): string {
  const [version, iv, tag, encrypted] = envelope.split(".");
  if (Number(version) !== VERSION || !iv || !tag || encrypted === undefined) {
    throw new Error("Unsupported encrypted value.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getMasterKey(),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function encryptJson(value: unknown): string {
  return encryptString(JSON.stringify(value));
}

export function decryptJson<T>(value: string): T {
  return JSON.parse(decryptString(value)) as T;
}
