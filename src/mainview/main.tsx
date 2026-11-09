import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./index.css";
import App from "./App";
import { electroview } from "./rpc";

void electroview;

// WebKit's own right-click menu (Reload, Inspect Element) has nothing for
// people using the app, so it's off everywhere. Copy and paste still work
// from the keyboard.
document.addEventListener("contextmenu", (e) => e.preventDefault());

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
