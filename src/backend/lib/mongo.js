import { MongoClient } from "mongodb";

let clientPromise = null;

function createClient(env) {
  return new MongoClient(env.mongoUri, {
    serverSelectionTimeoutMS: 5000
  });
}

export async function getMongoDb(env) {
  if (!env.mongoUri) {
    return null;
  }

  if (!clientPromise) {
    const client = createClient(env);
    clientPromise = client.connect();
  }

  const client = await clientPromise;
  return client.db(env.mongoDbName);
}

export async function getMongoStatus(env) {
  if (!env.mongoUri) {
    return {
      configured: false,
      connected: false
    };
  }

  try {
    const db = await getMongoDb(env);
    await db.command({ ping: 1 });

    return {
      configured: true,
      connected: true,
      database: env.mongoDbName
    };
  } catch (error) {
    return {
      configured: true,
      connected: false,
      database: env.mongoDbName,
      error: error instanceof Error ? error.message : "Unknown MongoDB error"
    };
  }
}

export async function closeMongoConnection() {
  if (!clientPromise) {
    return;
  }

  const client = await clientPromise;
  clientPromise = null;
  await client.close();
}
