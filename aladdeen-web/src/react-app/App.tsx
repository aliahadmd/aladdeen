import { useEffect, useState, type ReactNode } from "react";

import {
	CURRENT_RELEASE,
	RELEASE_ARTIFACTS,
	type ReleaseArtifact,
} from "../shared/releases";

type Theme = "light" | "dark" | "system";

const themeOrder: Theme[] = ["light", "dark", "system"];

const featureGroups = [
	{
		label: "Documents",
		title: "Six formats, each with the right workspace.",
		description:
			"Aladdeen recognizes the source format and opens tools designed for it—without a conversion step.",
		items: [
			{
				title: "Markdown",
				detail:
					"Edit beside a rich preview with GFM, math, Mermaid, callouts, local images, and source navigation.",
			},
			{
				title: "HTML",
				detail:
					"Work in Source, Preview, or Split mode with a safe live preview and contained local assets.",
			},
			{
				title: "Word",
				detail:
					"Open and edit DOCX files directly with document-aware formatting, comments, and tracked changes.",
			},
			{
				title: "PDF",
				detail:
					"Read, search, annotate, fill forms, and organize pages while preserving the original document.",
			},
			{
				title: "Excel",
				detail:
					"Edit XLSX workbooks with formulas, styles, sorting, filtering, and preservation-aware saves.",
			},
			{
				title: "PowerPoint",
				detail:
					"Edit PPTX decks with the full ribbon, speaker notes, transitions and animations, then present fullscreen or with presenter view.",
			},
		],
	},
	{
		label: "Organization",
		title: "Bring scattered research together without moving it.",
		description:
			"Environments provide one working set across projects and standalone files while every source stays at its original path.",
		items: [
			{
				title: "Environments",
				detail:
					"Keep separate research contexts, tabs, recent files, and expanded folders without duplicating content.",
			},
			{
				title: "Project policies",
				detail:
					"Choose document types, selected folders, exclusions, favorites, groups, and archived projects per folder.",
			},
			{
				title: "Persistent context",
				detail:
					"Restore the last working set and keep independently opened files available in Individual Files.",
			},
		],
	},
	{
		label: "Navigation",
		title: "Find the document, heading, or exact source line.",
		description:
			"Fast navigation stays separate by intent: filenames, document structure, and full source content each have a focused path.",
		items: [
			{
				title: "Global search",
				detail:
					"Search indexed projects and standalone files progressively, including current unsaved changes.",
			},
			{
				title: "Quick Open",
				detail:
					"Jump to a file by name without adding noise to the sidebar or replacing the active project collection.",
			},
			{
				title: "Outline and source",
				detail:
					"Navigate long documents by heading, or click rendered Markdown to reveal the matching editor range.",
			},
		],
	},
	{
		label: "Reliability",
		title: "Quiet safeguards around every edit.",
		description:
			"Saving and conflict handling stay out of the way until attention is genuinely needed.",
		items: [
			{
				title: "Atomic autosave",
				detail:
					"Save changes safely in place, flush pending edits on close, and never silently discard failed saves.",
			},
			{
				title: "External changes",
				detail:
					"Detect changed, moved, or deleted files and offer clear reload, keep, copy, or relink recovery paths.",
			},
			{
				title: "Portable output",
				detail:
					"Export Markdown to PDF or DOCX while every source remains readable by other applications.",
			},
		],
	},
] as const;

const faqItems = [
	{
		question: "Where are my research files stored?",
		answer:
			"Exactly where you already keep them. Aladdeen opens ordinary Markdown, HTML, Word, PDF, Excel, and PowerPoint files in place; it does not copy document content into its settings database.",
	},
	{
		question: "Does Aladdeen need an internet connection?",
		answer:
			"No. Opening, editing, searching, local assets, and export all work offline. Aladdeen blocks outbound network requests in release builds, so the workspace keeps working with Wi-Fi switched off.",
	},
	{
		question: "Which Mac does Aladdeen support?",
		answer:
			`Aladdeen v${CURRENT_RELEASE} is made only for macOS arm64 on M-series Apple silicon (M1 or newer).`,
	},
	{
		question: "Why does macOS show a warning?",
		answer:
			"Aladdeen is ad-hoc signed for bundle integrity but is not Apple notarized. After trying to open it once, go to System Settings → Privacy & Security, scroll to Security, click Open Anyway, authenticate, and confirm Open Anyway.",
	},
	{
		question: "Can I leave Aladdeen later?",
		answer:
			"Yes. Your work remains in its original Markdown, HTML, DOCX, PDF, XLSX, or PPTX format at its original location. Aladdeen does not place your research inside a proprietary library.",
	},
	{
		question: "Is Aladdeen free?",
		answer:
			"Aladdeen is free during the current beta-testing period. Aladdeen is proprietary, closed-source software, and future releases may be offered as a paid product.",
	},
] as const;

