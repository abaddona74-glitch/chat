import { io, Socket } from "socket.io-client";
import { API_URL } from "./api";
import { getClientType } from "../platform/bridge";

export function createSocket(token: string, clientVersion?: string): Socket {
  return io(API_URL, {
    transports: ["websocket"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    randomizationFactor: 0.5,
    timeout: 20000,
    auth: {
      token,
      clientType: getClientType(),
      clientVersion: clientVersion || "unknown"
    }
  });
}
