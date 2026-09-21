import { io, Socket } from "socket.io-client";

export function createSocket(token: string): Socket {
  return io({
    transports: ["websocket"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    randomizationFactor: 0.5,
    timeout: 20000,
    auth: {
      token,
      clientType: "web"
    }
  });
}
