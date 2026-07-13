import { MongoClient, ServerApiVersion } from "mongodb";
import { getMongoConfig, validateRequiredEnv } from "@/lib/config";

let client;
let clientPromise;

export function getMongoClient() {
  if (clientPromise) {
    return clientPromise;
  }

  validateRequiredEnv();
  const { uri, authSource } = getMongoConfig();

  client = new MongoClient(uri, {
    ...(authSource ? { authSource } : {}),
    serverApi: {
      version: ServerApiVersion.v1,
      strict: false,
      deprecationErrors: true
    }
  });

  clientPromise = client.connect().catch((error) => {
    clientPromise = undefined;
    client = undefined;
    throw error;
  });
  return clientPromise;
}

export async function getDb() {
  const { dbName } = getMongoConfig();
  const mongoClient = await getMongoClient();
  return mongoClient.db(dbName);
}

export async function getCollection(name) {
  const db = await getDb();
  return db.collection(name);
}
