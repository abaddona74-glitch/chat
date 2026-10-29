import { io, Socket } from "socket.io-client";
import { API_URL } from "./api";
import { getClientType } from "../platform/bridge";

export function createSocket(token: string, clientVersion?: string): Socket {
  return io(API_URL, {
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 800,
    reconnectionDelayMax: 3000,
    randomizationFactor: 0.3,
    timeout: 10000,
    auth: {
      token,
      clientType: getClientType(),
      clientVersion: clientVersion || "unknown"
    }
  });
}
