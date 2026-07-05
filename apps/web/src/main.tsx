// Intercept canvas getContext to force preserveDrawingBuffer for WebGL.
// This allows html2canvas to capture the Google Maps WebGL layer without rendering a blank screen.
(function () {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, contextId: string, options?: any) {
    if (contextId === "webgl" || contextId === "webgl2") {
      options = options || {};
      options.preserveDrawingBuffer = true;
    }
    return originalGetContext.call(this, contextId, options);
  } as any;
})();

import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.js";
import "./styles/theme.css";
import "./styles/global.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

createRoot(root).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
