import type { CSSProperties, ReactNode } from "react";

import type { ReleaseArtifact } from "../shared/releases";
import type { Screenshot } from "./content";

export function ArrowIcon({ className = "h-3.5 w-3.5" }: { className?: string }): ReactNode {
	return (
		<svg aria-hidden="true" viewBox="0 0 16 16" className={className}>
			<path d="M3 8h9M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
		</svg>
	);
}

export function DownloadIcon({ className = "h-4 w-4" }: { className?: string }): ReactNode {
	return (
		<svg aria-hidden="true" viewBox="0 0 20 20" className={className}>
			<path d="M10 3v10m0 0-4-4m4 4 4-4M4 16h12" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
		</svg>
	);
}

export function CheckIcon({ className = "h-4 w-4" }: { className?: string }): ReactNode {
	return (
		<svg aria-hidden="true" viewBox="0 0 20 20" className={className}>
			<path d="m4.5 10.5 3.5 3.5 7.5-8" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" />
		</svg>
	);
}

export function LampMark({ className = "h-8 w-8" }: { className?: string }): ReactNode {
	return <img src="/icon.svg" alt="" aria-hidden="true" className={`${className} rounded-[22%]`} width="32" height="32" />;
}

/** The primary download call to action, pointing at the versioned Worker route. */
export function DownloadButton({
	artifact,
	size = "md",
	className = "",
}: {
	artifact: ReleaseArtifact;
	size?: "sm" | "md" | "lg";
	className?: string;
}): ReactNode {
	const sizing = size === "lg" ? "h-13 px-6 text-base" : size === "sm" ? "h-9 px-4 text-sm" : "h-11 px-5 text-sm";
	return (
		<a
			href={artifact.downloadPath}
			download
			className={`group relative inline-flex shrink-0 items-center whitespace-nowrap justify-center gap-2.5 overflow-hidden rounded-full bg-ink font-semibold text-paper shadow-[0_10px_30px_-10px_var(--glow)] transition-[translate,box-shadow] duration-300 ease-out-quint hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-12px_var(--glow)] active:translate-y-0 ${sizing} ${className}`}
		>
			<span
				aria-hidden="true"
				className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 ease-out-quint group-hover:translate-x-full"
			/>
			<DownloadIcon />
			<span>
				Download for Mac<span className="sr-only"> (macOS arm64, version {artifact.version})</span>
			</span>
		</a>
	);
}

export function SectionHeading({
	eyebrow,
	title,
	children,
	align = "center",
}: {
	eyebrow: string;
	title: ReactNode;
	children?: ReactNode;
	align?: "center" | "left";
}): ReactNode {
	const alignment = align === "center" ? "mx-auto text-center items-center" : "items-start text-left";
	return (
		<div className={`flex max-w-2xl flex-col gap-4 ${alignment}`}>
			<span data-reveal className="inline-flex items-center gap-2 rounded-full border border-line bg-raised/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-accent">
				{eyebrow}
			</span>
			<h2 data-reveal style={{ "--delay": "80ms" } as CSSProperties} className="text-balance text-4xl font-bold tracking-[-0.035em] text-ink md:text-5xl">
				{title}
			</h2>
			{children ? (
				<p data-reveal style={{ "--delay": "160ms" } as CSSProperties} className="text-pretty text-lg leading-relaxed text-ink-soft">
					{children}
				</p>
			) : null}
		</div>
	);
}

/**
 * A screenshot with a soft frame. The captures already include the macOS
 * title bar, so no window chrome is added here.
 */
export function WindowFrame({
	image,
	eager = false,
	className = "",
}: {
	image: Screenshot;
	eager?: boolean;
	className?: string;
}): ReactNode {
	return (
		<figure className={`overflow-hidden rounded-xl border border-line-strong bg-raised shadow-[var(--shadow)] ${className}`}>
			<img
				src={image.src}
				alt={image.alt}
				width={image.width}
				height={image.height}
				loading={eager ? "eager" : "lazy"}
				decoding="async"
				fetchPriority={eager ? "high" : "auto"}
				className="block h-auto w-full"
			/>
		</figure>
	);
}

/** A small colored file tag such as `.xlsx`. */
export function FileTag({ extension, color }: { extension: string; color: string }): ReactNode {
	return (
		<span
			className="inline-flex items-center rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold"
			style={{ color, backgroundColor: `${color}1f` }}
		>
			{extension}
		</span>
	);
}
