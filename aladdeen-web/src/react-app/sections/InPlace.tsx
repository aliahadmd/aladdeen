import type { CSSProperties, ReactNode } from "react";

import { formats } from "../content";
import { CheckIcon, FileTag, LampMark, SectionHeading } from "../ui";

const diskFiles = [
	{ name: "Field notes.md", folder: "~/Research/Interviews", format: "markdown" },
	{ name: "Interviews.docx", folder: "~/Research/Interviews", format: "word" },
	{ name: "Survey results.xlsx", folder: "~/Research/Data", format: "excel" },
	{ name: "Briefing.pptx", folder: "~/Desktop", format: "powerpoint" },
	{ name: "Sources.pdf", folder: "/Volumes/Archive", format: "pdf" },
] as const;

// Row centres in the 440-unit-tall diagram; the files column spans x 0–300.
const rowY = [44, 132, 220, 308, 396];

const guarantees = [
	{ title: "No import, no library", detail: "Add a folder and Aladdeen lists what's inside. Nothing is copied." },
	{ title: "Saved to the original", detail: "Edits go back into the same file, in the same folder, in the same format." },
	{ title: "Plays well with others", detail: "Change a file in another app and Aladdeen notices and keeps your work safe." },
] as const;

function fileFormat(id: (typeof diskFiles)[number]["format"]) {
	return formats.find((format) => format.id === id)!;
}

export function InPlace(): ReactNode {
	return (
		<section className="relative overflow-hidden border-y border-line bg-raised/40 py-24 md:py-32">
			<div className="mx-auto w-full max-w-6xl px-5 md:px-8">
				<SectionHeading eyebrow="Files stay put" title="Your files never move.">
					Aladdeen works on the originals, right in their folders. Open the same files in any other app,
					any time. They're still just ordinary files.
				</SectionHeading>

				<div data-reveal="scale" className="relative mx-auto mt-16 max-w-5xl">
					<div className="relative flex flex-col items-center gap-6 lg:block lg:h-[440px]">
						{/* Files on disk */}
						<ul className="flex w-full flex-col gap-3 sm:w-auto lg:absolute lg:inset-y-0 lg:left-0 lg:w-[30%] lg:gap-0">
							{diskFiles.map((file, index) => {
								const format = fileFormat(file.format);
								return (
									// Each row owns an 88-unit slot so its centre meets a beam (see rowY).
									<li key={file.name} className="lg:flex lg:h-[88px] lg:items-center">
										<div
											data-reveal
											style={{ "--delay": `${index * 90}ms` } as CSSProperties}
											className="flex w-full items-center gap-3 rounded-xl border border-line bg-raised px-4 py-3 shadow-[0_8px_24px_-16px_rgb(0_0_0/0.4)]"
										>
											<FileTag extension={format.extension} color={format.color} />
											<div className="min-w-0">
												<p className="truncate text-sm font-semibold text-ink">{file.name}</p>
												<p className="truncate font-mono text-[11px] text-ink-faint">{file.folder}</p>
											</div>
										</div>
									</li>
								);
							})}
						</ul>

						{/* Beams: read in (forward) and saved back (reverse) */}
						<svg
							aria-hidden="true"
							viewBox="0 0 1000 440"
							preserveAspectRatio="none"
							className="pointer-events-none absolute inset-0 hidden h-full w-full lg:block"
						>
							<defs>
								<linearGradient id="beam-gradient" x1="0" x2="1" y1="0" y2="0">
									<stop offset="0%" stopColor="var(--accent)" stopOpacity="0.15" />
									<stop offset="60%" stopColor="var(--accent)" stopOpacity="0.9" />
									<stop offset="100%" stopColor="var(--lamp)" stopOpacity="0.9" />
								</linearGradient>
							</defs>
							{rowY.map((y, index) => {
								const path = `M 300 ${y} C 450 ${y}, 480 220, 630 220`;
								return (
									<g key={y}>
										<path d={path} fill="none" stroke="var(--line-strong)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
										<path
											d={path}
											fill="none"
											stroke="url(#beam-gradient)"
											strokeWidth="2"
											strokeLinecap="round"
											vectorEffect="non-scaling-stroke"
											className="beam"
											data-direction={index % 2 === 0 ? "forward" : "back"}
											style={{ animationDelay: `${index * -0.3}s` }}
										/>
									</g>
								);
							})}
						</svg>

						<svg aria-hidden="true" viewBox="0 0 24 40" className="h-10 w-6 text-accent lg:hidden">
							<path d="M12 2v34m0 0-7-7m7 7 7-7" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" className="beam" />
						</svg>

						{/* Aladdeen window */}
						<div className="w-full max-w-md lg:absolute lg:right-0 lg:top-1/2 lg:w-[37%] lg:max-w-none lg:-translate-y-1/2">
							<div className="relative overflow-hidden rounded-2xl border border-line-strong bg-raised shadow-[var(--shadow)]">
								<div className="flex h-9 items-center gap-1.5 border-b border-line px-3.5">
									<span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
									<span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
									<span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
								</div>
								<div className="flex items-center gap-4 p-5">
									<div className="relative grid h-14 w-14 shrink-0 place-items-center">
										<span className="pulse-ring absolute inset-0 rounded-2xl bg-[var(--glow)]" />
										<span className="pulse-ring absolute inset-0 rounded-2xl bg-[var(--glow)] [animation-delay:1.4s]" />
										<LampMark className="relative h-14 w-14" />
									</div>
									<div>
										<p className="text-base font-semibold text-ink">Aladdeen</p>
										<p className="text-sm text-ink-soft">Reading and saving in place</p>
									</div>
								</div>
								<ul className="flex flex-col gap-1 border-t border-line p-3">
									{diskFiles.slice(0, 3).map((file) => (
										<li key={file.name} className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-ink-soft odd:bg-accent-soft">
											<span className="truncate">{file.name}</span>
											<span className="flex items-center gap-1 text-xs font-medium text-[#22a565]">
												<CheckIcon className="h-3.5 w-3.5" />
												Saved
											</span>
										</li>
									))}
								</ul>
							</div>
							<p className="mt-4 flex items-center justify-center gap-2 text-sm font-medium text-ink-faint">
								<svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
									<path d="M7 18a4.5 4.5 0 0 1-.5-8.97A6 6 0 0 1 18 9.5a4 4 0 0 1 .5 7.97M3 3l18 18" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
								</svg>
								Nothing uploaded. Ever.
							</p>
						</div>
					</div>
				</div>

				<ul className="mx-auto mt-16 grid max-w-5xl gap-6 md:grid-cols-3">
					{guarantees.map((item, index) => (
						<li key={item.title} data-reveal style={{ "--delay": `${index * 90}ms` } as CSSProperties}>
							<h3 className="flex items-center gap-2 text-lg font-semibold text-ink">
								<span className="grid h-6 w-6 place-items-center rounded-full bg-accent-soft text-accent">
									<CheckIcon className="h-3.5 w-3.5" />
								</span>
								{item.title}
							</h3>
							<p className="mt-2 leading-relaxed text-ink-soft">{item.detail}</p>
						</li>
					))}
				</ul>
			</div>
		</section>
	);
}
