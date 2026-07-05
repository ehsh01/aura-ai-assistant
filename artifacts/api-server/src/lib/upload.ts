import multer from "multer";
import { config } from "./config";

export const enexFileUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, config.uploadDir);
    },
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
      cb(null, `enex-${Date.now()}-${safe}`);
    },
  }),
  limits: { fileSize: config.uploadMaxBytes },
});

export const enexChunkUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.uploadChunkMaxBytes },
});
