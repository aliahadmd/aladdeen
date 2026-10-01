import type { CSSProperties, MouseEvent, ReactNode } from "react";

import { formats } from "../content";
import { SectionHeading } from "../ui";

function trackSpotlight(event: MouseEvent<HTMLElement>): void {
	const card = event.currentTarget;
	const rect = card.getBoundingClientRect();
	card.style.setProperty("--x", `${event.clientX - rect.left}px`);
	card.style.setProperty("--y", `${event.clientY - rect.top}px`);
}

export function Formats(): ReactNode {
	return (
		<section id="formats" className="relative mx-auto w-full max-w-6xl px-5 py-24 md:px-8 md:py-32">
			<SectionHeading eyebrow="Six formats" title="The right tools for each file.">
				Aladdeen recognizes what you open and gives it a proper workspace. No importing, no converting,
				no “preview only”.
			</SectionHeading>

			<ul className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{formats.map((format, index) => (
					<li key={format.id} data-reveal className="flex" style={{ "--delay": `${(index % 3) * 80}ms` } as CSSProperties}>
					<article
						onMouseMove={trackSpotlight}
						className="spotlight group flex w-full flex-col rounded-2xl border border-line bg-raised p-6 transition-[translate,border-color] duration-300 ease-out-quint hover:-translate-y-1 hover:border-line-strong"
						style={{ "--card-glow": `${format.color}29` } as CSSProperties}
					>
						<div className="flex items-center justify-between">
							<span
								className="grid h-12 w-12 place-items-center rounded-xl font-mono text-[13px] font-bold transition-transform duration-500 ease-out-quint group-hover:-rotate-6 group-hover:scale-110"
								style={{ color: format.color, backgroundColor: `${format.color}1f` }}
								aria-hidden="true"
							>
								{format.extension}
							</span>
							<span className="h-2 w-2 rounded-full opacity-0 transition-opacity duration-300 group-hover:opacity-100" style={{ backgroundColor: format.color }} />
						</div>
						<h3 className="mt-6 text-xl font-semibold tracking-tight text-ink">{format.name}</h3>
						<p className="mt-2 leading-relaxed text-ink-soft">{format.summary}</p>
						<ul className="mt-5 flex flex-wrap gap-2">
							{format.abilities.map((ability) => (
								<li key={ability} className="rounded-full border border-line px-3 py-1 text-xs font-medium text-ink-soft">
									{ability}
								</li>
							))}
						</ul>
					</article>
					</li>
				))}
			</ul>
		</section>
	);
}
