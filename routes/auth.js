import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

import { getDatabase } from "../config/db.js";
import auth from "../middleware/auth.js";

const router = express.Router();

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "E-mail i lozinka su obvezni.",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const db = getDatabase();

    const user = await db.collection("users").findOne({
      email: normalizedEmail,
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Neispravni podaci za prijavu.",
      });
    }

    if (user.active === false) {
      return res.status(403).json({
        success: false,
        message: "Korisnički račun nije aktivan.",
      });
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);

    if (!passwordMatches) {
      return res.status(401).json({
        success: false,
        message: "Neispravni podaci za prijavu.",
      });
    }

    const token = jwt.sign(
      {
        userId: user._id.toString(),
        role: user.role,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: process.env.JWT_EXPIRES_IN || "8h",
      },
    );

    return res.status(200).json({
      success: true,
      message: "Prijava je uspješna.",
      token,
      user: {
        id: user._id.toString(),
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Greška prilikom prijave:", error);

    return res.status(500).json({
      success: false,
      message: "Dogodila se greška na poslužitelju.",
    });
  }
});

router.get("/me", auth, async (req, res) => {
  return res.status(200).json({
    success: true,
    user: {
      id: req.user._id.toString(),
      firstName: req.user.firstName,
      lastName: req.user.lastName,
      email: req.user.email,
      role: req.user.role,
    },
  });
});

export default router;
