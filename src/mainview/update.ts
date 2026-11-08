import { useEffect, useState } from "react";
import type { AppInfo } from "../shared/types";
import { applyUpdate } from "./rpc";

export type InstallState = "ready" | "installing" | "restarting" | "failed";

// Restart can take several seconds (unpack, swap, quit, reopen), so the
// button flips to "Installing…" the moment it's pressed and reports failure.
export function useUpdateInstall(info: AppInfo) {
	const [pressed, setPressed] = useState(false);
	const phase = info.updatePhase;

	useEffect(() => {
		if (phase === "ready" || phase === "error") setPressed(false);
	}, [phase, info.error]);

	const state: InstallState =
		phase === "restarting"
			? "restarting"
			: phase === "installing" || pressed
				? "installing"
				: info.error
					? "failed"
					: "ready";

	const install = () => {
		if (state === "installing" || state === "restarting") return;
		setPressed(true);
		applyUpdate()
			.catch(() => {})
			.finally(() => setPressed(false));
	};

	return { state, install };
}
