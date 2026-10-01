import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { searchDemoQueries } from "../content";
import { useInView, usePrefersReducedMotion } from "../motion";
import { SectionHeading } from "../ui";

const TYPE_INTERVAL = 70;
const HOLD_RESULTS = 4200;

const searchFeatures = [
	{
		keys: ["⌘", "P"],
		title: "Quick Open",
		detail: "Find any file in your environment by name, wherever it lives.",
	},
	{
		keys: ["⌘", "⇧", "F"],
		title: "Search everything",
		detail: "Look inside every document at once, including changes you haven't saved yet.",
	},
	{
		keys: ["↑", "↓", "↵"],
		title: "Land on the line",
		detail: "Pick a result with the arrow keys and press Return to jump to the sentence, cell, slide, or page.",
	},
] as const;

function Keys({ keys }: { keys: readonly string[] }): ReactNode {
	return (
		<span className="flex gap-1" aria-hidden="true">
			{keys.map((key) => (
				<kbd key={key} className="grid h-6 min-w-6 place-items-center rounded-md border border-line-strong bg-raised px-1.5 font-sans text-xs font-semibold text-ink-soft shadow-[0_1px_0_var(--line-strong)]">
					{key}
				</kbd>
			))}
		</span>
	);
}

export function SearchDemo(): ReactNode {
	const demoRef = useRef<HTMLDivElement>(null);
	const inView = useInView(demoRef, 0.4);
	const reducedMotion = usePrefersReducedMotion();
	const [queryIndex, setQueryIndex] = useState(0);
	const [typed, setTyped] = useState(0);
	const animate = inView && !reducedMotion;

	const current = searchDemoQueries[queryIndex]!;
	const visibleLength = reducedMotion ? current.query.length : typed;
	const complete = visibleLength >= current.query.length;

	useEffect(() => {
		if (!animate) return;
		if (typed < current.query.length) {
			const timer = window.setTimeout(() => setTyped((count) => count + 1), TYPE_INTERVAL);
			return () => window.clearTimeout(timer);
		}
		const timer = window.setTimeout(() => {
			setQueryIndex((index) => (index + 1) % searchDemoQueries.length);
			setTyped(0);
		}, HOLD_RESULTS);
		return () => window.clearTimeout(timer);
	}, [animate, typed, current.query.length]);

	return (
		<section className="relative mx-auto w-full max-w-6xl px-5 py-24 md:px-8 md:py-32">
			<div className="grid items-center gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
				<div className="flex flex-col gap-10">
					<SectionHeading eyebrow="Search" title="Find the passage, not just the file." align="left">
						Ask once and Aladdeen looks through every note, report, spreadsheet, deck, and PDF in your
						environment, then takes you straight to the match.
					</SectionHeading>
					<ul className="flex flex-col gap-6">
						{searchFeatures.map((feature, index) => (
							<li key={feature.title} data-reveal style={{ "--delay": `${index * 90}ms` } as CSSProperties} className="flex gap-4">
								<Keys keys={feature.keys} />
								<div>
									<h3 className="font-semibold text-ink">{feature.title}</h3>
									<p className="mt-1 leading-relaxed text-ink-soft">{feature.detail}</p>
								</div>
							</li>
						))}
					</ul>
				</div>

				<div ref={demoRef} data-reveal="scale" className="relative">
					<div aria-hidden="true" className="absolute inset-[6%] -z-10 rounded-full bg-[var(--lamp-glow)] blur-[80px]" />
					<p className="sr-only">
						Example: searching for “{current.query}” finds matches in {current.results.map((result) => result.file).join(", ")}.
					</p>
					<div aria-hidden="true" className="overflow-hidden rounded-2xl border border-line-strong bg-raised shadow-[var(--shadow)]">
						<div className="flex items-center gap-3 border-b border-line px-5 py-4">
							<svg viewBox="0 0 20 20" className="h-5 w-5 shrink-0 text-ink-faint">
								<circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" strokeWidth="1.8" />
								<path d="m13.5 13.5 4 4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
							</svg>
							<span className="flex-1 truncate text-lg text-ink">
								{current.query.slice(0, visibleLength)}
								<span className="caret ml-0.5 inline-block h-5 w-[2px] translate-y-1 bg-accent" />
							</span>
							<Keys keys={["⌘", "⇧", "F"]} />
						</div>

						<div className="min-h-[264px] p-3">
							{complete ? (
								<ul key={queryIndex} className="flex flex-col gap-2">
									{current.results.map((result, index) => (
										<li
											key={result.file}
											className="result-in rounded-xl border border-transparent px-4 py-3 transition-colors first:border-line first:bg-accent-soft"
											style={{ "--delay": `${index * 120}ms` } as CSSProperties}
										>
											<div className="flex items-center justify-between gap-3">
												<span className="flex items-center gap-2 text-sm font-semibold text-ink">
													<span className="h-2 w-2 rounded-full" style={{ backgroundColor: result.color }} />
													{result.file}
												</span>
												<span className="truncate text-xs text-ink-faint">{result.where}</span>
											</div>
											<p className="mt-1.5 truncate text-sm text-ink-soft">
												{result.before}
												<mark className="rounded bg-[var(--lamp-glow)] px-0.5 text-ink">{result.match}</mark>
												{result.after}
											</p>
										</li>
									))}
								</ul>
							) : (
								<div className="flex h-[240px] flex-col items-center justify-center gap-3 text-sm text-ink-faint">
									<span className="flex gap-1">
										<span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-faint [animation-delay:-0.3s]" />
										<span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-faint [animation-delay:-0.15s]" />
										<span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-faint" />
									</span>
									Searching every document…
								</div>
							)}
						</div>

						<div className="flex items-center justify-between border-t border-line px-5 py-3 text-xs text-ink-faint">
							<span>
								{complete ? `${current.results.length} matches in ${current.results.length} documents` : "Markdown · Word · Excel · PowerPoint · PDF · HTML"}
							</span>
							<span>Includes unsaved changes</span>
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}
