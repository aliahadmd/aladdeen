import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [
		cloudflareTest(() => ({
			wrangler: { configPath: "./wrangler.json" },
			miniflare: { bindings: { RELEASE_SIZE_CHECK: "disabled" } },
		})),
	],
	test: {
		include: ["test/worker/**/*.spec.ts"],
	},
});
