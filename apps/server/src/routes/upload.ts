import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { env } from "../config/env.js";
import { authRequired } from "../middleware/auth.js";

const uploadDir = path.resolve(process.cwd(), env.UPLOAD_DIR);
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_, __, cb) => {
    cb(null, uploadDir);
  },
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname);
    const safeExt = ext.replace(/[^a-zA-Z0-9.]/g, "");
    const name = `${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`;
    cb(null, name);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 200 * 1024 * 1024
  }
});

const router = Router();
router.use(authRequired);

router.post("/", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "Fayl topilmadi." });
  }

  const url = `/uploads/${req.file.filename}`;
  return res.status(201).json({
    url,
    fileName: req.file.originalname,
    fileMime: req.file.mimetype,
    fileSize: req.file.size
  });
});

export { router as uploadRouter };
