import express from "express";
import cors from "cors";
import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";

import { connectToDatabase } from "./config/db.js";
import authRoutes from "./routes/auth.js";
import customerRoutes from "./routes/customers.js";
import productRoutes from "./routes/products.js";
import ordersRoutes from "./routes/orders.js";
import uploadsRouter from "./routes/uploads.js";
import aiRouter from "./routes/ai.js";

const app = express();
const PORT = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.use("/api/auth", authRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/products", productRoutes);
app.use("/api/orders", ordersRoutes);
app.use("/api/uploads", uploadsRouter);
app.use("/api/ai", aiRouter);

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
