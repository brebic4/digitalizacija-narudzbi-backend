import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import auth from "../middleware/auth.js";
import openai from "../services/openai.js";
import orderExtractionPrompt from "../prompts/orderExtractionPrompt.js";
import orderExtractionSchema from "../schemas/orderExtractionSchema.js";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadsDirectory = path.join(__dirname, "..", "uploads", "orders");

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

    return res.status(200).json({
      success: true,
      message: "Podaci iz PDF narudžbe uspješno su izdvojeni.",

      data: {
        fileName: safeFileName,
        extraction: extractedOrder,

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
