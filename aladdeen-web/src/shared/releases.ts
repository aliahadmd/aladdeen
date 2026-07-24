export type DownloadArch = "arm64" | "x64";

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

export const CURRENT_RELEASE = "0.2.0";

export const RELEASE_ARTIFACTS = {
	arm64: {
		version: CURRENT_RELEASE,
		architecture: "arm64",
		label: "Apple Silicon",
		description: "For Macs with M1, M2, M3, M4, or newer Apple chips.",
		r2Key: "releases/0.2.0/build-1/Aladdeen-0.2.0-arm64.dmg",
		filename: "Aladdeen-0.2.0-arm64.dmg",
		byteSize: 159_234_748,
		sha256: "4949ba8dd7bfda99901b4cbacedca5bdec03a64247b9f2b8d9d9edd9542a45a8",
		downloadPath: "/download/v0.2.0/macos/arm64?build=1",
	},
	x64: {
		version: CURRENT_RELEASE,
		architecture: "x64",
		label: "Intel Mac",
		description: "For Macs with an Intel processor.",
		r2Key: "releases/0.2.0/build-1/Aladdeen-0.2.0-x64.dmg",
		filename: "Aladdeen-0.2.0-x64.dmg",
		byteSize: 163_967_396,
		sha256: "49c556a525df32cacf92f1189177ef01c6b1b50d4d964bf95adfc3e140f05819",
		downloadPath: "/download/v0.2.0/macos/x64?build=1",
	},
} as const satisfies Record<DownloadArch, ReleaseArtifact>;

export function getReleaseArtifact(
	version: string,
	architecture: string,
): ReleaseArtifact | null {
	if (version !== `v${CURRENT_RELEASE}`) return null;
	if (architecture !== "arm64" && architecture !== "x64") return null;

	return RELEASE_ARTIFACTS[architecture];
}
