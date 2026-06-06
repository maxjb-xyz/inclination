import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { applyInitialTheme } from "./theme/useTheme";

// Apply the persisted theme before the first paint to avoid a flash of the
// wrong color scheme.
applyInitialTheme();

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element #root not found");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
