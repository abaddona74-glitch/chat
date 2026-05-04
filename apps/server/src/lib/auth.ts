import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

const ACCESS_TOKEN_TTL = (env.ACCESS_TOKEN_TTL ?? "30d") as jwt.SignOptions["expiresIn"];
const TEMP_2FA_TOKEN_TTL = "10m";

type AccessPayload = {
  userId: string;
  email: string;
  type: "access";
};

type TwoFATempPayload = {
  userId: string;
  email: string;
  type: "2fa";
};

export async function hashPassword(rawPassword: string) {
  return bcrypt.hash(rawPassword, 10);
}

export async function comparePassword(rawPassword: string, hash: string) {
  return bcrypt.compare(rawPassword, hash);
}

export function signAccessToken(userId: string, email: string) {
  const payload: AccessPayload = { userId, email, type: "access" };
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
}

export function verifyAccessToken(token: string) {
  const payload = jwt.verify(token, env.JWT_SECRET) as AccessPayload;
  if (payload.type !== "access") {
    throw new Error("Invalid token type");
  }
  return payload;
}

export function signTwoFATempToken(userId: string, email: string) {
  const payload: TwoFATempPayload = { userId, email, type: "2fa" };
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: TEMP_2FA_TOKEN_TTL });
}

export function verifyTwoFATempToken(token: string) {
  const payload = jwt.verify(token, env.JWT_SECRET) as TwoFATempPayload;
  if (payload.type !== "2fa") {
    throw new Error("Invalid token type");
  }
  return payload;
}
