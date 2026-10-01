import { useCallback, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { guidedSteps } from "../content";
import { useAutoAdvance, useInView, usePrefersReducedMotion } from "../motion";
import { SectionHeading, WindowFrame } from "../ui";

const STEP_DURATION = 5000;

export function GuidedStart(): ReactNode {
	const sectionRef = useRef<HTMLElement>(null);
	const [active, setActive] = useState(0);
	const [hovered, setHovered] = useState(false);
	const reducedMotion = usePrefersReducedMotion();
	const inView = useInView(sectionRef, 0.35);
	const running = inView && !hovered && !reducedMotion;

	const advance = useCallback(() => setActive((index) => (index + 1) % guidedSteps.length), []);
	useAutoAdvance(active, STEP_DURATION, running, advance);

	return (
		<section
			ref={sectionRef}
			className="relative overflow-hidden border-y border-line bg-raised/40 py-24 md:py-32"
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
		>
			<div className="mx-auto w-full max-w-6xl px-5 md:px-8">
				<SectionHeading eyebrow="Getting started" title="Up and running in a minute.">
					A short welcome tour shows you around, then you name your first environment and add a folder.
					Skip the tour any time.
				</SectionHeading>

				<div className="mt-14 grid items-center gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.5fr)] lg:gap-14">
					<ol className="flex flex-col gap-2">
						{guidedSteps.map((step, index) => {
							const selected = index === active;
							return (
								<li key={step.title} data-reveal style={{ "--delay": `${index * 70}ms` } as CSSProperties}>
									<button
										type="button"
										aria-current={selected ? "step" : undefined}
										onClick={() => setActive(index)}
										className={`relative w-full overflow-hidden rounded-xl border px-5 py-4 text-left transition-colors duration-300 ${
											selected ? "border-line-strong bg-raised" : "border-transparent hover:bg-raised/60"
										}`}
									>
										<span className="flex items-center gap-4">
											<span
												className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold transition-colors duration-300 ${
													selected ? "bg-accent text-white" : "bg-accent-soft text-accent"
												}`}
											>
												{index + 1}
											</span>
											<span className={`font-semibold transition-colors duration-300 ${selected ? "text-ink" : "text-ink-soft"}`}>
												{step.title}
											</span>
										</span>
										<span className="accordion-panel" data-open={selected}>
											<span className="block">
												<span className="block pl-12 pt-2 leading-relaxed text-ink-soft">{step.detail}</span>
											</span>
										</span>
										{selected ? (
											<span
												key={`${active}-${running}`}
												aria-hidden="true"
												data-paused={!running}
												className="progress-fill absolute inset-x-0 bottom-0 h-0.5 bg-accent"
												style={{ "--duration": `${STEP_DURATION}ms` } as CSSProperties}
											/>
										) : null}
									</button>
								</li>
							);
						})}
					</ol>

					<div data-reveal="scale" className="relative">
						<div aria-hidden="true" className="absolute inset-[8%] -z-10 rounded-full bg-[var(--glow)] blur-[80px]" />
						<div className="grid">
							{guidedSteps.map((step, index) => (
								<div key={step.title} data-active={index === active} aria-hidden={index !== active} className="slide col-start-1 row-start-1">
									<WindowFrame image={step.image} />
								</div>
							))}
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}
