import { createRoot, hydrateRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import App, { preloadPublicPage } from "./App.tsx";
import "./index.css";

// Force dark mode
document.documentElement.classList.add("dark");

const root = document.getElementById("root")!;
const app = (
  <HelmetProvider>
    <App />
  </HelmetProvider>
);

// Public pages arrive pre-rendered (scripts/prerender.mjs): attach to that HTML instead of
// replacing it. Everything else gets the empty app shell.
if (root.firstElementChild) preloadPublicPage(window.location.pathname).then(() => hydrateRoot(root, app));
else createRoot(root).render(app);
