import type { RPCSchema } from "electrobun/bun";

export type JigglerStatus = {
	enabled: boolean;
	lastActionAt: number | null;
	nextActionAt: number | null;
	actionCount: number;
};

export type JigglerRPC = {
	bun: RPCSchema<{
		requests: {
			setEnabled: { params: { enabled: boolean }; response: JigglerStatus };
			getStatus: { params: {}; response: JigglerStatus };
			triggerNow: { params: {}; response: JigglerStatus };
		};
		messages: {};
	}>;
	webview: RPCSchema<{
		requests: {};
		messages: {
			statusChanged: JigglerStatus;
		};
	}>;
};
