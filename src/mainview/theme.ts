import { useEffect } from "react";
import type { ThemePref } from "../shared/types";

export function useTheme(pref: ThemePref) {
	useEffect(() => {
		const mq = window.matchMedia("(prefers-color-scheme: dark)");
		const apply = () => {
			const dark = pref === "dark" || (pref === "auto" && mq.matches);
			document.documentElement.classList.toggle("dark", dark);
		};
		apply();
		if (pref !== "auto") return;
		mq.addEventListener("change", apply);
		return () => mq.removeEventListener("change", apply);
	}, [pref]);
}
