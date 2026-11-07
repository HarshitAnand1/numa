import React from "react";
import ReactDOM from "react-dom/client";
import { NumaProvider } from "@numa/sdk-react";
import App from "./App";
import "./shop.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <NumaProvider rpcUrl={import.meta.env.VITE_RPC_URL}>
      <App />
    </NumaProvider>
  </React.StrictMode>,
);
