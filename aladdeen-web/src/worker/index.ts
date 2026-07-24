import { Hono } from "hono";

import {
	CURRENT_RELEASE,
	getReleaseArtifact,
	type ReleaseArtifact,
} from "../shared/releases";

const app = new Hono<{ Bindings: Env }>();

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
		return new Response(object.body, { status: 200, headers });
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
