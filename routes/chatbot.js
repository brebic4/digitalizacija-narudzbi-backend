import express from "express";

import auth from "../middleware/auth.js";
import openai from "../services/openai.js";

import {
  chatbotToolDefinitions,
  executeChatbotTool,
  getOrderStatistics,
  getOrdersDueToday,
  getOverdueOrders,
  getRecentOrders,
  getTopCustomers,
  getTopProducts,
} from "../services/chatbotTools.js";

const router = express.Router();

router.use(auth);

const MAX_MESSAGE_LENGTH = 1000;
const MAX_HISTORY_ITEMS = 10;
const MAX_TOOL_ITERATIONS = 4;

function buildChatbotInstructions() {
  const currentDate = new Intl.DateTimeFormat("hr-HR", {
    dateStyle: "full",
    timeZone: "Europe/Zagreb",
  }).format(new Date());

  return `
Ti si poslovni AI asistent web-aplikacije Pršutane Barić.

Današnji datum je: ${currentDate}.

Tvoj zadatak je odgovarati zaposlenicima na pitanja o:
- narudžbama
- rokovima isporuke
- statusima narudžbi
- kupcima
- najnaručivanijim proizvodima
- poslovnim statistikama dostupnima kroz alate

Pravila:
1. Odgovaraj isključivo na hrvatskom jeziku.
2. Za sva pitanja o stvarnim podacima iz sustava moraš koristiti dostupne alate.
3. Nikada ne izmišljaj broj narudžbi, kupca, proizvod, količinu, datum ili status.
4. Ako traženi podatak nije dostupan, jasno reci da ga nije moguće pronaći.
5. Nemoj tvrditi da si izmijenio, dodao ili obrisao podatke jer imaš samo pristup čitanju.
6. Odgovori trebaju biti jasni, sažeti i prikladni zaposlenicima proizvodnog poduzeća.
7. Kada prikazuješ više narudžbi, koristi pregledan numerirani popis.
8. Datume prikazuj u hrvatskom obliku, primjerice 06. 08. 2026.
9. Nemoj korisniku spominjati interne nazive alata, funkcija, JSON ili tehničku implementaciju.
10. Ako je pitanje nevezano uz poslovne podatke aplikacije, ljubazno objasni da možeš pomoći s podacima o narudžbama, kupcima i proizvodima.
`.trim();
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .slice(-MAX_HISTORY_ITEMS)
    .filter((item) => {
      return (
        item &&
        ["user", "assistant"].includes(item.role) &&
        typeof item.content === "string" &&
        item.content.trim()
      );
    })
    .map((item) => ({
      role: item.role,
      content: item.content.trim().slice(0, 2000),
    }));
}

function parseToolArguments(argumentsText) {
  if (!argumentsText) {
    return {};
  }

  try {
    return JSON.parse(argumentsText);
  } catch {
    throw new Error("Chatbot je vratio neispravne argumente za poslovni alat.");
  }
}

function addUsage(totalUsage, usage) {
  if (!usage) {
    return totalUsage;
  }

  return {
    inputTokens: totalUsage.inputTokens + Number(usage.input_tokens || 0),

    outputTokens: totalUsage.outputTokens + Number(usage.output_tokens || 0),

    totalTokens: totalUsage.totalTokens + Number(usage.total_tokens || 0),
  };
}

// GET /api/chatbot/tools-test
// Privremeni endpoint za zasebno testiranje poslovnih alata
router.get("/tools-test", async (req, res) => {
  try {
    const [
      statistics,
      recentOrders,
      overdueOrders,
      dueToday,
      topCustomers,
      topProducts,
    ] = await Promise.all([
      getOrderStatistics(),

      getRecentOrders({
        limit: 5,
      }),

      getOverdueOrders({
        limit: 10,
      }),

      getOrdersDueToday({
        limit: 10,
      }),

      getTopCustomers({
        limit: 5,
      }),

      getTopProducts({
        limit: 5,
      }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        statistics,
        recentOrders,
        overdueOrders,
        dueToday,
        topCustomers,
        topProducts,
      },
    });
  } catch (error) {
    console.error("Greška pri testiranju chatbot alata:", error);

    return res.status(500).json({
      success: false,
      message: "Chatbot poslovne alate nije moguće testirati.",
    });
  }
});

