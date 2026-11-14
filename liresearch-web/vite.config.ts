import { fileURLToPath, URL } from "node:url";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";

const releaseManifest = JSON.parse(
	readFileSync(
		new URL("./src/shared/release-manifest.json", import.meta.url),
		"utf8",
	),
) as { version: string; build: number };
const arm64Path = `/download/v${releaseManifest.version}/macos/arm64?build=${releaseManifest.build}`;

export default defineConfig({
	plugins: [
		{
			name: "liresearch-release-metadata",
			transformIndexHtml(html) {
				return html
					.replaceAll("__LIRESEARCH_VERSION__", releaseManifest.version)
					.replaceAll("__LIRESEARCH_ARM64_PATH__", arm64Path);
			},
		},
		react(),
		cloudflare(),
		tailwindcss(),
	],
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
		},
	},
});
