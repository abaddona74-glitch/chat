import { io, Socket } from "socket.io-client";
import { API_URL } from "./api";
import { getClientType } from "../platform/bridge";

export function createSocket(token: string, clientVersion?: string): Socket {
  return io(API_URL, {
    transports: ["websocket"],
    auth: {
      token,
      clientType: getClientType(),
      clientVersion: clientVersion || "unknown"
    }
  });
}
