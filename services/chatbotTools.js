import { getDatabase } from "../config/db.js";

const STATUS_LABELS = {
  zaprimljena: "Zaprimljena",
  obrađena: "Obrađena",
  u_pripremi: "U pripremi",
  spremna_za_isporuku: "Spremna za isporuku",
  isporučena: "Isporučena",
};

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

function getStartOfMonth(date = new Date()) {
  const result = new Date(date);
  result.setDate(1);
  result.setHours(0, 0, 0, 0);
  return result;
}

function mapOrder(order) {
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
    id: order._id.toString(),
    orderNumber: order.orderNumber,
    customerName: order.customerSnapshot?.name || "Nepoznat kupac",
    deliveryDate: order.deliveryDate,
    status: order.status,
    statusLabel: STATUS_LABELS[order.status] || order.status,
    itemsCount: items.length,
    totalPackages,
    totalWeightKg: Number((totalWeightGrams / 1000).toFixed(2)),
    createdAt: order.createdAt,
  };
}

export async function getOrderStatistics() {
  const db = getDatabase();
  const orders = db.collection("orders");

  const todayStart = getStartOfDay();
  const tomorrowStart = getStartOfNextDay();
  const monthStart = getStartOfMonth();

  const [
    totalOrders,
    activeOrders,
    deliveredOrders,
    overdueOrders,
    dueToday,
    createdThisMonth,
  ] = await Promise.all([
    orders.countDocuments({}),

    orders.countDocuments({
      status: {
        $ne: "isporučena",
      },
    }),

    orders.countDocuments({
      status: "isporučena",
    }),

    orders.countDocuments({
      deliveryDate: {
        $lt: todayStart,
      },
      status: {
        $ne: "isporučena",
      },
    }),

    orders.countDocuments({
      deliveryDate: {
        $gte: todayStart,
        $lt: tomorrowStart,
      },
      status: {
        $ne: "isporučena",
      },
    }),

    orders.countDocuments({
      createdAt: {
        $gte: monthStart,
      },
    }),
  ]);

  const statusAggregation = await orders
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
    .toArray();

  const statusDistribution = {
    zaprimljena: 0,
    obrađena: 0,
    u_pripremi: 0,
    spremna_za_isporuku: 0,
    isporučena: 0,
  };

  for (const item of statusAggregation) {
    if (item._id) {
      statusDistribution[item._id] = item.count;
    }
  }

  return {
    totalOrders,
    activeOrders,
    deliveredOrders,
    overdueOrders,
    dueToday,
    createdThisMonth,
    statusDistribution,
  };
}

export async function getRecentOrders({ limit = 5 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 5, 1), 10);

  const db = getDatabase();

  const orders = await db
    .collection("orders")
    .find({})
    .sort({
      createdAt: -1,
    })
    .limit(safeLimit)
    .toArray();

  return {
    orders: orders.map(mapOrder),
  };
}

export async function getOverdueOrders({ limit = 10 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 20);

  const db = getDatabase();
  const todayStart = getStartOfDay();

  const orders = await db
    .collection("orders")
    .find({
      deliveryDate: {
        $lt: todayStart,
      },
      status: {
        $ne: "isporučena",
      },
    })
    .sort({
      deliveryDate: 1,
    })
    .limit(safeLimit)
    .toArray();

  return {
    count: orders.length,
    orders: orders.map(mapOrder),
  };
}

export async function getOrdersDueToday({ limit = 10 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 20);

  const db = getDatabase();
  const todayStart = getStartOfDay();
  const tomorrowStart = getStartOfNextDay();

  const orders = await db
    .collection("orders")
    .find({
      deliveryDate: {
        $gte: todayStart,
        $lt: tomorrowStart,
      },
      status: {
        $ne: "isporučena",
      },
    })
    .sort({
      createdAt: 1,
    })
    .limit(safeLimit)
    .toArray();

  return {
    count: orders.length,
    orders: orders.map(mapOrder),
  };
}

export async function findOrderByNumber({ orderNumber }) {
  const normalizedOrderNumber = String(orderNumber || "").trim();

  if (!normalizedOrderNumber) {
    return {
      found: false,
      message: "Broj narudžbe nije naveden.",
    };
  }

  const db = getDatabase();

  const order = await db.collection("orders").findOne({
    orderNumber: normalizedOrderNumber,
  });

  if (!order) {
    return {
      found: false,
      orderNumber: normalizedOrderNumber,
    };
  }

  return {
    found: true,
    order: mapOrder(order),
  };
}

