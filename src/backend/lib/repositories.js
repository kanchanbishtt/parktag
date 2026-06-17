import { getMongoDb } from "./mongo.js";

function withPrefix(prefix, name) {
  return `${prefix}${name}`;
}

export async function getCollections(env) {
  const db = await getMongoDb(env);

  if (!db) {
    return null;
  }

  const prefix = env.mongoCollectionPrefix || "";

  return {
    admins: db.collection(withPrefix(prefix, "admins")),
    owners: db.collection(withPrefix(prefix, "owners")),
    tags: db.collection(withPrefix(prefix, "tags")),
    contactRequests: db.collection(withPrefix(prefix, "contact_requests")),
    passwordResetTokens: db.collection(withPrefix(prefix, "password_reset_tokens"))
  };
}
