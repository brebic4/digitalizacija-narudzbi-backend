import express from "express";
import bcrypt from "bcrypt";
import { ObjectId } from "mongodb";

import { getDatabase } from "../config/db.js";
import auth from "../middleware/auth.js";
import adminOnly from "../middleware/adminOnly.js";

const router = express.Router();

router.use(auth);
router.use(adminOnly);

const USER_ROLES = ["ADMIN", "EMPLOYEE"];

// GET /api/users
// Dohvaćanje zaposlenika
router.get("/", async (req, res) => {
  try {
    const db = getDatabase();

    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);

    const limit = Math.min(
      Math.max(Number.parseInt(req.query.limit, 10) || 10, 1),
      100,
    );

    const search = req.query.search?.trim() || "";
    const skip = (page - 1) * limit;

    const filter = {};

    if (search) {
      const safeSearch = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      filter.$or = [
        {
          firstName: {
            $regex: safeSearch,
            $options: "i",
          },
        },
        {
          lastName: {
            $regex: safeSearch,
            $options: "i",
          },
        },
        {
          email: {
            $regex: safeSearch,
            $options: "i",
          },
        },
        {
          phone: {
            $regex: safeSearch,
            $options: "i",
          },
        },
      ];
    }

    const usersCollection = db.collection("users");

    const totalItems = await usersCollection.countDocuments(filter);

    const [totalUsers, activeUsers, adminUsers, whatsappUsers] =
      await Promise.all([
        usersCollection.countDocuments({}),
        usersCollection.countDocuments({
          active: true,
        }),
        usersCollection.countDocuments({
          role: "ADMIN",
        }),
        usersCollection.countDocuments({
          active: true,
          whatsappNotifications: true,
        }),
      ]);

    const users = await usersCollection
      .find(filter, {
        projection: {
          passwordHash: 0,
        },
      })
      .sort({
        createdAt: -1,
      })
      .skip(skip)
      .limit(limit)
      .toArray();

    return res.status(200).json({
      success: true,
      data: users,
      pagination: {
        totalItems,
        currentPage: page,
        itemsPerPage: limit,
        totalPages: Math.ceil(totalItems / limit),
      },
      statistics: {
        totalUsers,
        activeUsers,
        adminUsers,
        whatsappUsers,
      },
    });
  } catch (error) {
    console.error("Greška pri dohvaćanju zaposlenika:", error);

    return res.status(500).json({
      success: false,
      message: "Dogodila se greška pri dohvaćanju zaposlenika.",
    });
  }
});

// POST /api/users
// Admin kreira novi korisnički račun zaposlenika
router.post("/", async (req, res) => {
  try {
    const db = getDatabase();

    const {
      firstName,
      lastName,
      email,
      password,
      phone = "",
      role = "EMPLOYEE",
      active = true,
      whatsappNotifications = true,
    } = req.body ?? {};

    if (typeof firstName !== "string" || !firstName.trim()) {
      return res.status(400).json({
        success: false,
        message: "Ime je obavezno.",
      });
    }

    if (typeof lastName !== "string" || !lastName.trim()) {
      return res.status(400).json({
        success: false,
        message: "Prezime je obavezno.",
      });
    }

    if (typeof email !== "string" || !email.trim()) {
      return res.status(400).json({
        success: false,
        message: "E-mail je obavezan.",
      });
    }

    if (typeof password !== "string" || password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Lozinka mora sadržavati najmanje 8 znakova.",
      });
    }

    if (!USER_ROLES.includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Uloga korisnika nije ispravna.",
      });
    }

    if (typeof active !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "Vrijednost active mora biti true ili false.",
      });
    }

    if (typeof whatsappNotifications !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "Vrijednost whatsappNotifications mora biti true ili false.",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const usersCollection = db.collection("users");

    const existingUser = await usersCollection.findOne({
      email: normalizedEmail,
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "Korisnik s navedenim e-mailom već postoji.",
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const now = new Date();

    if (typeof phone !== "string") {
      return res.status(400).json({
        success: false,
        message: "Broj mobitela mora biti tekst.",
      });
    }

    const newUser = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: normalizedEmail,
      passwordHash,
      phone: typeof phone === "string" ? phone.trim() : "",
      role,
      active,
      whatsappNotifications,
      createdAt: now,
      updatedAt: now,
    };

    const result = await usersCollection.insertOne(newUser);

    const { passwordHash: _passwordHash, ...safeUser } = newUser;

    return res.status(201).json({
      success: true,
      message: "Zaposlenik je uspješno dodan.",
      data: {
        _id: result.insertedId,
        ...safeUser,
      },
    });
  } catch (error) {
    console.error("Greška pri dodavanju zaposlenika:", error);

    return res.status(500).json({
      success: false,
      message: "Dogodila se greška pri dodavanju zaposlenika.",
    });
  }
});

// GET /api/users/:id
// Dohvaćanje jednog zaposlenika
router.get("/:id", async (req, res) => {
  try {
    const db = getDatabase();
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "ID zaposlenika nije valjan.",
      });
    }

    const user = await db.collection("users").findOne(
      {
        _id: new ObjectId(id),
      },
      {
        projection: {
          passwordHash: 0,
        },
      },
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Zaposlenik nije pronađen.",
      });
    }

    return res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    console.error("Greška pri dohvaćanju zaposlenika:", error);

    return res.status(500).json({
      success: false,
      message: "Dogodila se greška pri dohvaćanju zaposlenika.",
    });
  }
});

