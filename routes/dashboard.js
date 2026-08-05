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

function getStartOfMonthMonthsAgo(monthsAgo = 0) {
  const date = new Date();

  date.setMonth(date.getMonth() - monthsAgo);
  date.setDate(1);
  date.setHours(0, 0, 0, 0);

  return date;
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

    const sixMonthsAgo = getStartOfMonthMonthsAgo(5);

    const [
      totalOrders,
      activeOrders,
      deliveredOrders,
      dueToday,
      inPreparation,
      readyForDelivery,
      overdueOrders,
      recentOrders,
      orderTotalsAggregation,
      statusDistributionAggregation,
      monthlyOrdersAggregation,
      topCustomersAggregation,
      topProductsAggregation,
    ] = await Promise.all([
      // Sve narudžbe
      ordersCollection.countDocuments({}),

      // Sve narudžbe koje još nisu isporučene
      ordersCollection.countDocuments({
        status: {
          $ne: "isporučena",
        },
      }),

      // Sve isporučene narudžbe
      ordersCollection.countDocuments({
        status: "isporučena",
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

      // Narudžbe koje se trenutačno pripremaju
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

      // Ukupno pakiranja i ukupna težina
      ordersCollection
        .aggregate([
          {
            $unwind: {
              path: "$items",
              preserveNullAndEmptyArrays: false,
            },
          },
          {
            $group: {
              _id: null,

              totalPackages: {
                $sum: {
                  $ifNull: ["$items.quantity", 0],
                },
              },

              totalWeightGrams: {
                $sum: {
                  $ifNull: ["$items.totalWeightGrams", 0],
                },
              },
            },
          },
        ])
        .toArray(),

      // Raspodjela narudžbi prema statusu
      ordersCollection
        .aggregate([
          {
            $group: {
              _id: "$status",
              count: {
                $sum: 1,
              },
            },
          },
        ])
        .toArray(),

      // Narudžbe po mjesecima za posljednjih šest mjeseci
      ordersCollection
        .aggregate([
          {
            $match: {
              createdAt: {
                $gte: sixMonthsAgo,
              },
            },
          },
          {
            $group: {
              _id: {
                year: {
                  $year: "$createdAt",
                },
                month: {
                  $month: "$createdAt",
                },
              },

              ordersCount: {
                $sum: 1,
              },

              totalPackages: {
                $sum: {
                  $sum: {
                    $map: {
                      input: {
                        $ifNull: ["$items", []],
                      },

                      as: "item",

                      in: {
                        $ifNull: ["$$item.quantity", 0],
                      },
                    },
                  },
                },
              },

              totalWeightGrams: {
                $sum: {
                  $sum: {
                    $map: {
                      input: {
                        $ifNull: ["$items", []],
                      },

                      as: "item",

                      in: {
                        $ifNull: ["$$item.totalWeightGrams", 0],
                      },
                    },
                  },
                },
              },
            },
          },
          {
            $sort: {
              "_id.year": 1,
              "_id.month": 1,
            },
          },
        ])
        .toArray(),

      // Top pet kupaca prema broju narudžbi
      ordersCollection
        .aggregate([
          {
            $group: {
              _id: {
                customerId: "$customerId",
                customerName: "$customerSnapshot.name",
              },

              ordersCount: {
                $sum: 1,
              },

              totalPackages: {
                $sum: {
                  $sum: {
                    $map: {
                      input: {
                        $ifNull: ["$items", []],
                      },

                      as: "item",

                      in: {
                        $ifNull: ["$$item.quantity", 0],
                      },
                    },
                  },
                },
              },
            },
          },
          {
            $sort: {
              ordersCount: -1,
              totalPackages: -1,
            },
          },
          {
            $limit: 5,
          },
        ])
        .toArray(),

      // Top pet proizvoda prema broju pakiranja
      ordersCollection
        .aggregate([
          {
            $unwind: {
              path: "$items",
              preserveNullAndEmptyArrays: false,
            },
          },
          {
            $group: {
              _id: {
                productId: "$items.productId",
                productName: "$items.productSnapshot.name",
                productCode: "$items.productSnapshot.code",
              },

              totalPackages: {
                $sum: {
                  $ifNull: ["$items.quantity", 0],
                },
              },

              totalWeightGrams: {
                $sum: {
                  $ifNull: ["$items.totalWeightGrams", 0],
                },
              },

              ordersCount: {
                $sum: 1,
              },
            },
          },
          {
            $sort: {
              totalPackages: -1,
            },
          },
          {
            $limit: 5,
          },
        ])
        .toArray(),
    ]);

    const mappedRecentOrders = recentOrders.map(mapRecentOrder);

    const orderTotals = orderTotalsAggregation[0] || {
      totalPackages: 0,
      totalWeightGrams: 0,
    };

    const defaultStatusDistribution = {
      zaprimljena: 0,
      obrađena: 0,
      u_pripremi: 0,
      spremna_za_isporuku: 0,
      isporučena: 0,
    };

    const statusDistribution = statusDistributionAggregation.reduce(
      (result, item) => {
        if (item._id) {
          result[item._id] = item.count;
        }

        return result;
      },
      {
        ...defaultStatusDistribution,
      },
    );

    const monthlyOrders = monthlyOrdersAggregation.map((item) => ({
      year: item._id.year,
      month: item._id.month,
      ordersCount: item.ordersCount,
      totalPackages: item.totalPackages,
      totalWeightKg: Number(item.totalWeightGrams || 0) / 1000,
    }));

    const topCustomers = topCustomersAggregation.map((item) => ({
      customerId: item._id.customerId?.toString?.() || null,

      customerName: item._id.customerName || "Nepoznat kupac",

      ordersCount: item.ordersCount,
      totalPackages: item.totalPackages,
    }));

    const topProducts = topProductsAggregation.map((item) => ({
      productId: item._id.productId?.toString?.() || null,

      productName: item._id.productName || "Nepoznat proizvod",

      productCode: item._id.productCode || "",

      ordersCount: item.ordersCount,
      totalPackages: item.totalPackages,

      totalWeightKg: Number(item.totalWeightGrams || 0) / 1000,
    }));

    return res.status(200).json({
      success: true,

      data: {
        statistics: {
          totalOrders,
          activeOrders,
          deliveredOrders,
          dueToday,
          inPreparation,
          readyForDelivery,
          overdueOrders,

          totalPackages: orderTotals.totalPackages || 0,

          totalWeightKg: Number(
            (Number(orderTotals.totalWeightGrams || 0) / 1000).toFixed(2),
          ),
        },

        statusDistribution,
        monthlyOrders,
        topCustomers,
        topProducts,

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
