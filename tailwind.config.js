/** @type {import('tailwindcss').Config} */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
	darkMode: "class",
	content: ["./src/mainview/**/*.{html,js,ts,jsx,tsx}"],
	theme: {
		extend: {
			colors: {
				bg: token("bg"),
				"bg-2": token("bg-2"),
				surface: token("surface"),
				"surface-2": token("surface-2"),
				line: token("line"),
				ink: token("ink"),
				"ink-2": token("ink-2"),
				"ink-3": token("ink-3"),
				accent: token("accent"),
				"accent-ink": token("accent-ink"),
				warn: token("warn"),
				danger: token("danger"),
			},
			fontFamily: {
				sans: ['"Geist Variable"', "-apple-system", "BlinkMacSystemFont", "sans-serif"],
				mono: ['"Geist Mono Variable"', "ui-monospace", "SFMono-Regular", "monospace"],
			},
			transitionTimingFunction: {
				spring: "cubic-bezier(0.34, 1.36, 0.64, 1)",
				out: "cubic-bezier(0.22, 1, 0.36, 1)",
			},
		},
	},
	plugins: [],
};