// PUT /api/users/:id
// Uređivanje zaposlenika
router.put("/:id", async (req, res) => {
  try {
    const db = getDatabase();
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "ID zaposlenika nije valjan.",
      });
    }

    const {
      firstName,
      lastName,
      email,
      phone = "",
      role,
      whatsappNotifications,
      password = "",
    } = req.body ?? {};

    if (typeof firstName !== "string" || !firstName.trim()) {
      return res.status(400).json({
        success: false,
        message: "Ime je obavezno.",
      });
    }

    if (typeof lastName !== "string" || !lastName.trim()) {
      return res.status(400).json({
        success: false,
        message: "Prezime je obavezno.",
      });
    }

    if (typeof email !== "string" || !email.trim()) {
      return res.status(400).json({
        success: false,
        message: "E-mail je obavezan.",
      });
    }

    if (!USER_ROLES.includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Uloga korisnika nije ispravna.",
      });
    }

    if (typeof phone !== "string") {
      return res.status(400).json({
        success: false,
        message: "Broj mobitela mora biti tekst.",
      });
    }

    if (typeof whatsappNotifications !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "Vrijednost whatsappNotifications mora biti true ili false.",
      });
    }

    if (
      password !== "" &&
      (typeof password !== "string" || password.length < 8)
    ) {
      return res.status(400).json({
        success: false,
        message: "Nova lozinka mora sadržavati najmanje 8 znakova.",
      });
    }

    const usersCollection = db.collection("users");
    const userId = new ObjectId(id);

    const existingUser = await usersCollection.findOne({
      _id: userId,
    });

    if (!existingUser) {
      return res.status(404).json({
        success: false,
        message: "Zaposlenik nije pronađen.",
      });
    }

    const currentUserId = req.user._id.toString();

    // Admin ne smije sam sebi ukloniti administratorsku ulogu
    if (
      currentUserId === id &&
      existingUser.role === "ADMIN" &&
      role !== "ADMIN"
    ) {
      return res.status(400).json({
        success: false,
        message: "Ne možete vlastitom računu ukloniti administratorsku ulogu.",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const userWithSameEmail = await usersCollection.findOne({
      email: normalizedEmail,
      _id: {
        $ne: userId,
      },
    });

    if (userWithSameEmail) {
      return res.status(409).json({
        success: false,
        message: "Drugi korisnik već koristi navedeni e-mail.",
      });
    }

    const updatedFields = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: normalizedEmail,
      phone: phone.trim(),
      role,
      whatsappNotifications,
      updatedAt: new Date(),
    };

    // Lozinku mijenjamo samo ako je poslana
    if (password) {
      updatedFields.passwordHash = await bcrypt.hash(password, 12);
    }

    await usersCollection.updateOne(
      {
        _id: userId,
      },
      {
        $set: updatedFields,
      },
    );

    const updatedUser = await usersCollection.findOne(
      {
        _id: userId,
      },
      {
        projection: {
          passwordHash: 0,
        },
      },
    );

    return res.status(200).json({
      success: true,
      message: "Podaci o zaposleniku uspješno su ažurirani.",
      data: updatedUser,
    });
  } catch (error) {
    console.error("Greška pri uređivanju zaposlenika:", error);

    return res.status(500).json({
      success: false,
      message: "Dogodila se greška pri uređivanju zaposlenika.",
    });
  }
});

// PATCH /api/users/:id/active
// Aktiviranje ili deaktiviranje zaposlenika
router.patch("/:id/active", async (req, res) => {
  try {
    const db = getDatabase();
    const { id } = req.params;
    const { active } = req.body ?? {};

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "ID zaposlenika nije valjan.",
      });
    }

    if (typeof active !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "Vrijednost active mora biti true ili false.",
      });
    }

    const usersCollection = db.collection("users");
    const userId = new ObjectId(id);

    const user = await usersCollection.findOne({
      _id: userId,
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Zaposlenik nije pronađen.",
      });
    }

    if (req.user._id.toString() === id && active === false) {
      return res.status(400).json({
        success: false,
        message: "Ne možete deaktivirati vlastiti korisnički račun.",
      });
    }

    if (user.active === active) {
      return res.status(400).json({
        success: false,
        message: active
          ? "Zaposlenik je već aktivan."
          : "Zaposlenik je već neaktivan.",
      });
    }

    await usersCollection.updateOne(
      {
        _id: userId,
      },
      {
        $set: {
          active,
          updatedAt: new Date(),
        },
      },
    );

    const updatedUser = await usersCollection.findOne(
      {
        _id: userId,
      },
      {
        projection: {
          passwordHash: 0,
        },
      },
    );

    return res.status(200).json({
      success: true,
      message: active
        ? "Zaposlenik je uspješno aktiviran."
        : "Zaposlenik je uspješno deaktiviran.",
      data: updatedUser,
    });
  } catch (error) {
    console.error("Greška pri promjeni statusa zaposlenika:", error);

    return res.status(500).json({
      success: false,
      message: "Dogodila se greška pri promjeni statusa zaposlenika.",
    });
  }
});

export default router;
