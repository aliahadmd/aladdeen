import { Hono } from "hono";

import {
	CURRENT_RELEASE,
	getReleaseArtifact,
	type ReleaseArtifact,
} from "../shared/releases";

const app = new Hono<{ Bindings: Env }>();

app.use("*", async (c, next) => {
	await next();
	c.header("Content-Security-Policy", [
		"default-src 'self'",
		"script-src 'self'",
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data:",
		"font-src 'self'",
		"connect-src 'self'",
		"object-src 'none'",
		"base-uri 'self'",
		"frame-ancestors 'none'",
		"form-action 'none'",
		"upgrade-insecure-requests",
	].join("; "));
	c.header("Cross-Origin-Opener-Policy", "same-origin");
	c.header("Cross-Origin-Resource-Policy", "same-origin");
	c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
	c.header("Referrer-Policy", "strict-origin-when-cross-origin");
	c.header("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
	c.header("X-Content-Type-Options", "nosniff");
	c.header("X-Frame-Options", "DENY");
});

export function releaseObjectMatchesManifest(
	object: Pick<R2Object, "size">,
	artifact: ReleaseArtifact,
): boolean {
	return object.size === artifact.byteSize;
}

function resolveRange(
	range: R2Range,
	totalSize: number,
): { offset: number; length: number } {
	const suffix = "suffix" in range ? range.suffix : undefined;
	if (typeof suffix === "number") {
		const length = Math.min(suffix, totalSize);
		return { offset: totalSize - length, length };
	}

	const offsetValue = "offset" in range ? range.offset : undefined;
	const lengthValue = "length" in range ? range.length : undefined;
	const offset = offsetValue ?? 0;
	const length = lengthValue ?? totalSize - offset;
	return { offset, length };
}

function createDownloadHeaders(
	object: R2Object,
	artifact: ReleaseArtifact,
): Headers {
	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set("Accept-Ranges", "bytes");
	headers.set("Cache-Control", "public, max-age=31536000, immutable");
	headers.set(
		"Content-Disposition",
		`attachment; filename="${artifact.filename}"`,
	);
	headers.set("Content-Type", "application/x-apple-diskimage");
	headers.set("ETag", object.httpEtag);
	headers.set("Last-Modified", object.uploaded.toUTCString());
	headers.set("X-Content-Type-Options", "nosniff");
	return headers;
}

function conditionalStatus(request: Request): 304 | 412 {
	return request.headers.has("If-None-Match") ||
		request.headers.has("If-Modified-Since")
		? 304
		: 412;
}

app.get("/api/health", (c) =>
	c.json({ status: "ok", release: CURRENT_RELEASE }),
);

app.on(
	["GET", "HEAD"],
	"/download/:version/macos/:architecture",
	async (c) => {
		const artifact = getReleaseArtifact(
			c.req.param("version"),
			c.req.param("architecture"),
		);

		if (!artifact) {
			return c.json({ error: "Download not found" }, 404);
		}

		const request = c.req.raw;
		const rateKey = `${artifact.r2Key}:${request.headers.get("CF-Connecting-IP") ?? "unknown"}`;
		const rateLimit = await c.env.DOWNLOAD_RATE_LIMITER.limit({ key: rateKey });
		if (!rateLimit.success) {
			return c.json(
				{ error: "Too many download requests. Try again shortly." },
				429,
				{ "Retry-After": "60" },
			);
		}

		const cacheable = request.method === "GET" &&
			!request.headers.has("Range") &&
			!request.headers.has("If-None-Match") &&
			!request.headers.has("If-Modified-Since");
		if (cacheable) {
			const cached = await caches.default.match(request);
			if (cached) return cached;
		}
		const options: R2GetOptions = { onlyIf: request.headers };

		if (request.method === "GET" && request.headers.has("Range")) {
			options.range = request.headers;
		}

		const object = await c.env.DOWNLOADS.get(artifact.r2Key, options);

		if (!object) {
			console.error(
				JSON.stringify({
					message: "Release object is missing",
					key: artifact.r2Key,
					route: new URL(request.url).pathname,
				}),
			);
			return c.json({ error: "Download temporarily unavailable" }, 404);
		}
		if (
			String(c.env.RELEASE_SIZE_CHECK) !== "disabled" &&
			!releaseObjectMatchesManifest(object, artifact)
		) {
			console.error(JSON.stringify({
				message: "Release object size does not match the signed manifest",
				key: artifact.r2Key,
				actualSize: object.size,
				expectedSize: artifact.byteSize,
			}));
			return c.json({ error: "Download temporarily unavailable" }, 503);
		}

		const headers = createDownloadHeaders(object, artifact);

		if (!("body" in object)) {
			headers.delete("Content-Length");
			return new Response(null, {
				status: conditionalStatus(request),
				headers,
			});
		}

		if (request.method === "HEAD") {
			headers.set("Content-Length", String(object.size));
			return new Response(null, { status: 200, headers });
		}

		if (request.headers.has("Range") && object.range) {
			const { offset, length } = resolveRange(object.range, object.size);
			headers.set("Content-Length", String(length));
			headers.set(
				"Content-Range",
				`bytes ${offset}-${offset + length - 1}/${object.size}`,
			);
			return new Response(object.body, { status: 206, headers });
		}

		headers.set("Content-Length", String(object.size));
		const response = new Response(object.body, { status: 200, headers });
		if (cacheable) c.executionCtx.waitUntil(caches.default.put(request, response.clone()));
		return response;
	},
);

app.all("/download/:version/macos/:architecture", (c) =>
	c.json(
		{ error: "Method not allowed" },
		405,
		{ Allow: "GET, HEAD" },
	),
);

app.onError((error, c) => {
	console.error(
		JSON.stringify({
			message: "Unhandled Worker error",
			error: error.message,
			method: c.req.method,
			route: c.req.path,
		}),
	);

	return c.json({ error: "Internal server error" }, 500);
});

export default app;
