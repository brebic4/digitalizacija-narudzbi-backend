import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getDatabase } from "../config/db.js";

import auth from "../middleware/auth.js";
import openai from "../services/openai.js";
import orderExtractionPrompt from "../prompts/orderExtractionPrompt.js";
import orderExtractionSchema from "../schemas/orderExtractionSchema.js";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadsDirectory = path.join(__dirname, "..", "uploads", "orders");
const warnings = [];

function normalizeText(value = "") {
  return value
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizeNumericCode(value = "") {
  return value.toString().replace(/\D/g, "");
}

function mapProductForMatch(product) {
  return {
    productId: product._id.toString(),
    name: product.name,
    code: product.code,
    barcode: product.barcode,
    packageWeightGrams: product.packageWeightGrams,
    unit: product.unit,
  };
}

function findMatchingProduct(extractedItem, products) {
  const extractedBarcode = normalizeNumericCode(extractedItem.customerBarcode);

  const extractedCode = normalizeText(extractedItem.customerProductCode);

  const extractedName = normalizeText(extractedItem.originalProductName);

  if (extractedBarcode) {
    const barcodeMatch = products.find((product) => {
      return normalizeNumericCode(product.barcode) === extractedBarcode;
    });

    if (barcodeMatch) {
      return {
        matched: true,
        matchMethod: "barcode",
        confidence: 1,
        product: mapProductForMatch(barcodeMatch),
      };
    }
  }

  if (extractedCode) {
    const codeMatch = products.find((product) => {
      return normalizeText(product.code) === extractedCode;
    });

    if (codeMatch) {
      return {
        matched: true,
        matchMethod: "code",
        confidence: 1,
        product: mapProductForMatch(codeMatch),
      };
    }
  }

  if (extractedName) {
    const nameMatch = products.find((product) => {
      return normalizeText(product.name) === extractedName;
    });

    if (nameMatch) {
      return {
        matched: true,
        matchMethod: "exact_name",
        confidence: 1,
        product: mapProductForMatch(nameMatch),
      };
    }
  }

  return {
    matched: false,
    matchMethod: null,
    confidence: 0,
    product: null,
  };
}

router.get("/health", auth, async (req, res) => {
  return res.json({
    success: true,
    message: "AI modul je spreman.",
  });
});

router.get("/test", auth, async (req, res) => {
  try {
    const response = await openai.responses.create({
      model: process.env.OPENAI_MODEL,
      input: "Vrati samo ovu rečenicu: OpenAI API uspješno radi.",
    });

    return res.status(200).json({
      success: true,
      message: "OpenAI API poziv uspješno je izvršen.",
      data: {
        output: response.output_text,
      },
    });
  } catch (error) {
    console.error("Greška pri testiranju OpenAI API-ja:", error);

    if (error.status === 401) {
      return res.status(401).json({
        success: false,
        message: "OpenAI API ključ nije ispravan.",
      });
    }

    if (error.status === 429) {
      return res.status(429).json({
        success: false,
        message:
          "OpenAI API nema dostupnu kvotu ili naplata još nije aktivirana.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "OpenAI API poziv nije uspio.",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

router.post("/extract-order", auth, async (req, res) => {
  let openaiFileId = null;

  try {
    const { fileName } = req.body ?? {};

    if (typeof fileName !== "string" || !fileName.trim()) {
      return res.status(400).json({
        success: false,
        message: "Naziv PDF datoteke je obavezan.",
      });
    }

    const normalizedFileName = fileName.trim();
    const safeFileName = path.basename(normalizedFileName);

    if (safeFileName !== normalizedFileName) {
      return res.status(400).json({
        success: false,
        message: "Naziv PDF datoteke nije ispravan.",
      });
    }

    if (path.extname(safeFileName).toLowerCase() !== ".pdf") {
      return res.status(400).json({
        success: false,
        message: "Dozvoljena je obrada samo PDF datoteka.",
      });
    }

    const filePath = path.join(uploadsDirectory, safeFileName);

    try {
      await fs.promises.access(filePath, fs.constants.R_OK);
    } catch {
      return res.status(404).json({
        success: false,
        message: "PDF datoteka nije pronađena.",
      });
    }

    if (!process.env.OPENAI_MODEL) {
      return res.status(500).json({
        success: false,
        message: "OpenAI model nije konfiguriran.",
      });
    }

    const uploadedFile = await openai.files.create({
      file: fs.createReadStream(filePath),
      purpose: "user_data",

      expires_after: {
        anchor: "created_at",
        seconds: 3600,
      },
    });

    openaiFileId = uploadedFile.id;

    const response = await openai.responses.create({
      model: process.env.OPENAI_MODEL,

      input: [
        {
          role: "user",

          content: [
            {
              type: "input_file",
              file_id: uploadedFile.id,
            },

            {
              type: "input_text",
              text: orderExtractionPrompt,
            },
          ],
        },
      ],

      text: {
        format: {
          type: "json_schema",
          name: "order_extraction",
          description: "Strukturirani podaci izdvojeni iz PDF narudžbe.",
          strict: true,
          schema: orderExtractionSchema,
        },
      },
    });

    if (!response.output_text) {
      return res.status(502).json({
        success: false,
        message: "OpenAI nije vratio podatke iz PDF narudžbe.",
      });
    }

    let extractedOrder;

    try {
      extractedOrder = JSON.parse(response.output_text);
    } catch (parseError) {
      console.error("OpenAI odgovor nije ispravan JSON:", response.output_text);

      return res.status(502).json({
        success: false,
        message: "OpenAI je vratio odgovor koji nije moguće obraditi.",
      });
    }

    const db = getDatabase();

    const customersCollection = db.collection("customers");
    const productsCollection = db.collection("products");

    const normalizedCustomerOib = normalizeNumericCode(
      extractedOrder.customerOib,
    );

    let matchedCustomer = null;
    let customerMatchMethod = null;

    if (normalizedCustomerOib) {
      matchedCustomer = await customersCollection.findOne({
        oib: normalizedCustomerOib,
      });

      if (matchedCustomer) {
        customerMatchMethod = "oib";
      }
    }

    if (!matchedCustomer && extractedOrder.customerName) {
      const customers = await customersCollection.find({}).toArray();

      const normalizedExtractedCustomerName = normalizeText(
        extractedOrder.customerName,
      );

      matchedCustomer = customers.find((customer) => {
        return normalizeText(customer.name) === normalizedExtractedCustomerName;
      });

      if (matchedCustomer) {
        customerMatchMethod = "exact_name";
      }
    }

    if (!matchedCustomer) {
      warnings.push({
        type: "customer_not_found",
        severity: "warning",
        message: "Kupac nije pronađen u bazi.",
      });
    }

    const activeProducts = await productsCollection
      .find({
        active: {
          $ne: false,
        },
      })
      .toArray();

    const matchedItems = extractedOrder.items.map((item) => {
      const match = findMatchingProduct(item, activeProducts);

      return {
        ...item,

        matched: match.matched,
        matchMethod: match.matchMethod,
        confidence: match.confidence,

        productId: match.product?.productId ?? null,

        matchedProduct: match.product,
      };
    });

    matchedItems.forEach((item, index) => {
      if (!item.matched) {
        warnings.push({
          type: "product_not_found",
          severity: "warning",
          itemIndex: index,
          productName: item.originalProductName,
          message: `Proizvod "${item.originalProductName}" nije pronađen u bazi.`,
        });
      }
    });

    if (matchedItems.length === 0) {
      warnings.push({
        type: "no_items_detected",
        severity: "error",
        message: "AI nije pronašao nijednu stavku narudžbe.",
      });
    }

    const matchedItemsCount = matchedItems.filter(
      (item) => item.matched,
    ).length;

    const unmatchedItemsCount = matchedItems.length - matchedItemsCount;

    const canCreateOrder =
      Boolean(matchedCustomer) &&
      matchedItems.length > 0 &&
      unmatchedItemsCount === 0;

    if (!canCreateOrder) {
      warnings.push({
        type: "manual_review_required",
        severity: "warning",
        message: "Prije spremanja potrebno je ručno pregledati podatke.",
      });
    }

    const confidenceSummary = {
      customerMatched: Boolean(matchedCustomer),

      productMatchingRate:
        matchedItems.length === 0
          ? 0
          : Number((matchedItemsCount / matchedItems.length).toFixed(2)),
    };

    const orderDraft = canCreateOrder
      ? {
          customerId: matchedCustomer._id.toString(),

          orderNumber: extractedOrder.orderNumber,

          deliveryDate: extractedOrder.deliveryDate,

          items: matchedItems.map((item) => ({
            productId: item.productId,

            customerProductCode: item.customerProductCode,

            customerBarcode: item.customerBarcode,

            originalProductName: item.originalProductName,

            quantity: item.quantity,
          })),

          note: extractedOrder.note,
        }
      : null;

    return res.status(200).json({
      success: true,
      message:
        "Podaci iz PDF narudžbe uspješno su izdvojeni i povezani s bazom.",

      data: {
        fileName: safeFileName,

        extraction: {
          ...extractedOrder,

          customerMatch: {
            matched: Boolean(matchedCustomer),
            matchMethod: customerMatchMethod,

            customer: matchedCustomer
              ? {
                  customerId: matchedCustomer._id.toString(),

                  name: matchedCustomer.name,
                  oib: matchedCustomer.oib,
                }
              : null,
          },

          items: matchedItems,
        },

        matchingSummary: {
          customerMatched: Boolean(matchedCustomer),
          totalItems: matchedItems.length,
          matchedItems: matchedItemsCount,
          unmatchedItems: unmatchedItemsCount,
          allItemsMatched: matchedItems.length > 0 && unmatchedItemsCount === 0,
        },

        canCreateOrder,
        orderDraft,
        warnings,
        confidenceSummary,

        usage: response.usage
          ? {
              inputTokens: response.usage.input_tokens ?? null,

              outputTokens: response.usage.output_tokens ?? null,

              totalTokens: response.usage.total_tokens ?? null,
            }
          : null,
      },
    });
  } catch (error) {
    console.error("Greška pri AI ekstrakciji narudžbe:", error);

    if (error.status === 401) {
      return res.status(502).json({
        success: false,
        message: "OpenAI API ključ nije ispravan.",
      });
    }

    if (error.status === 429) {
      return res.status(503).json({
        success: false,
        message:
          "OpenAI API trenutno nema dostupnu kvotu ili je dosegnut limit.",
      });
    }

    if (error.status === 400) {
      return res.status(400).json({
        success: false,
        message:
          error.message || "PDF nije moguće obraditi pomoću OpenAI API-ja.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Dogodila se greška pri AI obradi PDF narudžbe.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    if (openaiFileId) {
      try {
        await openai.files.delete(openaiFileId);
      } catch (deleteError) {
        console.error("Privremena OpenAI datoteka nije obrisana:", deleteError);
      }
    }
  }
});

export default router;
