import axios from "axios";

export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
const TOKEN_KEY = "chat_token";

export const api = axios.create({
  baseURL: API_URL
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401) {
      const message = error.response.data?.message;
      if (
        !message ||
        message.includes("Token") ||
        message.includes("token") ||
        message.includes("eskirgan") ||
        message.includes("topilmadi")
      ) {
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("chat:auth:expired", { detail: { message } })
          );
        }
      }
    }
    return Promise.reject(error);
  }
);

export function persistToken(token: string | null) {
  if (!token) {
    localStorage.removeItem(TOKEN_KEY);
    return;
  }
  localStorage.setItem(TOKEN_KEY, token);
}

export function readPersistedToken() {
  return localStorage.getItem(TOKEN_KEY);
}
