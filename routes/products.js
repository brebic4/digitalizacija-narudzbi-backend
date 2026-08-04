import express from "express";
import { ObjectId } from "mongodb";
import { getDatabase } from "../config/db.js";
import auth from "../middleware/auth.js";

const router = express.Router();

router.use(auth);

const escapeRegex = (value) => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

// Dohvat svih proizvoda
router.get("/", async (req, res) => {
  try {
    const db = getDatabase();

    const search = req.query.search?.trim() || "";

    const requestedPage = Number.parseInt(req.query.page, 10);
    const requestedLimit = Number.parseInt(req.query.limit, 10);

    const page =
      Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;

    const limit =
      Number.isInteger(requestedLimit) &&
      requestedLimit > 0 &&
      requestedLimit <= 100
        ? requestedLimit
        : 10;

    const skip = (page - 1) * limit;

    const filter = {};

    if (search) {
      const safeSearch = escapeRegex(search);

      filter.$or = [
        {
          name: {
            $regex: safeSearch,
            $options: "i",
          },
        },
        {
          code: {
            $regex: safeSearch,
            $options: "i",
          },
        },
        {
          barcode: {
            $regex: safeSearch,
            $options: "i",
          },
        },
      ];
    }

    const productsCollection = db.collection("products");

    const totalItems = await productsCollection.countDocuments(filter);

    const products = await productsCollection
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    const productIds = products.map((product) => product._id);

    const productUsage = await db
      .collection("orders")
      .aggregate([
        {
          $match: {
            "items.productId": {
              $in: productIds,
            },
          },
        },
        {
          $unwind: "$items",
        },
        {
          $match: {
            "items.productId": {
              $in: productIds,
            },
          },
        },
        {
          $group: {
            _id: "$items.productId",
            orderIds: {
              $addToSet: "$_id",
            },
          },
        },
        {
          $project: {
            _id: 1,
            ordersCount: {
              $size: "$orderIds",
            },
          },
        },
      ])
      .toArray();

    const usageMap = new Map(
      productUsage.map((usage) => [usage._id.toString(), usage.ordersCount]),
    );

    const productsWithUsage = products.map((product) => {
      const ordersCount = usageMap.get(product._id.toString()) || 0;

      return {
        ...product,
        ordersCount,
        hasBeenUsed: ordersCount > 0,
      };
    });

    return res.status(200).json({
      success: true,
      data: productsWithUsage,
      pagination: {
        totalItems,
        currentPage: page,
        itemsPerPage: limit,
        totalPages: Math.ceil(totalItems / limit),
      },
    });
  } catch (error) {
    console.error("Greška pri dohvaćanju proizvoda:", error);

    return res.status(500).json({
      success: false,
      message: "Dogodila se greška pri dohvaćanju proizvoda.",
    });
  }
});

// Dohvat jednog proizvoda
router.get("/:id", async (req, res) => {
  try {
    const db = getDatabase();
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Neispravan ID proizvoda.",
      });
    }

    const product = await db.collection("products").findOne({
      _id: new ObjectId(id),
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Proizvod nije pronađen.",
      });
    }

    return res.status(200).json({
      success: true,
      data: product,
    });
  } catch (error) {
    console.error("Greška pri dohvaćanju proizvoda:", error);

    return res.status(500).json({
      success: false,
      message: "Dogodila se greška pri dohvaćanju proizvoda.",
    });
  }
});