function readTheme(): Theme {
	if (typeof window === "undefined") return "system";
	const stored = window.localStorage.getItem("theme");
	return stored === "light" || stored === "dark" || stored === "system"
		? stored
		: "system";
}

function applyTheme(theme: Theme): void {
	const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
	document.documentElement.classList.toggle(
		"dark",
		theme === "dark" || (theme === "system" && prefersDark),
	);
}

function ThemeIcon({ theme }: { theme: Theme }): ReactNode {
	if (theme === "light") {
		return (
			<svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
				<circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
				<path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
			</svg>
		);
	}

	if (theme === "dark") {
		return (
			<svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
				<path d="M20.2 15.2A8.5 8.5 0 0 1 8.8 3.8 8.5 8.5 0 1 0 20.2 15.2Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="2" />
			</svg>
		);
	}

	return (
		<svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
			<rect x="3" y="4" width="18" height="13" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
			<path d="M8 21h8M12 17v4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
		</svg>
	);
}

function ArrowIcon(): ReactNode {
	return (
		<svg aria-hidden="true" viewBox="0 0 16 16" className="h-3 w-3">
			<path d="M3 8h9M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
		</svg>
	);
}

function MenuIcon({ open }: { open: boolean }): ReactNode {
	return (
		<svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5">
			{open ? (
				<path d="m5 5 10 10M15 5 5 15" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.75" />
			) : (
				<path d="M3 6h14M3 10h14M3 14h14" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.75" />
			)}
		</svg>
	);
}

function DownloadLink({
	artifact,
	primary = false,
	children,
}: {
	artifact: ReleaseArtifact;
	primary?: boolean;
	children: ReactNode;
}): ReactNode {
	const classes = primary
		? "inline-flex items-center gap-2 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
		: "inline-flex items-center gap-2 text-sm font-medium text-neutral-600 transition-colors hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-neutral-100";

	return (
		<a className={classes} href={artifact.downloadPath} download>
			{children}
			<ArrowIcon />
		</a>
	);
}

function formatSize(byteSize: number): string {
	return `${Math.round(byteSize / 1024 / 1024)} MB`;
}

