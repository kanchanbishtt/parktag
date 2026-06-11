import crypto from "node:crypto";

export function createPasswordHash(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

export function verifyPassword(password, hash) {
  return createPasswordHash(password) === hash;
}

export function createToken(length = 12) {
  return crypto.randomBytes(length).toString("hex").slice(0, length);
}
