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

// Patch Node.prototype.removeChild and insertBefore to prevent React reconciliation
// crashes when Google Maps API or third-party libraries manipulate DOM nodes.
(function () {
  const origRemove = Node.prototype.removeChild;
  Node.prototype.removeChild = function <T extends Node>(child: T): T {
    if (child.parentNode !== this) {
      if (child.parentNode) {
        return child.parentNode.removeChild(child) as T;
      }
      return child;
    }
    return origRemove.call(this, child) as T;
  };

  const origInsert = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function <T extends Node>(node: T, child: Node | null): T {
    if (child && child.parentNode !== this) {
      return this.appendChild(node) as T;
    }
    return origInsert.call(this, node, child) as T;
  };
})();

window.addEventListener("error", (e) => {
  const el = document.getElementById("root");
  if (el) {
    el.innerHTML = `<div style="position:fixed;inset:0;background:#111827;color:#f87171;padding:32px;font-family:monospace;font-size:14px;z-index:999999;overflow:auto;">
      <h2 style="color:#ef4444;margin-top:0">⚠️ UNHANDLED RUNTIME ERROR</h2>
      <p style="color:#fca5a5">Filename: ${e.filename}:${e.lineno}:${e.colno}</p>
      <pre style="white-space:pre-wrap;background:#1f2937;padding:16px;border-radius:8px;color:#fca5a5;">${e.error?.stack || e.message || String(e)}</pre>
    </div>`;
  }
});

window.addEventListener("unhandledrejection", (e) => {
  const el = document.getElementById("root");
  if (el) {
    const err = e.reason;
    el.innerHTML = `<div style="position:fixed;inset:0;background:#111827;color:#f87171;padding:32px;font-family:monospace;font-size:14px;z-index:999999;overflow:auto;">
      <h2 style="color:#ef4444;margin-top:0">⚠️ UNHANDLED PROMISE REJECTION</h2>
      <pre style="white-space:pre-wrap;background:#1f2937;padding:16px;border-radius:8px;color:#fca5a5;">${err?.stack || err?.message || String(err)}</pre>
    </div>`;
  }
});

import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.js";
import "./styles/theme.css";
import "./styles/global.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

createRoot(root).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
);
