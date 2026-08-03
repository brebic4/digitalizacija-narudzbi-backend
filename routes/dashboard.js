import express from "express";

import { getDatabase } from "../config/db.js";
import auth from "../middleware/auth.js";

const router = express.Router();

router.use(auth);

function getStartOfDay(date = new Date()) {
  const result = new Date(date);

  result.setHours(0, 0, 0, 0);

  return result;
}

function getStartOfNextDay(date = new Date()) {
  const result = getStartOfDay(date);

  result.setDate(result.getDate() + 1);

  return result;
}

function mapRecentOrder(order) {
  const items = Array.isArray(order.items) ? order.items : [];

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

    orderNumber: order.orderNumber,

    deliveryDate: order.deliveryDate,

    status: order.status,

    itemsCount: items.length,

    totalPackages,

    totalWeightKg: totalWeightGrams / 1000,

    createdAt: order.createdAt,
  };
}

router.get("/summary", async (req, res) => {
  try {
    const db = getDatabase();

    const ordersCollection = db.collection("orders");

    const todayStart = getStartOfDay();
    const tomorrowStart = getStartOfNextDay();

    const [
      activeOrders,
      dueToday,
      inPreparation,
      readyForDelivery,
      overdueOrders,
      recentOrders,
    ] = await Promise.all([
      // Sve narudžbe koje još nisu isporučene
      ordersCollection.countDocuments({
        status: {
          $ne: "isporučena",
        },
      }),

      // Rok isporuke je danas
      ordersCollection.countDocuments({
        deliveryDate: {
          $gte: todayStart,
          $lt: tomorrowStart,
        },
        status: {
          $ne: "isporučena",
        },
      }),

      // Narudžbe koje radnici trenutačno pripremaju
      ordersCollection.countDocuments({
        status: "u_pripremi",
      }),

      // Završeno pakiranje, čeka se isporuka
      ordersCollection.countDocuments({
        status: "spremna_za_isporuku",
      }),

      // Rok je prošao, ali narudžba nije isporučena
      ordersCollection.countDocuments({
        deliveryDate: {
          $lt: todayStart,
        },
        status: {
          $ne: "isporučena",
        },
      }),

      // Posljednjih pet unesenih narudžbi
      ordersCollection
        .find({})
        .sort({
          createdAt: -1,
        })
        .limit(5)
        .toArray(),
    ]);

    const mappedRecentOrders = recentOrders.map(mapRecentOrder);

    return res.status(200).json({
      success: true,

      data: {
        statistics: {
          activeOrders,
          dueToday,
          inPreparation,
          readyForDelivery,
          overdueOrders,
        },

        recentOrders: mappedRecentOrders,

        generatedAt: new Date(),
      },
    });
  } catch (error) {
    console.error("Greška pri dohvaćanju dashboard podataka:", error);

    return res.status(500).json({
      success: false,
      message: "Dogodila se greška pri dohvaćanju podataka za dashboard.",
    });
  }
});

export default router;
