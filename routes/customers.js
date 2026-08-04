import express from "express";
import { ObjectId } from "mongodb";

import { getDatabase } from "../config/db.js";
import auth from "../middleware/auth.js";

const router = express.Router();

// Sve rute za kupce zahtijevaju prijavljenog korisnika
router.use(auth);

// GET /api/customers
// Dohvaćanje svih kupaca
router.get("/", async (req, res) => {
  try {
    const db = getDatabase();

    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const search = req.query.search?.trim() || "";

    const skip = (page - 1) * limit;

    const filter = {};

    if (search) {
      filter.name = {
        $regex: search,
        $options: "i",
      };
    }

    const totalCustomers = await db
      .collection("customers")
      .countDocuments(filter);

    const customers = await db
      .collection("customers")
      .find(filter)
      .sort({
        createdAt: -1,
      })
      .skip(skip)
      .limit(limit)
      .toArray();

    return res.status(200).json({
      success: true,
      data: customers,
      pagination: {
        totalItems: totalCustomers,
        currentPage: page,
        itemsPerPage: limit,
        totalPages: Math.ceil(totalCustomers / limit),
      },
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: "Dogodila se greška.",
    });
  }
});

// GET /api/customers/:id
// Dohvaćanje jednog kupca
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "ID kupca nije valjan.",
      });
    }

    const db = getDatabase();

    const customer = await db.collection("customers").findOne({
      _id: new ObjectId(id),
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Kupac nije pronađen.",
      });
    }

    return res.status(200).json({
      success: true,
      data: customer,
    });
  } catch (error) {
    console.error("Greška prilikom dohvaćanja kupca:", error);

    return res.status(500).json({
      success: false,
      message: "Dogodila se greška prilikom dohvaćanja kupca.",
    });
  }
});

// POST /api/customers
// Dodavanje novog kupca
router.post("/", async (req, res) => {
  try {
    const { name, oib, email, phone, address, city, postalCode } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Naziv kupca je obvezan.",
      });
    }

    const normalizedOib = oib?.trim() || "";
    const normalizedEmail = email?.trim().toLowerCase() || "";

    if (normalizedOib && !/^\d{11}$/.test(normalizedOib)) {
      return res.status(400).json({
        success: false,
        message: "OIB mora sadržavati točno 11 znamenki.",
      });
    }

    const db = getDatabase();

    if (normalizedOib) {
      const existingCustomer = await db.collection("customers").findOne({
        oib: normalizedOib,
      });

      if (existingCustomer) {
        return res.status(409).json({
          success: false,
          message: "Kupac s navedenim OIB-om već postoji.",
        });
      }
    }

    const newCustomer = {
      name: name.trim(),
      oib: normalizedOib,
      email: normalizedEmail,
      phone: phone?.trim() || "",
      address: address?.trim() || "",
      city: city?.trim() || "",
      postalCode: postalCode?.trim() || "",
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await db.collection("customers").insertOne(newCustomer);

    return res.status(201).json({
      success: true,
      message: "Kupac je uspješno dodan.",
      data: {
        _id: result.insertedId,
        ...newCustomer,
      },
    });
  } catch (error) {
    console.error("Greška prilikom dodavanja kupca:", error);

    return res.status(500).json({
      success: false,
      message: "Dogodila se greška prilikom dodavanja kupca.",
    });
  }
});

// PUT /api/customers/:id
// Uređivanje kupca
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "ID kupca nije valjan.",
      });
    }

    const { name, oib, email, phone, address, city, postalCode, active } =
      req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Naziv kupca je obvezan.",
      });
    }

    const normalizedOib = oib?.trim() || "";
    const normalizedEmail = email?.trim().toLowerCase() || "";

    if (normalizedOib && !/^\d{11}$/.test(normalizedOib)) {
      return res.status(400).json({
        success: false,
        message: "OIB mora sadržavati točno 11 znamenki.",
      });
    }

    const db = getDatabase();

    const existingCustomer = await db.collection("customers").findOne({
      _id: new ObjectId(id),
    });

    if (!existingCustomer) {
      return res.status(404).json({
        success: false,
        message: "Kupac nije pronađen.",
      });
    }

    if (normalizedOib) {
      const customerWithSameOib = await db.collection("customers").findOne({
        oib: normalizedOib,
        _id: {
          $ne: new ObjectId(id),
        },
      });

      if (customerWithSameOib) {
        return res.status(409).json({
          success: false,
          message: "Drugi kupac već koristi navedeni OIB.",
        });
      }
    }

    const updatedCustomer = {
      name: name.trim(),
      oib: normalizedOib,
      email: normalizedEmail,
      phone: phone?.trim() || "",
      address: address?.trim() || "",
      city: city?.trim() || "",
      postalCode: postalCode?.trim() || "",
      active: typeof active === "boolean" ? active : existingCustomer.active,
      updatedAt: new Date(),
    };

    await db.collection("customers").updateOne(
      {
        _id: new ObjectId(id),
      },
      {
        $set: updatedCustomer,
      },
    );

    const customer = await db.collection("customers").findOne({
      _id: new ObjectId(id),
    });

    return res.status(200).json({
      success: true,
      message: "Podaci o kupcu uspješno su ažurirani.",
      data: customer,
    });
  } catch (error) {
    console.error("Greška prilikom uređivanja kupca:", error);

    return res.status(500).json({
      success: false,
      message: "Dogodila se greška prilikom uređivanja kupca.",
    });
  }
});

// DELETE /api/customers/:id
// Brisanje kupca samo ako nema aktivnih narudžbi
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "ID kupca nije valjan.",
      });
    }

    const db = getDatabase();
    const customerObjectId = new ObjectId(id);

    const customer = await db.collection("customers").findOne({
      _id: customerObjectId,
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Kupac nije pronađen.",
      });
    }

    const activeOrdersCount = await db.collection("orders").countDocuments({
      customerId: customerObjectId,
      status: {
        $ne: "isporučena",
      },
    });

    if (activeOrdersCount > 0) {
      return res.status(409).json({
        success: false,
        message:
          activeOrdersCount === 1
            ? "Kupca nije moguće obrisati jer ima 1 aktivnu narudžbu."
            : `Kupca nije moguće obrisati jer ima ${activeOrdersCount} aktivne narudžbe.`,
        data: {
          activeOrdersCount,
        },
      });
    }

    await db.collection("customers").deleteOne({
      _id: customerObjectId,
    });

    return res.status(200).json({
      success: true,
      message: "Kupac je uspješno obrisan.",
    });
  } catch (error) {
    console.error("Greška prilikom brisanja kupca:", error);

    return res.status(500).json({
      success: false,
      message: "Dogodila se greška prilikom brisanja kupca.",
    });
  }
});

export default router;
