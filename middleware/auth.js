import jwt from "jsonwebtoken";
import { ObjectId } from "mongodb";

import { getDatabase } from "../config/db.js";

const auth = async (req, res, next) => {
  try {
    const authorizationHeader = req.headers.authorization;

    if (!authorizationHeader || !authorizationHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Pristup nije dopušten. Token nije poslan.",
      });
    }

    const token = authorizationHeader.split(" ")[1];

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!ObjectId.isValid(decoded.userId)) {
      return res.status(401).json({
        success: false,
        message: "Token nije valjan.",
      });
    }

    const db = getDatabase();

    const user = await db.collection("users").findOne(
      {
        _id: new ObjectId(decoded.userId),
      },
      {
        projection: {
          passwordHash: 0,
        },
      },
    );

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Korisnik povezan s tokenom ne postoji.",
      });
    }

    if (user.active === false) {
      return res.status(403).json({
        success: false,
        message: "Korisnički račun nije aktivan.",
      });
    }

    req.user = user;

    next();
  } catch (error) {
    if (
      error.name === "JsonWebTokenError" ||
      error.name === "TokenExpiredError"
    ) {
      return res.status(401).json({
        success: false,
        message:
          error.name === "TokenExpiredError"
            ? "Token je istekao. Ponovno se prijavite."
            : "Token nije valjan.",
      });
    }

    console.error("Greška u auth middlewareu:", error);

    return res.status(500).json({
      success: false,
      message: "Dogodila se greška na poslužitelju.",
    });
  }
};

export default auth;
