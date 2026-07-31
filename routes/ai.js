import express from "express";
import auth from "../middleware/auth.js";
import openai from "../services/openai.js";

const router = express.Router();

router.get("/health", auth, async (req, res) => {
  return res.json({
    success: true,
    message: "AI modul je spreman.",
  });
});

router.get("/test", auth, async (req, res) => {
  try {
    const response = await openai.responses.create({
      model: "gpt-5.6-terra",
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

export default router;
