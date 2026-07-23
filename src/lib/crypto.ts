// AES-256-GCM encryption for storage secrets kept in the DB.
// Format stored: base64(iv).base64(authTag).base64(ciphertext)
import crypto from "crypto";
import { env } from "./env";

function key(): Buffer {
  const raw = Buffer.from(env.appEncryptionKey(), "base64");
  if (raw.length !== 32) {
    throw new Error(
      "APP_ENCRYPTION_KEY must be 32 bytes base64. Run: npm run gen:key"
    );
  }
  return raw;
}

export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(".");
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Malformed ciphertext");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key(),
    Buffer.from(ivB64, "base64")
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}
