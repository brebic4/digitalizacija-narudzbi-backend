import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import auth from "../middleware/auth.js";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadsDirectory = path.join(__dirname, "..", "uploads", "orders");

fs.mkdirSync(uploadsDirectory, {
  recursive: true,
});

function sanitizeFileName(fileName) {
  return fileName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_");
}

const storage = multer.diskStorage({
  destination(req, file, callback) {
    callback(null, uploadsDirectory);
  },

  filename(req, file, callback) {
    const originalName = sanitizeFileName(path.parse(file.originalname).name);

    const uniqueSuffix = `${Date.now()}-${Math.round(
      Math.random() * 1_000_000_000,
    )}`;

    callback(null, `${uniqueSuffix}-${originalName}.pdf`);
  },
});

function fileFilter(req, file, callback) {
  const isPdfMimeType = file.mimetype === "application/pdf";

  const isPdfExtension =
    path.extname(file.originalname).toLowerCase() === ".pdf";

  if (!isPdfMimeType || !isPdfExtension) {
    return callback(new Error("Dozvoljene su samo PDF datoteke."));
  }

  return callback(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 1,
  },
});

router.post("/order-pdf", auth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "PDF datoteka nije poslana.",
      });
    }

    return res.status(201).json({
      success: true,
      message: "PDF narudžba uspješno je učitana.",
      data: {
        originalName: req.file.originalname,
        fileName: req.file.filename,
        mimeType: req.file.mimetype,
        size: req.file.size,
        sizeMb: Number((req.file.size / 1024 / 1024).toFixed(2)),
        url: `/uploads/orders/${req.file.filename}`,
      },
    });
  } catch (error) {
    console.error("Greška pri uploadu PDF-a:", error);

    return res.status(500).json({
      success: false,
      message: "Dogodila se greška pri učitavanju PDF datoteke.",
    });
  }
});

router.delete("/order-pdf/:fileName", auth, async (req, res) => {
  try {
    const { fileName } = req.params;

    const safeFileName = path.basename(fileName);

    if (safeFileName !== fileName) {
      return res.status(400).json({
        success: false,
        message: "Naziv PDF datoteke nije ispravan.",
      });
    }

    if (path.extname(safeFileName).toLowerCase() !== ".pdf") {
      return res.status(400).json({
        success: false,
        message: "Dozvoljeno je brisanje samo PDF datoteka.",
      });
    }

    const filePath = path.join(uploadsDirectory, safeFileName);

    try {
      await fs.promises.access(filePath);
    } catch {
      return res.status(404).json({
        success: false,
        message: "PDF datoteka nije pronađena.",
      });
    }

    await fs.promises.unlink(filePath);

    return res.status(200).json({
      success: true,
      message: "PDF datoteka uspješno je obrisana.",
      data: {
        fileName: safeFileName,
      },
    });
  } catch (error) {
    console.error("Greška pri brisanju PDF-a:", error);

    return res.status(500).json({
      success: false,
      message: "Dogodila se greška pri brisanju PDF datoteke.",
    });
  }
});

//obrada grešaka
router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        success: false,
        message: "PDF datoteka ne smije biti veća od 10 MB.",
      });
    }

    if (error.code === "LIMIT_UNEXPECTED_FILE") {
      return res.status(400).json({
        success: false,
        message: 'Dozvoljena je samo jedna datoteka u polju "file".',
      });
    }

    return res.status(400).json({
      success: false,
      message: `Greška pri uploadu: ${error.message}`,
    });
  }

  if (error.message === "Dozvoljene su samo PDF datoteke.") {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }

  return next(error);
});

export default router;
