import manifest from "./release-manifest.json";

export type DownloadArch = "arm64";

export interface ReleaseArtifact {
	version: string;
	architecture: DownloadArch;
	label: string;
	description: string;
	r2Key: string;
	filename: string;
	byteSize: number;
	sha256: string;
	downloadPath: string;
}

export const CURRENT_RELEASE = manifest.version;

function createArtifact(
	architecture: DownloadArch,
	label: string,
	description: string,
): ReleaseArtifact {
	const filename = `Aladdeen-${manifest.version}-${architecture}.dmg`;
	return {
		version: manifest.version,
		architecture,
		label,
		description,
		r2Key: `releases/${manifest.version}/build-${manifest.build}/${filename}`,
		filename,
		byteSize: manifest.macos[architecture].byteSize,
		sha256: manifest.macos[architecture].sha256,
		downloadPath: `/download/v${manifest.version}/macos/${architecture}?build=${manifest.build}`,
	};
}

export const RELEASE_ARTIFACTS = {
	arm64: createArtifact(
		"arm64",
		"macOS arm64 · M-series Apple silicon",
		"For Macs with an M1, M2, M3, M4, or newer M-series chip.",
	),
} as const satisfies Record<DownloadArch, ReleaseArtifact>;

export function getReleaseArtifact(
	version: string,
	architecture: string,
): ReleaseArtifact | null {
	if (version !== `v${CURRENT_RELEASE}`) return null;
	if (architecture !== "arm64") return null;

	return RELEASE_ARTIFACTS.arm64;
}
