import { useId, useState, type CSSProperties, type ReactNode } from "react";

import { CURRENT_RELEASE } from "../../shared/releases";
import { SectionHeading } from "../ui";

const faqItems = [
	{
		question: "Where are my files stored?",
		answer:
			"Exactly where you already keep them. Aladdeen opens ordinary files in place and saves changes back to the same file. It never copies your documents into a library of its own.",
	},
	{
		question: "Does it need an internet connection?",
		answer:
			"No. Opening, editing, searching, and exporting all work offline. Aladdeen doesn't reach out to the internet at all, so it keeps working with Wi-Fi turned off.",
	},
	{
		question: "Which Macs are supported?",
		answer: `Aladdeen ${CURRENT_RELEASE} runs on Macs with Apple silicon (M1 or newer) with macOS 12 Monterey or later. Intel Macs, Windows, and Linux aren't supported.`,
	},
	{
		question: "Why does macOS warn me the first time?",
		answer:
			"Aladdeen isn't notarized by Apple yet. After the first attempt to open it, go to System Settings → Privacy & Security, scroll to Security, and click Open Anyway. You only need to do this once.",
	},
	{
		question: "How do I save my changes?",
		answer:
			"Press ⌘S or click Save. The status bar shows Unsaved until you do, and Aladdeen saves open changes before it closes so nothing is lost. If another app changes a file you're editing, you choose which version to keep.",
	},
	{
		question: "How do I update or uninstall?",
		answer:
			"To update, download the newest version and replace the app in Applications; your environments and settings carry over. To uninstall, drag Aladdeen to the Trash. Your documents are never affected.",
	},
	{
		question: "Is Aladdeen free?",
		answer:
			"Yes, during the current beta. Aladdeen is proprietary software by Ali Ahad, and future versions may be paid.",
	},
] as const;

function FaqItem({ question, answer, index }: { question: string; answer: string; index: number }): ReactNode {
	const [open, setOpen] = useState(index === 0);
	const id = useId();
	return (
		<li data-reveal style={{ "--delay": `${index * 50}ms` } as CSSProperties} className="border-b border-line">
			<h3>
				<button
					type="button"
					aria-expanded={open}
					aria-controls={id}
					onClick={() => setOpen((value) => !value)}
					className="group flex w-full items-center justify-between gap-6 py-6 text-left text-lg font-semibold text-ink"
				>
					{question}
					<span
						aria-hidden="true"
						className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line text-ink-soft transition-[rotate,background-color,color] duration-500 ease-out-quint group-hover:border-line-strong ${
							open ? "rotate-45 bg-ink text-paper" : ""
						}`}
					>
						<svg viewBox="0 0 16 16" className="h-3.5 w-3.5">
							<path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
						</svg>
					</span>
				</button>
			</h3>
			<div id={id} className="accordion-panel" data-open={open} role="region" aria-label={question} inert={!open}>
				<div>
					<p className="max-w-3xl pb-6 leading-relaxed text-ink-soft">{answer}</p>
				</div>
			</div>
		</li>
	);
}

export function Faq(): ReactNode {
	return (
		<section id="faq" className="relative mx-auto w-full max-w-4xl px-5 py-24 md:px-8 md:py-32">
			<SectionHeading eyebrow="FAQ" title="Questions, answered." />
			<ul className="mt-12 border-t border-line">
				{faqItems.map((item, index) => (
					<FaqItem key={item.question} question={item.question} answer={item.answer} index={index} />
				))}
			</ul>
		</section>
	);
}
