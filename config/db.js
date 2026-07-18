import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
const databaseName = process.env.MONGODB_DB_NAME;

if (!uri) {
  throw new Error("MONGODB_URI nije definiran u .env datoteci.");
}

if (!databaseName) {
  throw new Error("MONGODB_DB_NAME nije definiran u .env datoteci.");
}

const client = new MongoClient(uri);

let database;

export async function connectToDatabase() {
  await client.connect();

  database = client.db(databaseName);

  await database.command({ ping: 1 });

  console.log(`MongoDB baza "${databaseName}" uspješno je povezana.`);

  return database;
}

export function getDatabase() {
  if (!database) {
    throw new Error("MongoDB baza još nije povezana.");
  }

  return database;
}
