  import { Buffer } from "buffer";
  import process from "process";

  window.Buffer = Buffer;
  window.process = process;
  window.global = window;

  import { StrictMode } from "react";
  import { createRoot } from "react-dom/client";
  import App from "./App";
  import "./index.css";

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>
  );