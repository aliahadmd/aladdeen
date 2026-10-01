import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { privacyPoints, privacyStats } from "../content";
import { useInView, usePrefersReducedMotion } from "../motion";
import { SectionHeading } from "../ui";

const COUNT_DURATION = 1400;

function CountUp({ value, suffix }: { value: number; suffix: string }): ReactNode {
	const ref = useRef<HTMLSpanElement>(null);
	const inView = useInView(ref, 0.6);
	const reducedMotion = usePrefersReducedMotion();
	const [shown, setShown] = useState(0);
	const [started, setStarted] = useState(false);

	useEffect(() => {
		if (!inView || started || reducedMotion || value === 0) return;
		let frame = 0;
		const start = performance.now();
		const tick = (now: number): void => {
			const progress = Math.min((now - start) / COUNT_DURATION, 1);
			// Ease out so the number settles gently on its final value.
			setShown(Math.round(value * (1 - (1 - progress) ** 3)));
			if (progress < 1) frame = window.requestAnimationFrame(tick);
			else setStarted(true);
		};
		frame = window.requestAnimationFrame(tick);
		return () => window.cancelAnimationFrame(frame);
	}, [inView, started, reducedMotion, value]);

	const display = reducedMotion || started ? value : shown;
	return (
		<span ref={ref} className="tabular-nums">
			{display}
			{suffix}
		</span>
	);
}

export function Privacy(): ReactNode {
	return (
		<section id="privacy" className="relative overflow-hidden bg-[#0b0b10] py-24 text-white md:py-32">
			<div aria-hidden="true" className="pointer-events-none absolute inset-0">
				<div className="aurora left-[-10%] top-[-20%] h-[520px] w-[520px] bg-[rgb(110_110_255/0.35)]" />
				<div className="aurora bottom-[-30%] right-[-10%] h-[520px] w-[520px] bg-[rgb(246_185_85/0.22)] [animation-delay:-9s]" />
			</div>
			{/* This band is always dark, so it carries its own token values. */}
			<div
				className="dark relative mx-auto w-full max-w-6xl px-5 md:px-8"
				style={
					{
						"--ink": "#f3f2f8",
						"--ink-soft": "#b9b8c6",
						"--ink-faint": "#8a8998",
						"--line": "rgb(255 255 255 / 0.1)",
						"--paper-raised": "#14141b",
						"--accent": "#a5a5ff",
						"--accent-soft": "rgb(139 139 255 / 0.14)",
					} as CSSProperties
				}
			>
				<SectionHeading eyebrow="Privacy" title="Private by design. Offline by default.">
					Aladdeen has no account, no cloud, and no tracking. Your research stays on your Mac, in your
					folders, in formats you own.
				</SectionHeading>

				<dl className="mt-16 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-[var(--line)] md:grid-cols-4">
					{privacyStats.map((stat, index) => (
						<div key={stat.label} data-reveal style={{ "--delay": `${index * 90}ms` } as CSSProperties} className="flex flex-col gap-2 bg-[#0f0f15] px-6 py-8">
							<dt className="order-last text-sm text-ink-soft">{stat.label}</dt>
							<dd className="text-5xl font-bold tracking-[-0.04em] text-white md:text-6xl">
								<CountUp value={stat.value} suffix={stat.suffix} />
							</dd>
						</div>
					))}
				</dl>

				<ul className="mt-14 grid gap-8 md:grid-cols-3">
					{privacyPoints.map((point, index) => (
						<li key={point.title} data-reveal style={{ "--delay": `${index * 90}ms` } as CSSProperties} className="border-t border-line pt-6">
							<h3 className="text-lg font-semibold text-white">{point.title}</h3>
							<p className="mt-2 leading-relaxed text-ink-soft">{point.detail}</p>
						</li>
					))}
				</ul>
			</div>
		</section>
	);
}
