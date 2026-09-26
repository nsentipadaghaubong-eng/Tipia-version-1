import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initializeDatabase } from "./database/database";

initializeDatabase()
  .then(() => {
    ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  })
  .catch((error) => {
    console.error("Database initialization failed:", error);
  });