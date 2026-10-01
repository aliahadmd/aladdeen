import type { ReactNode } from "react";

import { marqueeFiles } from "../content";

export function Marquee(): ReactNode {
	// The list is rendered twice so the track can loop seamlessly at -50%.
	const loop = [...marqueeFiles, ...marqueeFiles];
	return (
		<section aria-label="Works with the files you already have" className="border-y border-line bg-raised/40 py-6">
			<p className="sr-only">Opens Markdown, Word, Excel, PowerPoint, PDF, and HTML files.</p>
			<div aria-hidden="true" className="marquee overflow-hidden">
				<ul className="marquee-track flex w-max gap-3">
					{loop.map((file, index) => (
						<li
							key={`${file.name}-${index}`}
							className="flex shrink-0 items-center gap-2.5 rounded-full border border-line bg-raised px-4 py-2 text-sm font-medium text-ink-soft"
						>
							<span className="h-2 w-2 rounded-full" style={{ backgroundColor: file.color }} />
							{file.name}
						</li>
					))}
				</ul>
			</div>
		</section>
	);
}
