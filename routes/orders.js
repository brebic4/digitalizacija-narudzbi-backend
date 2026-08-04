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

const STATUS_TRANSITIONS = {
  zaprimljena: ["obrađena"],
  obrađena: ["u_pripremi"],
  u_pripremi: ["spremna_za_isporuku"],
  spremna_za_isporuku: ["isporučena"],
  isporučena: [],
};

// Izračun sažetka narudžbe za tablični prikaz
function mapOrderToListItem(order) {
  const items = Array.isArray(order.items) ? order.items : [];

  const itemsCount = items.length;

  const totalPackages = items.reduce(
    (sum, item) => sum + Number(item.quantity || 0),
    0,
  );

  const totalWeightGrams = items.reduce(
    (sum, item) => sum + Number(item.totalWeightGrams || 0),
    0,
  );

  return {
    _id: order._id,

    customerName: order.customerSnapshot?.name || "Nepoznat kupac",

    orderNumber: order.orderNumber || "—",

    deliveryDate: order.deliveryDate || null,

    status: order.status || "nepoznat",

    itemsCount,

    totalPackages,

    totalWeightKg: totalWeightGrams / 1000,

    createdAt: order.createdAt || null,
  };
}

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

      statusHistory: [
        {
          status: "obrađena",
          changedAt: now,
        },
      ],

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

router.get("/", async (req, res) => {
  try {
    const db = getDatabase();

    // 1. Query parametri
    const { page = 1, limit = 10, search = "", status } = req.query;

    // 2. Validacija
    const currentPage = Math.max(parseInt(page, 10) || 1, 1);
    const itemsPerPage = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);

    // 3. Filter
    const filter = {};
    const trimmedSearch = search.trim();

    if (trimmedSearch) {
      const safeSearch = trimmedSearch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      filter.$or = [
        {
          orderNumber: {
            $regex: safeSearch,
            $options: "i",
          },
        },

        {
          "customerSnapshot.name": {
            $regex: safeSearch,
            $options: "i",
          },
        },
      ];
    }

    if (status) {
      if (!ORDER_STATUSES.includes(status)) {
        return res.status(400).json({
          success: false,

          message: "Status nije ispravan.",
        });
      }

      filter.status = status;
    }

    // 4. count
    const ordersCollection = db.collection("orders");
    const totalItems = await ordersCollection.countDocuments(filter);

    // 5. Dohvat
    const orders = await ordersCollection
      .find(filter)
      .sort({
        deliveryDate: 1,
      })
      .skip((currentPage - 1) * itemsPerPage)
      .limit(itemsPerPage)
      .toArray();

    // 6. DTO
    const data = orders.map(mapOrderToListItem);

    // 7. Response
    return res.status(200).json({
      success: true,

      data,

      pagination: {
        totalItems,

        currentPage,

        itemsPerPage,

        totalPages: Math.ceil(totalItems / itemsPerPage),
      },
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: "Dogodila se greška pri dohvaćanju narudžbi.",
    });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const db = getDatabase();
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Neispravan ID narudžbe.",
      });
    }

    const ordersCollection = db.collection("orders");

    const order = await ordersCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Narudžba nije pronađena.",
      });
    }

    const totalPackages = order.items.reduce(
      (sum, item) => sum + item.quantity,
      0,
    );

    const totalWeightGrams = order.items.reduce(
      (sum, item) => sum + item.totalWeightGrams,
      0,
    );

    const responseData = {
      ...order,

      summary: {
        itemsCount: order.items.length,
        totalPackages,
        totalWeightGrams,
        totalWeightKg: totalWeightGrams / 1000,
      },
    };

    return res.status(200).json({
      success: true,
      data: responseData,
    });
  } catch (error) {
    console.error("Greška pri dohvaćanju narudžbe:", error);

    return res.status(500).json({
      success: false,
      message: "Dogodila se greška pri dohvaćanju narudžbe.",
    });
  }
});