// Dodavanje proizvoda
router.post("/", async (req, res) => {
  try {
    const db = getDatabase();

    const {
      name,
      code,
      barcode,
      packageWeightGrams,
      unit,
      active = true,
    } = req.body;

    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Naziv proizvoda je obavezan.",
      });
    }

    if (typeof code !== "string" || !code.trim()) {
      return res.status(400).json({
        success: false,
        message: "Interna šifra proizvoda je obavezna.",
      });
    }

    if (typeof barcode !== "string" || !barcode.trim()) {
      return res.status(400).json({
        success: false,
        message: "Barkod proizvoda je obavezan.",
      });
    }

    const normalizedBarcode = barcode.trim();

    if (!/^\d+$/.test(normalizedBarcode)) {
      return res.status(400).json({
        success: false,
        message: "Barkod smije sadržavati samo znamenke.",
      });
    }

    const numericPackageWeight = Number(packageWeightGrams);

    if (
      packageWeightGrams === undefined ||
      packageWeightGrams === null ||
      packageWeightGrams === "" ||
      Number.isNaN(numericPackageWeight) ||
      numericPackageWeight <= 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Masa pakiranja mora biti broj veći od 0.",
      });
    }

    if (unit !== "kom") {
      return res.status(400).json({
        success: false,
        message: "Jedinica mjere mora biti kom.",
      });
    }

    if (typeof active !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "Vrijednost active mora biti true ili false.",
      });
    }

    const normalizedName = name.trim();
    const normalizedCode = code.trim().toUpperCase();

    const productsCollection = db.collection("products");

    const productWithSameCode = await productsCollection.findOne({
      code: normalizedCode,
    });

    if (productWithSameCode) {
      return res.status(409).json({
        success: false,
        message: "Proizvod s tom internom šifrom već postoji.",
      });
    }

    const productWithSameBarcode = await productsCollection.findOne({
      barcode: normalizedBarcode,
    });

    if (productWithSameBarcode) {
      return res.status(409).json({
        success: false,
        message: "Proizvod s tim barkodom već postoji.",
      });
    }

    const now = new Date();

    const newProduct = {
      name: normalizedName,
      code: normalizedCode,
      barcode: normalizedBarcode,
      packageWeightGrams: numericPackageWeight,
      unit,
      active,
      createdAt: now,
      updatedAt: now,
    };

    const result = await productsCollection.insertOne(newProduct);

    return res.status(201).json({
      success: true,
      message: "Proizvod je uspješno dodan.",
      data: {
        _id: result.insertedId,
        ...newProduct,
      },
    });
  } catch (error) {
    console.error("Greška pri dodavanju proizvoda:", error);

    return res.status(500).json({
      success: false,
      message: "Dogodila se greška pri dodavanju proizvoda.",
    });
  }
});

// Uređivanje proizvoda
router.put("/:id", async (req, res) => {
  try {
    const db = getDatabase();
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Neispravan ID proizvoda.",
      });
    }

    const { name, code, barcode, packageWeightGrams, unit, active } = req.body;

    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Naziv proizvoda je obavezan.",
      });
    }

    if (typeof code !== "string" || !code.trim()) {
      return res.status(400).json({
        success: false,
        message: "Interna šifra proizvoda je obavezna.",
      });
    }

    if (typeof barcode !== "string" || !barcode.trim()) {
      return res.status(400).json({
        success: false,
        message: "Barkod proizvoda je obavezan.",
      });
    }

    const normalizedBarcode = barcode.trim();

    if (!/^\d+$/.test(normalizedBarcode)) {
      return res.status(400).json({
        success: false,
        message: "Barkod smije sadržavati samo znamenke.",
      });
    }

    const numericPackageWeight = Number(packageWeightGrams);

    if (
      packageWeightGrams === undefined ||
      packageWeightGrams === null ||
      packageWeightGrams === "" ||
      Number.isNaN(numericPackageWeight) ||
      numericPackageWeight <= 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Masa pakiranja mora biti broj veći od 0.",
      });
    }

    if (unit !== "kom") {
      return res.status(400).json({
        success: false,
        message: "Jedinica mjere mora biti kom.",
      });
    }

    if (typeof active !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "Vrijednost active mora biti true ili false.",
      });
    }

    const normalizedName = name.trim();
    const normalizedCode = code.trim().toUpperCase();
    const productId = new ObjectId(id);

    const productsCollection = db.collection("products");

    const product = await productsCollection.findOne({
      _id: productId,
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Proizvod nije pronađen.",
      });
    }

    const productWithSameCode = await productsCollection.findOne({
      code: normalizedCode,
      _id: {
        $ne: productId,
      },
    });

    if (productWithSameCode) {
      return res.status(409).json({
        success: false,
        message: "Drugi proizvod već koristi tu internu šifru.",
      });
    }

    const productWithSameBarcode = await productsCollection.findOne({
      barcode: normalizedBarcode,
      _id: {
        $ne: productId,
      },
    });

    if (productWithSameBarcode) {
      return res.status(409).json({
        success: false,
        message: "Drugi proizvod već koristi taj barkod.",
      });
    }

    const updatedProduct = {
      name: normalizedName,
      code: normalizedCode,
      barcode: normalizedBarcode,
      packageWeightGrams: numericPackageWeight,
      unit,
      active,
      updatedAt: new Date(),
    };

    await productsCollection.updateOne(
      {
        _id: productId,
      },
      {
        $set: updatedProduct,
      },
    );

    const savedProduct = await productsCollection.findOne({
      _id: productId,
    });

    return res.status(200).json({
      success: true,
      message: "Proizvod je uspješno uređen.",
      data: savedProduct,
    });
  } catch (error) {
    console.error("Greška pri uređivanju proizvoda:", error);

    return res.status(500).json({
      success: false,
      message: "Dogodila se greška pri uređivanju proizvoda.",
    });
  }
});

