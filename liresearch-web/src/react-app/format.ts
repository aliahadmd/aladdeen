export function formatSize(byteSize: number): string {
	return `${Math.round(byteSize / 1024 / 1024)} MB`;
}
