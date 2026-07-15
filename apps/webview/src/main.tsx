import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app.js";

const rootElement = document.getElementById("root");

if (rootElement === null) {
  throw new Error("Webview root element was not found.");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
