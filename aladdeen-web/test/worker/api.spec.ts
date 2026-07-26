import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import {
	CURRENT_RELEASE,
	RELEASE_ARTIFACTS,
} from "../../src/shared/releases";
import { releaseObjectMatchesManifest } from "../../src/worker/index";

const testBody = "aladdeen-installer";
const arm64Url = `http://example.com${RELEASE_ARTIFACTS.arm64.downloadPath}`;

describe("Worker API", () => {
	beforeEach(async () => {
		await env.DOWNLOADS.put(
			RELEASE_ARTIFACTS.arm64.r2Key,
			testBody,
			{
				httpMetadata: {
					contentType: "application/x-apple-diskimage",
					contentDisposition: `attachment; filename="${RELEASE_ARTIFACTS.arm64.filename}"`,
					cacheControl: "public, max-age=31536000, immutable",
				},
			},
		);
	});

	it("returns the health payload", async () => {
		const response = await exports.default.fetch(
			"http://example.com/api/health",
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			status: "ok",
			release: CURRENT_RELEASE,
		});
	});

	it("rejects release objects whose byte size differs from the manifest", () => {
		expect(releaseObjectMatchesManifest(
			{ size: RELEASE_ARTIFACTS.arm64.byteSize },
			RELEASE_ARTIFACTS.arm64,
		)).toBe(true);
		expect(releaseObjectMatchesManifest(
			{ size: RELEASE_ARTIFACTS.arm64.byteSize - 1 },
			RELEASE_ARTIFACTS.arm64,
		)).toBe(false);
	});

	it("streams an allow-listed installer with download metadata", async () => {
		const response = await exports.default.fetch(arm64Url);

		expect(response.status).toBe(200);
		expect(
			new TextDecoder().decode(await response.arrayBuffer()),
		).toBe(testBody);
		expect(response.headers.get("content-type")).toBe(
			"application/x-apple-diskimage",
		);
		expect(response.headers.get("content-disposition")).toBe(
			`attachment; filename="${RELEASE_ARTIFACTS.arm64.filename}"`,
		);
		expect(response.headers.get("accept-ranges")).toBe("bytes");
		expect(response.headers.get("content-length")).toBe(
			String(testBody.length),
		);
		expect(response.headers.get("cache-control")).toContain("immutable");
		expect(response.headers.get("etag")).toBeTruthy();
		expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
		expect(response.headers.get("strict-transport-security")).toContain("max-age=63072000");
	});

	it("supports HEAD without returning a body", async () => {
		const response = await exports.default.fetch(
			new Request(arm64Url, { method: "HEAD" }),
		);

		expect(response.status).toBe(200);
		expect((await response.arrayBuffer()).byteLength).toBe(0);
		expect(response.headers.get("content-length")).toBe(
			String(testBody.length),
		);
	});

	it("supports byte-range downloads", async () => {
		const response = await exports.default.fetch(
			new Request(arm64Url, {
				headers: { Range: "bytes=2-5" },
			}),
		);

		expect(response.status).toBe(206);
		expect(
			new TextDecoder().decode(await response.arrayBuffer()),
		).toBe(testBody.slice(2, 6));
		expect(response.headers.get("content-range")).toBe(
			`bytes 2-5/${testBody.length}`,
		);
		expect(response.headers.get("content-length")).toBe("4");
	});

	it("honors conditional requests", async () => {
		const initial = await exports.default.fetch(arm64Url);
		const etag = initial.headers.get("etag");
		expect(etag).toBeTruthy();

		const response = await exports.default.fetch(
			new Request(arm64Url, {
				headers: { "If-None-Match": etag ?? "" },
			}),
		);

		expect(response.status).toBe(304);
		expect((await response.arrayBuffer()).byteLength).toBe(0);
	});

	it("returns 404 when an allow-listed object is missing", async () => {
		await env.DOWNLOADS.delete(RELEASE_ARTIFACTS.arm64.r2Key);
		const response = await exports.default.fetch(new Request(arm64Url, {
			headers: { Range: "bytes=0-1" },
		}));

		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({
			error: "Download temporarily unavailable",
		});
	});

	it("does not expose arbitrary versions or architectures", async () => {
		const wrongVersion = await exports.default.fetch(
			"http://example.com/download/v9.9.9/macos/arm64",
		);
		const wrongArchitecture = await exports.default.fetch(
			`http://example.com/download/v${CURRENT_RELEASE}/macos/universal`,
		);

		expect(wrongVersion.status).toBe(404);
		expect(wrongArchitecture.status).toBe(404);
	});

	it("returns 405 for unsupported methods", async () => {
		const response = await exports.default.fetch(
			new Request(arm64Url, { method: "POST" }),
		);

		expect(response.status).toBe(405);
		expect(response.headers.get("allow")).toBe("GET, HEAD");
	});
});
