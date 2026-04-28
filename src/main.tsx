import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AppToaster } from "./helpers/Toast.tsx";
import { ThemeProvider } from "./helpers/Theme.tsx";
import "./App.css";

function detectPlatform(): "macos" | "windows" | "linux" | "unknown" {
  if (typeof navigator === "undefined") {
    return "unknown";
  }

  const userAgent = navigator.userAgent;
  if (/(Mac|iPhone|iPad|iPod)/i.test(userAgent)) {
    return "macos";
  }
  if (/Windows/i.test(userAgent)) {
    return "windows";
  }
  if (/Linux/i.test(userAgent)) {
    return "linux";
  }
  return "unknown";
}

const platform = detectPlatform();
document.documentElement.dataset.platform = platform;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
      <AppToaster />
    </ThemeProvider>
  </React.StrictMode>,
);