// POST /api/chatbot/message
// Slanje poruke poslovnom AI chatbotu
router.post("/message", async (req, res) => {
  try {
    const { message, history = [] } = req.body ?? {};

    if (typeof message !== "string" || !message.trim()) {
      return res.status(400).json({
        success: false,
        message: "Poruka je obavezna.",
      });
    }

    const normalizedMessage = message.trim();

    if (normalizedMessage.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({
        success: false,
        message: `Poruka ne smije sadržavati više od ${MAX_MESSAGE_LENGTH} znakova.`,
      });
    }

    if (!process.env.OPENAI_MODEL) {
      return res.status(500).json({
        success: false,
        message: "OpenAI model nije konfiguriran.",
      });
    }

    const normalizedHistory = normalizeHistory(history);

    const initialInput = [
      ...normalizedHistory,
      {
        role: "user",
        content: normalizedMessage,
      },
    ];

    let usage = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    };

    const toolsUsed = [];

    let response = await openai.responses.create({
      model: process.env.OPENAI_MODEL,

      instructions: buildChatbotInstructions(),

      input: initialInput,

      tools: chatbotToolDefinitions,
      tool_choice: "auto",
      parallel_tool_calls: true,

      max_output_tokens: 700,
      store: true,
    });

    usage = addUsage(usage, response.usage);

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
      const functionCalls = response.output.filter((item) => {
        return item.type === "function_call";
      });

      // Model je završio bez dodatnih alata
      if (functionCalls.length === 0) {
        const answer = response.output_text?.trim();

        if (!answer) {
          return res.status(502).json({
            success: false,
            message: "Chatbot nije vratio tekstualni odgovor.",
          });
        }

        return res.status(200).json({
          success: true,
          message: "Chatbot je uspješno odgovorio.",

          data: {
            answer,
            toolsUsed: [...new Set(toolsUsed)],
            usage,
          },
        });
      }

      const toolOutputs = [];

      for (const functionCall of functionCalls) {
        try {
          const argumentsObject = parseToolArguments(functionCall.arguments);

          const toolResult = await executeChatbotTool(
            functionCall.name,
            argumentsObject,
          );

          toolsUsed.push(functionCall.name);

          toolOutputs.push({
            type: "function_call_output",
            call_id: functionCall.call_id,
            output: JSON.stringify(toolResult),
          });
        } catch (toolError) {
          console.error(
            `Greška pri izvršavanju alata ${functionCall.name}:`,
            toolError,
          );

          toolOutputs.push({
            type: "function_call_output",
            call_id: functionCall.call_id,

            output: JSON.stringify({
              success: false,
              error: "Tražene poslovne podatke trenutno nije moguće dohvatiti.",
            }),
          });
        }
      }

      response = await openai.responses.create({
        model: process.env.OPENAI_MODEL,

        // Kod nastavka preko previous_response_id
        // ponovno šaljemo upute.
        instructions: buildChatbotInstructions(),

        previous_response_id: response.id,

        input: toolOutputs,

        tools: chatbotToolDefinitions,
        tool_choice: "auto",
        parallel_tool_calls: true,

        max_output_tokens: 700,
        store: true,
      });

      usage = addUsage(usage, response.usage);
    }

    return res.status(502).json({
      success: false,
      message: "Chatbot nije uspio završiti obradu pitanja.",
    });
  } catch (error) {
    console.error("Greška pri obradi chatbot poruke:", error);

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
        message: error.message || "Chatbot poruku nije moguće obraditi.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Dogodila se greška pri obradi chatbot poruke.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

export default router;
