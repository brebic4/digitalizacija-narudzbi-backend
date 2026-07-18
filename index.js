import express from "express";
import cors from "cors";
import "dotenv/config";

import { connectToDatabase } from "./config/db.js";

const app = express();

const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Backend radi.",
  });
});

async function startServer() {
  try {
    await connectToDatabase();

    app.listen(PORT, () => {
      console.log(`Server je pokrenut na http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Pokretanje servera nije uspjelo:");
    console.error(error.message);
    process.exit(1);
  }
}

startServer();
