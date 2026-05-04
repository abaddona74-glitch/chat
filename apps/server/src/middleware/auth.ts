import { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../lib/auth.js";

export function authRequired(req: Request, res: Response, next: NextFunction) {
  const authorization = req.headers.authorization;
  if (!authorization || !authorization.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Authorization token topilmadi." });
  }

  const token = authorization.split(" ")[1];

  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.userId, email: payload.email };
    next();
  } catch {
    return res.status(401).json({ message: "Token noto'g'ri yoki eskirgan." });
  }
}
