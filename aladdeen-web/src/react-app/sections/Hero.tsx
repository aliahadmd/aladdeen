import { useRef, type CSSProperties, type ReactNode } from "react";

import type { ReleaseArtifact } from "../../shared/releases";
import { formats, screenshots } from "../content";
import { useHeroTilt, usePrefersReducedMotion } from "../motion";
import { formatSize } from "../format";
import { ArrowIcon, DownloadButton, FileTag, WindowFrame } from "../ui";

// Where each floating file sits around the window, as a share of the frame.
const chipPlacements = [
	{ className: "left-[-7%] top-[14%]", rot: "-4deg", float: "6.5s", delay: 500 },
	{ className: "right-[-6%] top-[8%]", rot: "3deg", float: "7.5s", delay: 650 },
	{ className: "left-[-9%] top-[52%]", rot: "3deg", float: "8s", delay: 800 },
	{ className: "right-[-8%] top-[44%]", rot: "-3deg", float: "6s", delay: 950 },
	{ className: "left-[6%] bottom-[-5%]", rot: "-2deg", float: "7s", delay: 1100 },
	{ className: "right-[8%] bottom-[-4%]", rot: "4deg", float: "8.5s", delay: 1250 },
] as const;

const chipNames = ["Field notes", "Interviews", "Committee briefing", "Survey results", "Primary sources", "Archive export"];
const chipOrder = ["markdown", "word", "powerpoint", "excel", "pdf", "html"] as const;

export function Hero({ artifact }: { artifact: ReleaseArtifact }): ReactNode {
	const windowRef = useRef<HTMLDivElement>(null);
	const reducedMotion = usePrefersReducedMotion();
	useHeroTilt(windowRef, !reducedMotion);

	return (
		<section id="top" className="relative overflow-hidden pt-32 md:pt-40">
			<div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
				<div className="aurora left-[8%] top-[-6%] h-[440px] w-[440px] bg-[var(--glow)]" />
				<div className="aurora right-[4%] top-[10%] h-[380px] w-[380px] bg-[var(--lamp-glow)] [animation-delay:-6s]" />
				<div className="aurora left-[38%] top-[38%] h-[520px] w-[520px] bg-[var(--glow)] opacity-60 [animation-delay:-12s]" />
				<div className="absolute inset-0 bg-[linear-gradient(to_right,var(--line)_1px,transparent_1px),linear-gradient(to_bottom,var(--line)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:radial-gradient(ellipse_70%_55%_at_50%_30%,black,transparent)]" />
			</div>

			<div className="mx-auto flex w-full max-w-6xl flex-col items-center px-5 text-center md:px-8">
				<a
					href="#download"
					className="rise-in group inline-flex items-center gap-2 rounded-full border border-line bg-raised/70 py-1 pl-1 pr-3 text-sm text-ink-soft backdrop-blur transition-colors hover:border-line-strong"
				>
					<span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-semibold text-accent">v{artifact.version}</span>
					Free during the beta
					<ArrowIcon className="h-3 w-3 transition-transform duration-300 group-hover:translate-x-0.5" />
				</a>

				<h1
					className="rise-in mt-7 max-w-4xl text-balance text-5xl font-bold leading-[1.02] tracking-[-0.045em] text-ink sm:text-6xl md:text-7xl"
					style={{ "--delay": "90ms" } as CSSProperties}
				>
					Every research file. One <span className="text-shimmer">calm</span> workspace.
				</h1>

				<p
					className="rise-in mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-ink-soft md:text-xl"
					style={{ "--delay": "180ms" } as CSSProperties}
				>
					Aladdeen opens your Markdown, Word, Excel, PowerPoint, PDF, and HTML files right where they live,
					so you can read, edit, and search them side by side. No account. No cloud. No conversion.
				</p>

				<div className="rise-in mt-9 flex flex-col items-center gap-3 sm:flex-row" style={{ "--delay": "270ms" } as CSSProperties}>
					<DownloadButton artifact={artifact} size="lg" />
					<a
						href="#tour"
						className="group inline-flex h-13 items-center gap-2 rounded-full px-6 text-base font-semibold text-ink transition-colors hover:bg-accent-soft"
					>
						Take the tour
						<ArrowIcon className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
					</a>
				</div>

				<ul className="rise-in mt-5 flex flex-wrap justify-center gap-x-2 text-sm text-ink-faint" style={{ "--delay": "340ms" } as CSSProperties}>
					{["Apple silicon", "macOS 12+", formatSize(artifact.byteSize)].map((detail, index) => (
						<li key={detail} className="whitespace-nowrap">
							{index > 0 ? <span aria-hidden="true" className="mr-2">·</span> : null}
							{detail}
						</li>
					))}
				</ul>
			</div>

			<div className="relative mx-auto mt-16 w-full max-w-5xl px-5 pb-10 md:mt-20 md:px-8">
				<div aria-hidden="true" className="lamp-glow absolute inset-x-[12%] top-[18%] -z-10 h-[70%] rounded-full bg-[var(--glow)] blur-[90px]" />
				{/* Entrance and scroll tilt live on separate elements: a finished
				    entrance animation would otherwise pin `transform: none`. */}
				<div className="rise-in" style={{ "--delay": "380ms" } as CSSProperties}>
				<div ref={windowRef} className="hero-window relative">
					<WindowFrame image={screenshots.markdown} eager />
					{chipPlacements.map((placement, index) => {
						const format = formats.find((candidate) => candidate.id === chipOrder[index])!;
						return (
							<div
								key={format.id}
								aria-hidden="true"
								className={`file-chip absolute hidden items-center gap-2 rounded-xl border border-line-strong bg-raised/90 px-3 py-2 text-sm font-medium text-ink shadow-[0_12px_30px_-12px_rgb(0_0_0/0.35)] backdrop-blur md:flex ${placement.className}`}
								style={
									{
										"--rot": placement.rot,
										"--float": placement.float,
										"--in-delay": `${placement.delay}ms`,
										"--float-delay": `${index * -0.7}s`,
									} as CSSProperties
								}
							>
								<FileTag extension={format.extension} color={format.color} />
								{chipNames[index]}
							</div>
						);
					})}
				</div>
				</div>
			</div>
		</section>
	);
}
