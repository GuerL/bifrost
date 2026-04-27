import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AppToaster } from "./helpers/Toast.tsx";
import { ThemeProvider } from "./helpers/Theme.tsx";
import "./App.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
      <AppToaster />
    </ThemeProvider>
  </React.StrictMode>,
);