// Promjena aktivnog statusa proizvoda
router.patch("/:id/active", async (req, res) => {
  try {
    const db = getDatabase();
    const { id } = req.params;
    const { active } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Neispravan ID proizvoda.",
      });
    }

    if (typeof active !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "Vrijednost active mora biti true ili false.",
      });
    }

    const productId = new ObjectId(id);
    const productsCollection = db.collection("products");

    const product = await productsCollection.findOne({
      _id: productId,
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Proizvod nije pronađen.",
      });
    }

    if (product.active === active) {
      return res.status(400).json({
        success: false,
        message: active
          ? "Proizvod je već aktivan."
          : "Proizvod je već neaktivan.",
      });
    }

    const now = new Date();

    await productsCollection.updateOne(
      {
        _id: productId,
      },
      {
        $set: {
          active,
          updatedAt: now,
        },
      },
    );

    const savedProduct = await productsCollection.findOne({
      _id: productId,
    });

    return res.status(200).json({
      success: true,
      message: active
        ? "Proizvod je uspješno aktiviran."
        : "Proizvod je uspješno označen kao neaktivan.",
      data: savedProduct,
    });
  } catch (error) {
    console.error("Greška pri promjeni statusa proizvoda:", error);

    return res.status(500).json({
      success: false,
      message: "Dogodila se greška pri promjeni statusa proizvoda.",
    });
  }
});

// Brisanje proizvoda
// Trajno brisanje dopušteno je samo ako proizvod
// nikada nije korišten ni u jednoj narudžbi
router.delete("/:id", async (req, res) => {
  try {
    const db = getDatabase();
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Neispravan ID proizvoda.",
      });
    }

    const productId = new ObjectId(id);

    const productsCollection = db.collection("products");

    const ordersCollection = db.collection("orders");

    const product = await productsCollection.findOne({
      _id: productId,
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Proizvod nije pronađen.",
      });
    }

    const ordersCount = await ordersCollection.countDocuments({
      "items.productId": productId,
    });

    if (ordersCount > 0) {
      return res.status(409).json({
        success: false,
        message:
          ordersCount === 1
            ? "Proizvod nije moguće obrisati jer se koristi u 1 narudžbi. Označite ga kao neaktivan."
            : `Proizvod nije moguće obrisati jer se koristi u ${ordersCount} narudžbi. Označite ga kao neaktivan.`,
        data: {
          ordersCount,
          canDeactivate: product.active,
        },
      });
    }

    await productsCollection.deleteOne({
      _id: productId,
    });

    return res.status(200).json({
      success: true,
      message: "Proizvod je uspješno obrisan.",
    });
  } catch (error) {
    console.error("Greška pri brisanju proizvoda:", error);

    return res.status(500).json({
      success: false,
      message: "Dogodila se greška pri brisanju proizvoda.",
    });
  }
});

export default router;
