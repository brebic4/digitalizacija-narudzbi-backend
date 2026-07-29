import express from "express";
import { ObjectId } from "mongodb";

import { getDatabase } from "../config/db.js";
import auth from "../middleware/auth.js";

const router = express.Router();

router.use(auth);

export const ORDER_STATUSES = [
  "zaprimljena",
  "obrađena",
  "u_pripremi",
  "spremna_za_isporuku",
  "isporučena",
];

router.post("/", async (req, res) => {
  try {
    const db = getDatabase();

    const {
      customerId,
      orderNumber,
      deliveryDate,
      items,
      note = "",
    } = req.body;

    // Validacija kupca
    if (!customerId || !ObjectId.isValid(customerId)) {
      return res.status(400).json({
        success: false,
        message: "Potrebno je odabrati ispravnog kupca.",
      });
    }

    // Validacija broja narudžbe
    if (typeof orderNumber !== "string" || !orderNumber.trim()) {
      return res.status(400).json({
        success: false,
        message: "Broj narudžbe je obavezan.",
      });
    }

    // Validacija datuma isporuke
    if (!deliveryDate) {
      return res.status(400).json({
        success: false,
        message: "Datum isporuke je obavezan.",
      });
    }

    const parsedDeliveryDate = new Date(deliveryDate);

    if (Number.isNaN(parsedDeliveryDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Datum isporuke nije ispravan.",
      });
    }

    // Validacija stavki narudžbe
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Narudžba mora sadržavati najmanje jednu stavku.",
      });
    }

    // Validacija napomene
    if (typeof note !== "string") {
      return res.status(400).json({
        success: false,
        message: "Napomena mora biti tekst.",
      });
    }

    const customersCollection = db.collection("customers");
    const productsCollection = db.collection("products");
    const ordersCollection = db.collection("orders");

    const customerObjectId = new ObjectId(customerId);

    // Provjera postoji li kupac
    const customer = await customersCollection.findOne({
      _id: customerObjectId,
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Odabrani kupac ne postoji.",
      });
    }

    const normalizedOrderNumber = orderNumber.trim();

    // Provjera postoji li već isti broj narudžbe za istog kupca
    const existingOrder = await ordersCollection.findOne({
      customerId: customerObjectId,
      orderNumber: normalizedOrderNumber,
    });

    if (existingOrder) {
      return res.status(409).json({
        success: false,
        message: "Narudžba s tim brojem već postoji za odabranog kupca.",
      });
    }

    const productIds = [];

    // Validacija svake stavke
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];

      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return res.status(400).json({
          success: false,
          message: `Stavka ${index + 1} nije ispravna.`,
        });
      }

      if (!item.productId || !ObjectId.isValid(item.productId)) {
        return res.status(400).json({
          success: false,
          message: `Stavka ${index + 1} nema ispravan proizvod.`,
        });
      }

      const numericQuantity = Number(item.quantity);

      if (
        item.quantity === undefined ||
        item.quantity === null ||
        item.quantity === "" ||
        !Number.isInteger(numericQuantity) ||
        numericQuantity <= 0
      ) {
        return res.status(400).json({
          success: false,
          message: `Količina u stavci ${index + 1} mora biti cijeli broj veći od 0.`,
        });
      }

      const optionalStringFields = [
        "customerProductCode",
        "customerBarcode",
        "originalProductName",
      ];

      for (const field of optionalStringFields) {
        if (
          item[field] !== undefined &&
          item[field] !== null &&
          typeof item[field] !== "string"
        ) {
          return res.status(400).json({
            success: false,
            message: `Polje ${field} u stavci ${index + 1} mora biti tekst.`,
          });
        }
      }

      productIds.push(new ObjectId(item.productId));
    }

    // Uklanjamo duplikate ID-jeva prije dohvaćanja proizvoda
    const uniqueProductIds = [
      ...new Map(
        productIds.map((productId) => [productId.toString(), productId]),
      ).values(),
    ];

    // Sve proizvode dohvaćamo jednim upitom
    const products = await productsCollection
      .find({
        _id: {
          $in: uniqueProductIds,
        },
      })
      .toArray();

    const productsMap = new Map(
      products.map((product) => [product._id.toString(), product]),
    );

    const preparedItems = [];

    // Izrada stavki koje se spremaju u bazu
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];

      const product = productsMap.get(item.productId.toString());

      if (!product) {
        return res.status(404).json({
          success: false,
          message: `Proizvod u stavci ${index + 1} nije pronađen.`,
        });
      }

      if (product.active === false) {
        return res.status(400).json({
          success: false,
          message: `Proizvod "${product.name}" nije aktivan i ne može se naručiti.`,
        });
      }

      const quantity = Number(item.quantity);

      preparedItems.push({
        productId: product._id,

        productSnapshot: {
          name: product.name,
          code: product.code,
          barcode: product.barcode,
          packageWeightGrams: product.packageWeightGrams,
          unit: product.unit,
        },

        customerProductCode: item.customerProductCode?.trim() || "",

        customerBarcode: item.customerBarcode?.trim() || "",

        originalProductName: item.originalProductName?.trim() || "",

        quantity,

        totalWeightGrams: quantity * product.packageWeightGrams,
      });
    }

    const now = new Date();

    const newOrder = {
      customerId: customerObjectId,

      customerSnapshot: {
        name: customer.name,
        oib: customer.oib,
      },

      orderNumber: normalizedOrderNumber,
      deliveryDate: parsedDeliveryDate,

      items: preparedItems,

      status: "obrađena",

      note: note.trim(),

      createdAt: now,
      updatedAt: now,
    };

    const result = await ordersCollection.insertOne(newOrder);

    return res.status(201).json({
      success: true,
      message: "Narudžba je uspješno kreirana.",
      data: {
        _id: result.insertedId,
        ...newOrder,
      },
    });
  } catch (error) {
    console.error("Greška pri kreiranju narudžbe:", error);

    return res.status(500).json({
      success: false,
      message: "Dogodila se greška pri kreiranju narudžbe.",
    });
  }
});

export default router;
