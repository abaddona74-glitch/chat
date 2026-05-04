import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.chatapp.mobile",
  appName: "Chat Mobile",
  webDir: "dist",
  bundledWebRuntime: false,
  plugins: {
    LocalNotifications: {
      smallIcon: "ic_stat_call",
      iconColor: "#22c55e",
    },
  },
  server: {
    cleartext: false,
  },
};

export default config;
