const orderExtractionSchema = {
  type: "object",
  additionalProperties: false,

  properties: {
    customerName: {
      type: "string",
    },

    customerOib: {
      type: "string",
    },

    orderNumber: {
      type: "string",
    },

    deliveryDate: {
      type: "string",
    },

    note: {
      type: "string",
    },

    items: {
      type: "array",

      items: {
        type: "object",
        additionalProperties: false,

        properties: {
          originalProductName: {
            type: "string",
          },

          customerProductCode: {
            type: "string",
          },

          customerBarcode: {
            type: "string",
          },

          quantity: {
            type: "integer",
          },
        },

        required: [
          "originalProductName",
          "customerProductCode",
          "customerBarcode",
          "quantity",
        ],
      },
    },
  },

  required: [
    "customerName",
    "customerOib",
    "orderNumber",
    "deliveryDate",
    "note",
    "items",
  ],
};

export default orderExtractionSchema;
