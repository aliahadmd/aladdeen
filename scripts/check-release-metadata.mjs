import { readFile } from "node:fs/promises";
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
  throw new Error("Release manifest must contain only the Apple silicon arm64 artifact.");
}

async function readJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}