export async function getTopCustomers({ limit = 5 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 5, 1), 10);

  const db = getDatabase();

  const result = await db
    .collection("orders")
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
          ordersCount: -1,
          totalPackages: -1,
        },
      },
      {
        $limit: safeLimit,
      },
    ])
    .toArray();

  return {
    customers: result.map((item) => ({
      customerId: item._id.customerId?.toString?.() || null,
      customerName: item._id.customerName || "Nepoznat kupac",
      ordersCount: item.ordersCount,
      totalPackages: item.totalPackages,
      totalWeightKg: Number(
        (Number(item.totalWeightGrams || 0) / 1000).toFixed(2),
      ),
    })),
  };
}

export async function getTopProducts({ limit = 5 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 5, 1), 10);

  const db = getDatabase();

  const result = await db
    .collection("orders")
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
          ordersCount: {
            $sum: 1,
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
        },
      },
      {
        $sort: {
          totalPackages: -1,
        },
      },
      {
        $limit: safeLimit,
      },
    ])
    .toArray();

  return {
    products: result.map((item) => ({
      productId: item._id.productId?.toString?.() || null,
      productName: item._id.productName || "Nepoznat proizvod",
      productCode: item._id.productCode || "",
      ordersCount: item.ordersCount,
      totalPackages: item.totalPackages,
      totalWeightKg: Number(
        (Number(item.totalWeightGrams || 0) / 1000).toFixed(2),
      ),
    })),
  };
}

export async function getCustomerOrders({ customerName, limit = 10 }) {
  const normalizedName = String(customerName || "").trim();

  if (!normalizedName) {
    return {
      found: false,
      message: "Naziv kupca nije naveden.",
      orders: [],
    };
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 20);

  const escapedName = normalizedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const db = getDatabase();

  const orders = await db
    .collection("orders")
    .find({
      "customerSnapshot.name": {
        $regex: escapedName,
        $options: "i",
      },
    })
    .sort({
      createdAt: -1,
    })
    .limit(safeLimit)
    .toArray();

  return {
    found: orders.length > 0,
    searchedCustomer: normalizedName,
    count: orders.length,
    orders: orders.map(mapOrder),
  };
}

export const chatbotToolDefinitions = [
  {
    type: "function",
    name: "get_order_statistics",
    description:
      "Dohvaća ukupne statistike narudžbi, aktivne, isporučene, zakašnjele, današnje i raspodjelu statusa.",
    strict: true,
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_recent_orders",
    description: "Dohvaća posljednje unesene narudžbe.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 10,
        },
      },
      required: ["limit"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_overdue_orders",
    description:
      "Dohvaća narudžbe kojima je prošao rok isporuke, a još nisu isporučene.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 20,
        },
      },
      required: ["limit"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_orders_due_today",
    description: "Dohvaća narudžbe koje treba isporučiti danas.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 20,
        },
      },
      required: ["limit"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "find_order_by_number",
    description: "Pronalazi jednu narudžbu prema njezinu broju.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        orderNumber: {
          type: "string",
        },
      },
      required: ["orderNumber"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_top_customers",
    description:
      "Dohvaća najbolje kupce prema broju narudžbi i količini pakiranja.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 10,
        },
      },
      required: ["limit"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_top_products",
    description:
      "Dohvaća najnaručivanije proizvode prema ukupnom broju pakiranja.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 10,
        },
      },
      required: ["limit"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_customer_orders",
    description: "Dohvaća novije narudžbe kupca prema dijelu njegova naziva.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        customerName: {
          type: "string",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 20,
        },
      },
      required: ["customerName", "limit"],
      additionalProperties: false,
    },
  },
];

const toolHandlers = {
  get_order_statistics: getOrderStatistics,

  get_recent_orders: getRecentOrders,

  get_overdue_orders: getOverdueOrders,

  get_orders_due_today: getOrdersDueToday,

  find_order_by_number: findOrderByNumber,

  get_top_customers: getTopCustomers,

  get_top_products: getTopProducts,

  get_customer_orders: getCustomerOrders,
};

export async function executeChatbotTool(toolName, argumentsObject = {}) {
  const handler = toolHandlers[toolName];

  if (!handler) {
    throw new Error(`Nepoznat chatbot alat: ${toolName}`);
  }

  return handler(argumentsObject);
}
