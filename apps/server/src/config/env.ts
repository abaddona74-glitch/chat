import { config } from "dotenv";
import { z } from "zod";

config();

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  CLIENT_URL: z.string().min(1),
  PUBLIC_BASE_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16, "JWT_SECRET kamida 16 ta belgi bo'lishi kerak."),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().email(),
  EMAIL_CODE_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  RESET_CODE_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  ACCESS_TOKEN_TTL: z.string().min(2).optional(),
  UPLOAD_DIR: z.string().min(1).default("uploads"),
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  MOBILE_DEEP_LINK_URL: z.string().min(1).optional(),
  FIREBASE_SERVICE_ACCOUNT_JSON: z.string().min(1).optional(),
  FIREBASE_SERVICE_ACCOUNT_FILE: z.string().min(1).optional(),
  UPDATE_NOTIFY_TOKEN: z.string().min(12).optional()
});

export const env = envSchema.parse(process.env);