function App() {
	const [theme, setTheme] = useState<Theme>(readTheme);
	const [menuOpen, setMenuOpen] = useState(false);

	useEffect(() => {
		window.localStorage.setItem("theme", theme);
		applyTheme(theme);

		if (theme !== "system") return;
		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const handleChange = () => applyTheme("system");
		media.addEventListener("change", handleChange);
		return () => media.removeEventListener("change", handleChange);
	}, [theme]);

	useEffect(() => {
		if (!menuOpen) return;
		const previousOverflow = document.body.style.overflow;
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") setMenuOpen(false);
		};

		document.body.style.overflow = "hidden";
		window.addEventListener("keydown", handleKeyDown);
		return () => {
			document.body.style.overflow = previousOverflow;
			window.removeEventListener("keydown", handleKeyDown);
		};
	}, [menuOpen]);

	useEffect(() => {
		const elements = Array.from(
			document.querySelectorAll<HTMLElement>("[data-scroll-reveal]"),
		);
		const revealAll = () => {
			elements.forEach((element) => {
				element.dataset.revealed = "true";
			});
		};

		if (
			window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
			!("IntersectionObserver" in window)
		) {
			revealAll();
			return;
		}

		const observer = new IntersectionObserver(
			(entries) => {
				entries.forEach((entry) => {
					if (!entry.isIntersecting) return;
					(entry.target as HTMLElement).dataset.revealed = "true";
					observer.unobserve(entry.target);
				});
			},
			{ rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
		);

		elements.forEach((element) => observer.observe(element));
		return () => observer.disconnect();
	}, []);

	const cycleTheme = () => {
		const currentIndex = themeOrder.indexOf(theme);
		setTheme(themeOrder[(currentIndex + 1) % themeOrder.length] ?? "system");
	};

	const closeMenu = () => setMenuOpen(false);

	return (
		<div className="min-h-screen bg-white text-neutral-950 dark:bg-neutral-950 dark:text-neutral-100">
			<a
				href="#main"
				className="fixed left-4 top-3 z-[60] -translate-y-20 rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white focus:translate-y-0 dark:bg-neutral-100 dark:text-neutral-900"
			>
				Skip to content
			</a>

			<div className="sticky top-0 z-50">
				<header className="border-b border-neutral-100 bg-white/85 backdrop-blur-sm dark:border-neutral-900 dark:bg-neutral-950/85">
					<div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-6">
						<a href="#" className="flex items-center gap-2.5" aria-label="Aladdeen Research home">
							<img src="/icon.svg" alt="" className="h-7 w-7 rounded-md" />
							<span className="text-sm font-semibold tracking-tight">Aladdeen</span>
							<span className="-ml-1 font-serif text-[15px] italic text-neutral-500 dark:text-neutral-400">Research</span>
						</a>

						<nav aria-label="Primary" className="hidden items-center gap-6 md:flex">
							<a href="#product" className="text-sm text-neutral-500 transition-colors hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-neutral-100">Product</a>
							<a href="#privacy" className="text-sm text-neutral-500 transition-colors hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-neutral-100">Privacy</a>
							<a href="#faq" className="text-sm text-neutral-500 transition-colors hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-neutral-100">FAQ</a>
							<a href="#download" className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300">Download</a>
							<button
								type="button"
								onClick={cycleTheme}
								className="rounded-full p-2 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-900 dark:hover:text-neutral-300"
								aria-label={`Theme: ${theme}. Switch theme`}
								title={`Theme: ${theme}`}
							>
								<ThemeIcon theme={theme} />
							</button>
						</nav>

						<div className="flex items-center gap-1 md:hidden">
							<button
								type="button"
								onClick={cycleTheme}
								className="rounded-full p-2 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-900 dark:hover:text-neutral-300"
								aria-label={`Theme: ${theme}. Switch theme`}
								title={`Theme: ${theme}`}
							>
								<ThemeIcon theme={theme} />
							</button>
							<button
								type="button"
								onClick={() => setMenuOpen((open) => !open)}
								className="rounded-full p-2 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-neutral-100"
								aria-expanded={menuOpen}
								aria-controls="mobile-navigation"
								aria-label={menuOpen ? "Close menu" : "Open menu"}
							>
								<MenuIcon open={menuOpen} />
							</button>
						</div>
					</div>
				</header>

				{menuOpen ? (
					<nav id="mobile-navigation" aria-label="Mobile" className="absolute inset-x-0 top-full h-[calc(100dvh-5.5rem)] overflow-y-auto bg-white px-6 py-10 dark:bg-neutral-950 md:hidden">
						<div className="mx-auto flex max-w-2xl flex-col gap-6">
							<a onClick={closeMenu} href="#product" className="text-xl font-semibold">Product</a>
							<a onClick={closeMenu} href="#privacy" className="text-xl font-semibold">Privacy</a>
							<a onClick={closeMenu} href="#download" className="text-xl font-semibold">Download</a>
							<a onClick={closeMenu} href="#faq" className="text-xl font-semibold">FAQ</a>
							<p className="mt-6 border-t border-neutral-100 pt-6 text-sm text-neutral-400 dark:border-neutral-800 dark:text-neutral-400">
								Local-first workspace. Offline by default. Free during beta.
							</p>
						</div>
					</nav>
				) : null}
			</div>

			<main id="main">
				<section className="mx-auto w-full max-w-5xl px-6 pb-12 pt-20 md:pb-20 md:pt-28">
					<div className="max-w-3xl">
						<p className="text-sm text-neutral-400 dark:text-neutral-400">
							Aladdeen Research · Beta {CURRENT_RELEASE} · macOS arm64 · M-series Apple silicon
						</p>
						<h1 className="mt-5 max-w-2xl text-4xl font-bold tracking-[-0.035em] text-balance text-neutral-950 dark:text-neutral-50 md:text-6xl md:leading-[1.03]">
							Your research, one calm workspace.
						</h1>
						<p className="mt-6 max-w-2xl text-[17px] leading-relaxed text-neutral-600 dark:text-neutral-400">
							Read, edit, organize, and search Markdown, HTML, Word, PDF, Excel, and PowerPoint files in place—each format opening in a workspace built for it, with no conversion step.
						</p>
						<p className="mt-4 max-w-2xl text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">
							Everything stays local and works offline. Your files are read from and written back to their original locations, so they remain readable by every other application you use.
						</p>
						<div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
							<DownloadLink artifact={RELEASE_ARTIFACTS.arm64} primary>
								Download for macOS arm64
							</DownloadLink>
							<a
								href="#product"
								className="inline-flex items-center gap-2 text-sm font-medium text-neutral-600 transition-colors hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-neutral-100"
							>
								See what it does
								<ArrowIcon />
							</a>
						</div>
						<p className="mt-4 text-xs text-neutral-400 dark:text-neutral-400">
							Free to use · Beta preview · Ad-hoc signed
						</p>
					</div>

					<figure className="mt-14 md:mt-20">
						<div className="overflow-hidden rounded-md border border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900">
							<img
								src="/screenshots/xlsx-dark.png"
								alt="Aladdeen Research in dark mode editing a large XLSX spreadsheet beside the project sidebar"
								width="2560"
								height="1440"
								fetchPriority="high"
								className="block h-auto w-full"
							/>
						</div>
						<figcaption className="mt-3 text-xs text-neutral-400 dark:text-neutral-400">
							Local spreadsheet editing, sheet tools, and project navigation—without importing the workbook into a proprietary library.
						</figcaption>
					</figure>

					<ul className="mt-12 grid border-y border-neutral-100 py-5 text-sm text-neutral-500 dark:border-neutral-800 dark:text-neutral-400 sm:grid-cols-2 lg:grid-cols-4">
						<li className="py-2 lg:py-0">Files stay on disk</li>
						<li className="py-2 lg:py-0">Works fully offline</li>
						<li className="py-2 lg:py-0">Six formats, edited in place</li>
						<li className="py-2 lg:py-0">No proprietary library</li>
					</ul>
				</section>

				<section
					id="product"
				className="mx-auto mt-24 w-full max-w-5xl scroll-mt-24 px-6 md:mt-32"
				>
					<div data-scroll-reveal>
						<p className="text-sm text-neutral-400 dark:text-neutral-400">Features</p>
						<h2 className="mt-5 max-w-2xl text-2xl font-bold tracking-tight text-neutral-950 dark:text-neutral-100 md:text-[28px]">
							A research workspace that adapts to the source.
						</h2>
						<p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-neutral-600 dark:text-neutral-400">
							The interface changes with the document, while organization, search,
							saving, and privacy remain consistent everywhere.
						</p>
					</div>

					<div className="mt-10 divide-y divide-neutral-100 border-y border-neutral-100 dark:divide-neutral-800 dark:border-neutral-800">
						{featureGroups.map((group, index) => (
							<article
								key={group.label}
								data-scroll-reveal
								className="grid gap-6 py-9 md:grid-cols-[9rem_minmax(0,1fr)] md:gap-10"
							>
								<div>
									<p className="font-mono text-xs text-neutral-400 dark:text-neutral-500">
										{String(index + 1).padStart(2, "0")}
									</p>
									<p className="mt-2 text-sm font-medium text-neutral-700 dark:text-neutral-300">
										{group.label}
									</p>
								</div>

								<div className="min-w-0">
									<h3 className="text-lg font-bold tracking-tight text-neutral-950 dark:text-neutral-100">
										{group.title}
									</h3>
									<p className="mt-3 max-w-2xl text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">
										{group.description}
									</p>
									<ul className="mt-7 grid gap-x-10 gap-y-6 sm:grid-cols-2">
										{group.items.map((item) => (
											<li key={item.title}>
												<h4 className="text-[15px] font-medium text-neutral-950 dark:text-neutral-100">
													{item.title}
												</h4>
												<p className="mt-1.5 text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">
													{item.detail}
												</p>
											</li>
										))}
									</ul>
								</div>
							</article>
						))}
					</div>
				</section>

				<section id="privacy" className="mt-24 scroll-mt-24 border-y border-neutral-100 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900/40 md:mt-32">
					<div className="mx-auto w-full max-w-5xl px-6 py-20 md:py-28">
						<div className="max-w-3xl">
							<p className="text-sm text-neutral-400 dark:text-neutral-400">Privacy</p>
							<h2 className="mt-5 text-2xl font-bold tracking-tight text-neutral-950 dark:text-neutral-100 md:text-[28px]">
								Local by default. Offline by design.
							</h2>
							<p className="mt-5 text-[15px] leading-relaxed text-neutral-600 dark:text-neutral-400">
								Aladdeen has no account, no telemetry, and no cloud component. Release builds block outbound network requests outright, so your research cannot leave your Mac through the app.
							</p>
						</div>
						<div className="mt-10 grid gap-px overflow-hidden rounded-lg border border-neutral-200 bg-neutral-200 dark:border-neutral-800 dark:bg-neutral-800 md:grid-cols-2">
							<article className="bg-white p-6 dark:bg-neutral-950">
								<p className="font-mono text-xs text-neutral-400 dark:text-neutral-500">01 · Your documents</p>
								<h3 className="mt-4 text-lg font-bold tracking-tight">Read and written in place.</h3>
								<p className="mt-3 text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">
									Files are read from their existing folders and saved back to the same path. Search, editing, previews, local assets, and export all work without an account or an internet connection. Only workspace metadata, such as recent files and indexes, is kept in local SQLite.
								</p>
							</article>
							<article className="bg-white p-6 dark:bg-neutral-950">
								<p className="font-mono text-xs text-neutral-400 dark:text-neutral-500">02 · Nothing leaves</p>
								<h3 className="mt-4 text-lg font-bold tracking-tight">Enforced, not just promised.</h3>
								<p className="mt-3 text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">
									Offline is enforced at the network layer: the app cancels outbound HTTP and WebSocket requests in release builds. Remote images are blocked in previews, and the renderer runs sandboxed under a strict content security policy.
								</p>
							</article>
						</div>
						<p className="mt-6 text-[15px] font-semibold leading-relaxed text-neutral-700 dark:text-neutral-300">
							Your source files stay portable, inspectable, and entirely under your control.
						</p>
					</div>
				</section>

				<section id="download" className="mx-auto mt-24 w-full max-w-5xl scroll-mt-24 px-6 md:mt-32">
					<div className="max-w-2xl">
						<p className="text-sm text-neutral-400 dark:text-neutral-400">Download</p>
						<h2 className="mt-5 text-2xl font-bold tracking-tight text-neutral-950 dark:text-neutral-100 md:text-[28px]">
							Built for the Mac you have.
						</h2>
						<p className="mt-4 text-[15px] leading-relaxed text-neutral-600 dark:text-neutral-400">
							Version {CURRENT_RELEASE} is a free macOS arm64 beta for M-series Macs (M1 or newer). Aladdeen remains under active development, with new capabilities and refinements added day by day along its roadmap. The installer is delivered from a private Cloudflare R2 bucket through this site. It is ad-hoc signed for bundle integrity but is not Apple notarized.
						</p>
					</div>

					<div className="mt-8 divide-y divide-neutral-100 border-y border-neutral-100 dark:divide-neutral-800 dark:border-neutral-800">
						{Object.values(RELEASE_ARTIFACTS).map((artifact) => (
							<div key={artifact.architecture} className="flex flex-col gap-5 py-6 sm:flex-row sm:items-center sm:justify-between">
								<div>
									<h3 className="text-[15px] font-medium text-neutral-950 dark:text-neutral-100">{artifact.label}</h3>
									<p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{artifact.description}</p>
									<p className="mt-2 font-mono text-xs text-neutral-400 dark:text-neutral-400">
										{artifact.filename} · {formatSize(artifact.byteSize)}
									</p>
								</div>
								<DownloadLink artifact={artifact} primary={artifact.architecture === "arm64"}>
									Download DMG
								</DownloadLink>
							</div>
						))}
					</div>

					<div className="mt-8 max-w-3xl">
						<p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">SHA-256 checksums</p>
						<div
							className="mt-3 space-y-3 overflow-x-auto rounded-md bg-neutral-50 p-4 font-mono text-xs text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400"
							role="region"
							aria-label="Release checksums"
							tabIndex={0}
						>
							{Object.values(RELEASE_ARTIFACTS).map((artifact) => (
								<p key={artifact.architecture} className="min-w-max">
									{artifact.sha256} &nbsp;{artifact.filename}
								</p>
							))}
						</div>
					</div>

					<div className="mt-8 max-w-3xl rounded-md border border-amber-200 bg-amber-50 p-5 text-sm leading-relaxed text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200">
						<h3 className="font-semibold">First launch on macOS</h3>
						<ol className="mt-3 list-decimal space-y-2 pl-5">
							<li>Open the DMG and drag Aladdeen into Applications.</li>
							<li>Try to open Aladdeen once, then dismiss the macOS warning.</li>
							<li>Open System Settings → Privacy & Security and scroll to Security.</li>
							<li>Click Open Anyway, authenticate, then confirm Open Anyway.</li>
						</ol>
					</div>
				</section>

				<section id="faq" className="mx-auto mt-24 w-full max-w-5xl scroll-mt-24 px-6 md:mt-32">
					<div className="max-w-2xl">
						<p className="text-sm text-neutral-400 dark:text-neutral-400">FAQ</p>
						<h2 className="mt-5 text-2xl font-bold tracking-tight text-neutral-950 dark:text-neutral-100 md:text-[28px]">
							A few useful answers.
						</h2>
					</div>
					<div className="mt-8 divide-y divide-neutral-100 border-y border-neutral-100 dark:divide-neutral-800 dark:border-neutral-800">
						{faqItems.map((item) => (
							<details key={item.question} className="group py-5">
								<summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-[15px] font-medium text-neutral-950 dark:text-neutral-100">
									{item.question}
									<span aria-hidden="true" className="text-neutral-400 transition-colors group-open:text-neutral-900 dark:text-neutral-400 dark:group-open:text-neutral-100">+</span>
								</summary>
								<p className="mt-3 max-w-2xl text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">{item.answer}</p>
							</details>
						))}
					</div>
				</section>

				<section className="mx-auto w-full max-w-5xl px-6 py-24 md:py-32">
					<span className="block h-0.5 w-4 bg-violet-500" />
					<div className="mt-6 max-w-2xl">
						<h2 className="text-2xl font-bold tracking-tight text-neutral-950 dark:text-neutral-100 md:text-[28px]">
							Open a file. Keep the file. Leave with the file.
						</h2>
						<p className="mt-4 text-[15px] leading-relaxed text-neutral-600 dark:text-neutral-400">
							Aladdeen keeps different source formats together without asking them to become anything else—and leaves every file exactly where you put it.
						</p>
						<div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-3">
							<DownloadLink artifact={RELEASE_ARTIFACTS.arm64} primary>
								Download for macOS arm64
							</DownloadLink>
						</div>
					</div>
				</section>
			</main>

			<footer className="border-t border-neutral-100 dark:border-neutral-800">
				<div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-6 py-8 text-sm text-neutral-400 dark:text-neutral-400 sm:flex-row sm:items-center sm:justify-between">
					<p>Aladdeen Research · Local files. Offline by default.</p>
					<div className="flex items-center gap-5">
						<a href="#privacy" className="transition-colors hover:text-neutral-900 dark:hover:text-neutral-100">Privacy</a>
						<a href="#download" className="transition-colors hover:text-neutral-900 dark:hover:text-neutral-100">Download</a>
					</div>
				</div>
			</footer>
		</div>
	);
}

export default App;
