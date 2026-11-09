import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { App, RootError } from "./App";
import "./styles.css";

/**
 * A data router, so a page with unsaved work can hold back in-app navigation (useBlocker). The
 * route table itself stays in <App>, below this one catch-all route.
 */
const router = createBrowserRouter([{ path: "*", element: <App />, errorElement: <RootError /> }]);

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
