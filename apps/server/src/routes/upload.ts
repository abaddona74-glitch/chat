import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import sharp from "sharp";
import { env } from "../config/env.js";
import { authRequired } from "../middleware/auth.js";

const uploadDir = path.resolve(process.cwd(), env.UPLOAD_DIR);
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_, __, cb) => {
    cb(null, uploadDir);
  },
  filename: (_, file, cb) => {
    const rawExt = path.extname(file.originalname).toLowerCase();
    const safeExt = rawExt.replace(/[^a-z0-9._-]/g, "");
    const name = `${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt || ""}`;
    cb(null, name);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 500 * 1024 * 1024 // 500MB gacha ruxsat
  }
});

const router = Router();
router.use(authRequired);

router.post("/", (req, res) => {
  upload.single("file")(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ message: err.message || "Fayl yuklashda xatolik." });
    }

    if (!req.file) {
      return res.status(400).json({ message: "Fayl topilmadi." });
    }

    const originalFilename = req.file.filename;
    const url = `/uploads/${originalFilename}`;
    let thumbUrl: string | undefined;

    // Agar rasm bo'lsa (JPEG, PNG, WEBP), tezkor thumbnail yaratamiz
    const mime = (req.file.mimetype || "").toLowerCase();
    if (mime.startsWith("image/") && !mime.includes("svg") && !mime.includes("gif")) {
      try {
        const thumbFilename = `${path.parse(originalFilename).name}_thumb.webp`;
        const thumbPath = path.join(uploadDir, thumbFilename);

        await sharp(req.file.path)
          .rotate() // EXIF orientation bo'yicha to'g'irlash
          .resize(320, 320, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: 80 })
          .toFile(thumbPath);

        thumbUrl = `/uploads/${thumbFilename}`;
      } catch (error) {
        console.error("Thumbnail yaratishda xatolik:", error);
      }
    }

    return res.status(201).json({
      url,
      thumbUrl: thumbUrl || url,
      fileName: req.file.originalname,
      fileMime: req.file.mimetype,
      fileSize: req.file.size
    });
  });
});

export { router as uploadRouter };
