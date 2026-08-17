import { ObjectId } from "mongodb";

import { getCollections } from "../db/repositories.js";
import {
  verifyPassword,
  createPasswordHash,
  isNonEmptyString,
  burnPasswordComparison
} from "./security.js";
import { readSession } from "./session.js";

export async function findUserByEmail(env, role, email) {
  const collections = await getCollections(env);

  if (!collections) {
    throw new Error("MongoDB is not configured");
  }

  // `email` reaches Mongo as a raw filter value — reject anything that isn't
  // a plain string so a crafted body (e.g. `{ "$ne": null }`) can never be
  // interpreted as a query operator (NoSQL injection / auth bypass).
  if (!isNonEmptyString(email)) return null;

  const collection = role === "admin" ? collections.admins : collections.owners;
  return collection.findOne({ email });
}

export async function loginUser(env, role, email, password) {
  if (!isNonEmptyString(password)) return null;

  const collections = await getCollections(env);
  const user = await findUserByEmail(env, role, email);

  if (!user) {
    // Pay for a password comparison we have no hash for. Returning here without
    // it answered an unregistered address ~240ms faster than a registered one,
    // which enumerates accounts regardless of the responses being identical.
    await burnPasswordComparison(password);
    return null;
  }

  const { valid, needsUpgrade } = await verifyPassword(password, user.passwordHash);
  if (!valid) return null;

  // Transparently upgrade SHA-256 → bcrypt on first successful login
  if (needsUpgrade && collections) {
    const col = role === "admin" ? collections.admins : collections.owners;
    col.updateOne(
      { _id: user._id },
      { $set: { passwordHash: await createPasswordHash(password) } }
    ).catch(() => {}); // non-blocking, best-effort
  }

  return {
    id: String(user._id),
    role,
    email: user.email,
    displayName: user.displayName,
  };
}

export function requireSession(app, role) {
  return async function guarded(request, reply) {
    const session = await readSession(app, request);

    if (!session) {
      reply.code(401);
      return {
        ok: false,
        error: "Authentication required"
      };
    }

    if (role && session.role !== role) {
      reply.code(403);
      return {
        ok: false,
        error: "Forbidden"
      };
    }

    request.session = session;
    return null;
  };
}

export function toObjectId(id) {
  return new ObjectId(id);
}

// Like toObjectId but returns null instead of throwing on a malformed id. Use
// for client-supplied route params / body ids so a garbage value yields a clean
// 400 instead of an unhandled throw (HTTP 500). Trusted ids (e.g. our own
// session userId) can keep using toObjectId.
export function tryObjectId(id) {
  return ObjectId.isValid(id) ? new ObjectId(id) : null;
}