router.patch("/:id/status", async (req, res) => {
  try {
    const db = getDatabase();

    const { id } = req.params;
    const { status } = req.body ?? {};

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Neispravan ID narudžbe.",
      });
    }

    if (typeof status !== "string" || !status.trim()) {
      return res.status(400).json({
        success: false,
        message: "Status narudžbe je obavezan.",
      });
    }

    const normalizedStatus = status.trim();

    if (!ORDER_STATUSES.includes(normalizedStatus)) {
      return res.status(400).json({
        success: false,
        message: "Status nije ispravan.",
      });
    }

    const ordersCollection = db.collection("orders");
    const orderId = new ObjectId(id);

    const order = await ordersCollection.findOne({
      _id: orderId,
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Narudžba nije pronađena.",
      });
    }

    if (order.status === normalizedStatus) {
      return res.status(400).json({
        success: false,
        message: `Narudžba već ima status "${normalizedStatus}".`,
      });
    }

    const allowedTransitions = STATUS_TRANSITIONS[order.status];

    if (!allowedTransitions) {
      return res.status(400).json({
        success: false,
        message: "Trenutni status narudžbe nije ispravan.",
      });
    }

    if (!allowedTransitions.includes(normalizedStatus)) {
      return res.status(400).json({
        success: false,
        message: `Status se ne može promijeniti iz "${order.status}" u "${normalizedStatus}".`,
      });
    }

    const now = new Date();

    await ordersCollection.updateOne(
      {
        _id: orderId,
        status: order.status,
      },
      {
        $set: {
          status: normalizedStatus,
          updatedAt: now,
        },
        $push: {
          statusHistory: {
            status: normalizedStatus,
            changedAt: now,
          },
        },
      },
    );

    const updatedOrder = await ordersCollection.findOne({
      _id: orderId,
    });

    return res.status(200).json({
      success: true,
      message: "Status narudžbe je uspješno ažuriran.",
      data: updatedOrder,
    });
  } catch (error) {
    console.error("Greška pri promjeni statusa:", error);

    return res.status(500).json({
      success: false,
      message: "Dogodila se greška pri promjeni statusa.",
    });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const db = getDatabase();
    const { id } = req.params;

    const {
      customerId,
      orderNumber,
      deliveryDate,
      items,
      note = "",
    } = req.body ?? {};

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Neispravan ID narudžbe.",
      });
    }

    if (!customerId || !ObjectId.isValid(customerId)) {
      return res.status(400).json({
        success: false,
        message: "Potrebno je odabrati ispravnog kupca.",
      });
    }

    if (typeof orderNumber !== "string" || !orderNumber.trim()) {
      return res.status(400).json({
        success: false,
        message: "Broj narudžbe je obavezan.",
      });
    }

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

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Narudžba mora sadržavati najmanje jednu stavku.",
      });
    }

    if (typeof note !== "string") {
      return res.status(400).json({
        success: false,
        message: "Napomena mora biti tekst.",
      });
    }

    const ordersCollection = db.collection("orders");
    const customersCollection = db.collection("customers");
    const productsCollection = db.collection("products");

    const orderId = new ObjectId(id);
    const customerObjectId = new ObjectId(customerId);

    const existingOrder = await ordersCollection.findOne({
      _id: orderId,
    });

    if (!existingOrder) {
      return res.status(404).json({
        success: false,
        message: "Narudžba nije pronađena.",
      });
    }

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

    const duplicateOrder = await ordersCollection.findOne({
      customerId: customerObjectId,
      orderNumber: normalizedOrderNumber,
      _id: {
        $ne: orderId,
      },
    });

    if (duplicateOrder) {
      return res.status(409).json({
        success: false,
        message: "Druga narudžba s tim brojem već postoji za odabranog kupca.",
      });
    }

    const productIds = [];

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

    const uniqueProductIds = [
      ...new Map(
        productIds.map((productId) => [productId.toString(), productId]),
      ).values(),
    ];

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
          message: `Proizvod "${product.name}" nije aktivan i ne može se dodati u narudžbu.`,
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

    const updatedFields = {
      customerId: customerObjectId,

      customerSnapshot: {
        name: customer.name,
        oib: customer.oib,
      },

      orderNumber: normalizedOrderNumber,
      deliveryDate: parsedDeliveryDate,
      items: preparedItems,
      note: note.trim(),
      updatedAt: new Date(),
    };

    await ordersCollection.updateOne(
      {
        _id: orderId,
      },
      {
        $set: updatedFields,
      },
    );

    const updatedOrder = await ordersCollection.findOne({
      _id: orderId,
    });

    return res.status(200).json({
      success: true,
      message: "Narudžba je uspješno uređena.",
      data: updatedOrder,
    });
  } catch (error) {
    console.error("Greška pri uređivanju narudžbe:", error);

    return res.status(500).json({
      success: false,
      message: "Dogodila se greška pri uređivanju narudžbe.",
    });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const db = getDatabase();
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Neispravan ID narudžbe.",
      });
    }

    const ordersCollection = db.collection("orders");
    const orderId = new ObjectId(id);

    const order = await ordersCollection.findOne({
      _id: orderId,
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Narudžba nije pronađena.",
      });
    }

    await ordersCollection.deleteOne({
      _id: orderId,
    });

    return res.status(200).json({
      success: true,
      message: "Narudžba je uspješno obrisana.",
      data: {
        _id: orderId,
        orderNumber: order.orderNumber,
        customerName: order.customerSnapshot?.name ?? "",
      },
    });
  } catch (error) {
    console.error("Greška pri brisanju narudžbe:", error);

    return res.status(500).json({
      success: false,
      message: "Dogodila se greška pri brisanju narudžbe.",
    });
  }
});

export default router;
