import "dotenv/config";
import bcrypt from "bcrypt";

import { connectToDatabase } from "../config/db.js";

async function seedAdmin() {
  try {
    const db = await connectToDatabase();
    const usersCollection = db.collection("users");

    const adminEmail = "admin@poduzece.hr";

    const existingAdmin = await usersCollection.findOne({
      email: adminEmail,
    });

    if (existingAdmin) {
      console.log("Administrator već postoji.");
      process.exit(0);
    }

    const passwordHash = await bcrypt.hash("Admin123!", 10);

    const adminUser = {
      firstName: "Admin",
      lastName: "Korisnik",
      email: adminEmail,
      passwordHash,
      phone: null,
      role: "ADMIN",
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await usersCollection.insertOne(adminUser);

    console.log("Administrator je uspješno kreiran.");
    console.log(`ID: ${result.insertedId}`);
    console.log(`Email: ${adminEmail}`);
  } catch (error) {
    console.error("Greška pri kreiranju administratora:");
    console.error(error.message);
    process.exit(1);
  }

  process.exit(0);
}

seedAdmin();
