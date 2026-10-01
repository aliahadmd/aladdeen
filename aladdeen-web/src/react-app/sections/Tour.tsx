import { useCallback, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";

import { showcaseSlides } from "../content";
import { useAutoAdvance, useInView, usePrefersReducedMotion } from "../motion";
import { CheckIcon, SectionHeading, WindowFrame } from "../ui";

const SLIDE_DURATION = 7000;

export function Tour(): ReactNode {
	const sectionRef = useRef<HTMLElement>(null);
	const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
	const [active, setActive] = useState(0);
	const [hovered, setHovered] = useState(false);
	const reducedMotion = usePrefersReducedMotion();
	const inView = useInView(sectionRef, 0.35);
	const running = inView && !hovered && !reducedMotion;

	const advance = useCallback(() => setActive((index) => (index + 1) % showcaseSlides.length), []);
	useAutoAdvance(active, SLIDE_DURATION, running, advance);

	const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
		const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
		if (!delta) return;
		event.preventDefault();
		const next = (active + delta + showcaseSlides.length) % showcaseSlides.length;
		setActive(next);
		tabRefs.current[next]?.focus();
	};

	return (
		<section
			id="tour"
			ref={sectionRef}
			className="relative mx-auto w-full max-w-6xl px-5 py-24 md:px-8 md:py-32"
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
		>
			<SectionHeading eyebrow="Take the tour" title="One window. Every format.">
				Every file type opens in a tool built for it, so you can move from notes to numbers to slides
				without switching apps.
			</SectionHeading>

			<div
				role="tablist"
				aria-label="Document formats"
				data-reveal
				className="mx-auto mt-12 flex w-fit gap-1 rounded-full border border-line bg-raised/70 p-1.5 backdrop-blur"
			>
				{showcaseSlides.map((slide, index) => {
					const selected = index === active;
					return (
						<button
							key={slide.id}
							ref={(element) => {
								tabRefs.current[index] = element;
							}}
							type="button"
							role="tab"
							id={`tour-tab-${slide.id}`}
							aria-selected={selected}
							aria-controls={`tour-panel-${slide.id}`}
							tabIndex={selected ? 0 : -1}
							onClick={() => setActive(index)}
							onKeyDown={onTabKeyDown}
							className={`relative overflow-hidden rounded-full px-5 py-2.5 text-sm font-semibold transition-colors duration-300 ${
								selected ? "bg-ink text-paper" : "text-ink-soft hover:text-ink"
							}`}
						>
							{slide.label}
							{selected ? (
								<span
									// Restart with the timer whenever autoplay pauses or resumes.
									key={`${slide.id}-${active}-${running}`}
									aria-hidden="true"
									data-paused={!running}
									className="progress-fill absolute inset-x-3 bottom-1 h-0.5 rounded-full bg-paper/60"
									style={{ "--duration": `${SLIDE_DURATION}ms` } as CSSProperties}
								/>
							) : null}
						</button>
					);
				})}
			</div>

			<div className="mt-12 grid items-center gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.6fr)] lg:gap-14">
				<div className="grid">
					{showcaseSlides.map((slide, index) => {
						const selected = index === active;
						return (
							<div
								key={slide.id}
								id={`tour-panel-${slide.id}`}
								role="tabpanel"
								aria-labelledby={`tour-tab-${slide.id}`}
								aria-hidden={!selected}
								inert={!selected}
								data-active={selected}
								className="slide col-start-1 row-start-1"
							>
								<h3 className="text-3xl font-bold tracking-[-0.03em] text-ink">{slide.title}</h3>
								<p className="mt-4 text-lg leading-relaxed text-ink-soft">{slide.description}</p>
								<ul className="mt-6 flex flex-col gap-3">
									{slide.points.map((point) => (
										<li key={point} className="flex items-center gap-3 text-ink">
											<span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
												<CheckIcon className="h-3.5 w-3.5" />
											</span>
											{point}
										</li>
									))}
								</ul>
							</div>
						);
					})}
				</div>

				<div data-reveal="scale" className="relative">
					<div aria-hidden="true" className="absolute inset-[8%] -z-10 rounded-full bg-[var(--glow)] blur-[80px]" />
					<div className="grid">
						{showcaseSlides.map((slide, index) => (
							<div
								key={slide.id}
								data-active={index === active}
								aria-hidden={index !== active}
								className="slide col-start-1 row-start-1"
							>
								<WindowFrame image={slide.image} />
							</div>
						))}
					</div>
				</div>
			</div>
		</section>
	);
}
