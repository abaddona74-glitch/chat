import nodemailer from "nodemailer";
import { env } from "../config/env.js";

let transporter: nodemailer.Transporter | null = null;

async function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: false,
      auth:
        env.SMTP_USER && env.SMTP_PASS
          ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
          : undefined
    });
  }
  return transporter;
}

async function sendMail(to: string, subject: string, text: string) {
  const t = await getTransporter();
  await t.sendMail({
    from: env.SMTP_FROM,
    to,
    subject,
    text
  });
}

export async function sendVerificationEmail(email: string, code: string) {
  const text =
    "Chat Desktop tasdiqlash kodingiz: " +
    code +
    "\nKod " +
    env.EMAIL_CODE_TTL_MINUTES +
    " daqiqa davomida amal qiladi.";

  await sendMail(email, "Tasdiqlash kodi", text);
}

export async function sendResetPasswordEmail(email: string, code: string) {
  const text =
    "Parolni tiklash kodingiz: " +
    code +
    "\nKod " +
    env.RESET_CODE_TTL_MINUTES +
    " daqiqa davomida amal qiladi.";

  await sendMail(email, "Parolni tiklash", text);
}
