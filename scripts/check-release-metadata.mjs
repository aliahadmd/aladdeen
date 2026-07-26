/* global process */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { URL } from "node:url";

const root = new URL("../", import.meta.url);
const [desktopPackage, webPackage, manifest] = await Promise.all([
  readJson(new URL("package.json", root)),
  readJson(new URL("aladdeen-web/package.json", root)),
  readJson(new URL("aladdeen-web/src/shared/release-manifest.json", root))
]);

if (desktopPackage.version !== manifest.version || webPackage.version !== manifest.version) {
  throw new Error(
    `Release version mismatch: desktop=${desktopPackage.version}, web=${webPackage.version}, manifest=${manifest.version}`
  );
}
if (!Number.isInteger(manifest.build) || manifest.build < 1) {
  throw new Error("Release manifest build must be a positive integer.");
}
const artifact = manifest.macos?.arm64;
if (!artifact || !Number.isInteger(artifact.byteSize) || artifact.byteSize < 1) {
  throw new Error("Release manifest arm64 byteSize is invalid.");
}
if (!/^[a-f0-9]{64}$/.test(artifact.sha256)) {
  throw new Error("Release manifest arm64 sha256 is invalid.");
}
if (Object.keys(manifest.macos ?? {}).some((architecture) => architecture !== "arm64")) {
  throw new Error("Release manifest must contain only the macOS arm64 (M-series Apple silicon) artifact.");
}

const artifactArgument = process.argv.slice(2).find((argument) => argument !== "--")
  ?? process.env.ALADDEEN_ARTIFACT_PATH;
if (artifactArgument) {
  const artifactPath = resolve(artifactArgument);
  const expectedFilename = `Aladdeen-${manifest.version}-arm64.dmg`;
  if (basename(artifactPath) !== expectedFilename) {
    throw new Error(`Release artifact filename mismatch: expected ${expectedFilename}.`);
  }
  const details = await stat(artifactPath);
  if (!details.isFile() || details.size !== artifact.byteSize) {
    throw new Error(
      `Release artifact size mismatch: actual=${details.size}, manifest=${artifact.byteSize}`
    );
  }
  const actualHash = await sha256File(artifactPath);
  if (actualHash !== artifact.sha256) {
    throw new Error(
      `Release artifact checksum mismatch: actual=${actualHash}, manifest=${artifact.sha256}`
    );
  }
}

async function readJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

function sha256File(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}
