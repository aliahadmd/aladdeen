import { useEffect, useState, type ReactNode } from "react";

import {
	CURRENT_RELEASE,
	RELEASE_ARTIFACTS,
	type ReleaseArtifact,
} from "../shared/releases";

type Theme = "light" | "dark" | "system";

const themeOrder: Theme[] = ["light", "dark", "system"];

const featureRows = [
	{
		title: "Preview-first reading",
		detail: "Open Markdown in a calm rendered view, then reveal the editor only when you need it.",
		meta: "Read",
	},
	{
		title: "Folders stay folders",
		detail: "Link projects and individual files without moving or importing the source Markdown.",
		meta: "Organize",
	},
	{
		title: "Search across projects",
		detail: "Find source text throughout an environment and jump directly to the exact match.",
		meta: "Find",
	},
	{
		title: "Atomic autosave",
		detail: "Edits save quietly, with explicit recovery when a file changes outside Aladdeen.",
		meta: "Protect",
	},
	{
		title: "Markdown that travels",
		detail: "GFM tables, tasks, code, math, diagrams, callouts, and local images render without lock-in.",
		meta: "Render",
	},
	{
		title: "Clean handoff",
		detail: "Export finished documents to PDF or DOCX locally, without sending the source anywhere.",
		meta: "Export",
	},
] as const;

const faqItems = [
	{
		question: "Where are my Markdown files stored?",
		answer:
			"Exactly where you already keep them. Aladdeen reads and writes ordinary .md files on disk; it does not copy your document content into its database.",
	},
	{
		question: "Does Aladdeen need an internet connection?",
		answer:
			"No. Reading, editing, searching, local images, and PDF or DOCX export work offline. Aladdeen does not provide cloud sync or fetch remote images.",
	},
	{
		question: "Which platforms can I download today?",
		answer:
			`Aladdeen v${CURRENT_RELEASE} is made only for Apple silicon Macs with an M1 or newer chip.`,
	},
	{
		question: "Why does macOS show a warning?",
		answer:
			"Aladdeen is ad-hoc signed for bundle integrity but is not Apple notarized. After trying to open it once, go to System Settings → Privacy & Security, scroll to Security, click Open Anyway, authenticate, and confirm Open Anyway.",
	},
	{
		question: "Can I leave Aladdeen later?",
		answer:
			"Yes. Your work remains plain Markdown in your folders, so any text editor can open it. There is no proprietary document format to export from.",
	},
	{
		question: "Is Aladdeen free?",
		answer:
			"Yes. Aladdeen is completely free to download and use. Its source repository is private, and official downloads are available only from this website.",
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

function Showcase({
	label,
	title,
	description,
	image,
	alt,
	caption,
}: {
	label: string;
	title: string;
	description: string;
	image: string;
	alt: string;
	caption: string;
}): ReactNode {
	return (
		<section className="mt-24 scroll-mt-24 md:mt-32">
			<div className="max-w-2xl">
				<p className="text-sm text-neutral-400 dark:text-neutral-400">{label}</p>
				<h2 className="mt-5 text-2xl font-bold tracking-tight text-neutral-950 dark:text-neutral-100 md:text-[28px]">
					{title}
				</h2>
				<p className="mt-4 max-w-xl text-[15px] leading-relaxed text-neutral-600 dark:text-neutral-400">
					{description}
				</p>
			</div>
			<figure className="mt-8">
				<div className="overflow-hidden rounded-md border border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900">
					<img
						src={image}
						alt={alt}
						loading="lazy"
						className="block h-auto w-full"
					/>
				</div>
				<figcaption className="mt-3 text-xs text-neutral-400 dark:text-neutral-400">
					{caption}
				</figcaption>
			</figure>
		</section>
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

			<header className="sticky top-0 z-50 border-b border-neutral-100 bg-white/85 backdrop-blur-sm dark:border-neutral-900 dark:bg-neutral-950/85">
				<div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-6">
					<a href="#" className="flex items-center gap-2.5" aria-label="Aladdeen home">
						<img src="/icon.svg" alt="" className="h-7 w-7 rounded-md" />
						<span className="text-sm font-semibold tracking-tight">Aladdeen</span>
					</a>

					<nav aria-label="Primary" className="hidden items-center gap-6 md:flex">
						<a href="#features" className="text-sm text-neutral-500 transition-colors hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-neutral-100">Features</a>
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
				<nav id="mobile-navigation" aria-label="Mobile" className="fixed inset-x-0 bottom-0 top-14 z-40 bg-white px-6 py-10 dark:bg-neutral-950 md:hidden">
					<div className="mx-auto flex max-w-2xl flex-col gap-6">
						<a onClick={closeMenu} href="#features" className="text-xl font-semibold">Features</a>
						<a onClick={closeMenu} href="#privacy" className="text-xl font-semibold">Privacy</a>
						<a onClick={closeMenu} href="#download" className="text-xl font-semibold">Download</a>
						<a onClick={closeMenu} href="#faq" className="text-xl font-semibold">FAQ</a>
						<p className="mt-6 border-t border-neutral-100 pt-6 text-sm text-neutral-400 dark:border-neutral-800 dark:text-neutral-400">
							Free, private, and offline-first.
						</p>
					</div>
				</nav>
			) : null}

			<main id="main">
				<section className="mx-auto w-full max-w-5xl px-6 pb-12 pt-20 md:pb-20 md:pt-28">
					<div className="max-w-3xl">
						<p className="text-sm text-neutral-400 dark:text-neutral-400">
							Aladdeen for Apple silicon · Preview {CURRENT_RELEASE}
						</p>
						<h1 className="mt-5 max-w-2xl text-4xl font-bold tracking-[-0.035em] text-balance text-neutral-950 dark:text-neutral-50 md:text-6xl md:leading-[1.03]">
							All your Markdown, one calm place.
						</h1>
						<p className="mt-6 max-w-xl text-[17px] leading-relaxed text-neutral-600 dark:text-neutral-400">
							Made only for Apple silicon Macs. A responsive, offline-first workspace for reading, editing, finding, and exporting the files you already own.
						</p>
						<div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
							<DownloadLink artifact={RELEASE_ARTIFACTS.arm64} primary>
								Download for Apple Silicon
							</DownloadLink>
						</div>
						<p className="mt-4 text-xs text-neutral-400 dark:text-neutral-400">
							Free to use · Ad-hoc signed preview build
						</p>
					</div>

					<figure className="mt-14 md:mt-20">
						<div className="overflow-hidden rounded-md border border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900">
							<img
								src="/screenshots/markdown-light.png"
								alt="Aladdeen displaying a Markdown document with a project sidebar and reading view"
								fetchPriority="high"
								className="block h-auto w-full"
							/>
						</div>
						<figcaption className="mt-3 text-xs text-neutral-400 dark:text-neutral-400">
							Preview-first reading with files, projects, outline, editing, and export close at hand.
						</figcaption>
					</figure>

					<ul className="mt-12 grid border-y border-neutral-100 py-5 text-sm text-neutral-500 dark:border-neutral-800 dark:text-neutral-400 sm:grid-cols-2 lg:grid-cols-4">
						<li className="py-2 lg:py-0">Files stay on disk</li>
						<li className="py-2 lg:py-0">Works offline</li>
						<li className="py-2 lg:py-0">PDF and DOCX export</li>
						<li className="py-2 lg:py-0">Free to use</li>
					</ul>
				</section>

				<div id="features" className="mx-auto w-full max-w-5xl scroll-mt-24 px-6">
					<Showcase
						label="Read"
						title="Start with the document, not the editor."
						description="Aladdeen opens into a clean rendered page. Toggle editing when the words need work, keep a live preview beside the source, then return to reading without rearranging your workspace."
						image="/screenshots/outline-light.png"
						alt="A Markdown document in Aladdeen with its heading outline open"
						caption="A document outline keeps long files navigable without adding permanent chrome."
					/>

					<Showcase
						label="Find"
						title="Search the environment, land on the line."
						description="Search Markdown source across every indexed project and standalone file. Results stream in as they are found, and selecting one opens the document at the exact match."
						image="/screenshots/search-dark.png"
						alt="Aladdeen global content search in dark mode"
						caption="Environment-wide search is cancellable, keyboard-friendly, and exact."
					/>

					<Showcase
						label="Organize"
						title="Bring folders together without moving them."
						description="Create named environments, link full projects or selected folders, and keep independent files beside them. Aladdeen remembers the working set while the Markdown remains where it belongs."
						image="/screenshots/sidebar-light.png"
						alt="Aladdeen responsive project sidebar open over a compact window"
						caption="The responsive sidebar keeps projects available without crowding smaller windows."
					/>

					<section className="mt-24 md:mt-32">
						<p className="text-sm text-neutral-400 dark:text-neutral-400">Details</p>
						<h2 className="mt-5 max-w-2xl text-2xl font-bold tracking-tight text-neutral-950 dark:text-neutral-100 md:text-[28px]">
							The quiet features add up.
						</h2>
						<ul className="mt-8 divide-y divide-neutral-100 border-y border-neutral-100 dark:divide-neutral-800 dark:border-neutral-800">
							{featureRows.map((feature) => (
								<li key={feature.title} className="flex flex-col gap-2 py-5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-8">
									<div className="min-w-0">
										<h3 className="text-[15px] font-medium text-neutral-950 dark:text-neutral-100">{feature.title}</h3>
										<p className="mt-1 max-w-2xl text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">{feature.detail}</p>
									</div>
									<span className="shrink-0 font-mono text-xs text-neutral-400 dark:text-neutral-400">{feature.meta}</span>
								</li>
							))}
						</ul>
					</section>
				</div>

				<section id="privacy" className="mt-24 scroll-mt-24 border-y border-neutral-100 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900/40 md:mt-32">
					<div className="mx-auto w-full max-w-5xl px-6 py-20 md:py-28">
						<div className="max-w-2xl">
							<p className="text-sm text-neutral-400 dark:text-neutral-400">Privacy</p>
							<h2 className="mt-5 text-2xl font-bold tracking-tight text-neutral-950 dark:text-neutral-100 md:text-[28px]">
								Local-first is the architecture, not a setting.
							</h2>
							<p className="mt-5 text-[15px] leading-relaxed text-neutral-600 dark:text-neutral-400">
								Markdown content is read from your folders and saved back atomically. Aladdeen stores only workspace metadata—things like recent files and project indexes—in a local SQLite database. It does not import your writing, add cloud sync, fetch remote images, or require an account.
							</p>
							<p className="mt-4 text-[15px] font-semibold leading-relaxed text-neutral-700 dark:text-neutral-300">
								Your files stay portable, inspectable, and under your control.
							</p>
						</div>
					</div>
				</section>

				<section id="download" className="mx-auto mt-24 w-full max-w-5xl scroll-mt-24 px-6 md:mt-32">
					<div className="max-w-2xl">
						<p className="text-sm text-neutral-400 dark:text-neutral-400">Download</p>
						<h2 className="mt-5 text-2xl font-bold tracking-tight text-neutral-950 dark:text-neutral-100 md:text-[28px]">
							Built for the Mac you have.
						</h2>
						<p className="mt-4 text-[15px] leading-relaxed text-neutral-600 dark:text-neutral-400">
							Version {CURRENT_RELEASE} is a free Apple silicon preview for M1 and newer Macs. The installer is delivered from a private Cloudflare R2 bucket through this site. It is ad-hoc signed for bundle integrity but is not Apple notarized.
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
							Open a file. Keep the file.
						</h2>
						<p className="mt-4 text-[15px] leading-relaxed text-neutral-600 dark:text-neutral-400">
							Aladdeen gives Markdown a comfortable desktop home without asking it to become anything else.
						</p>
						<div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-3">
							<DownloadLink artifact={RELEASE_ARTIFACTS.arm64} primary>
								Download for Apple Silicon
							</DownloadLink>
						</div>
					</div>
				</section>
			</main>

			<footer className="border-t border-neutral-100 dark:border-neutral-800">
				<div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-6 py-8 text-sm text-neutral-400 dark:text-neutral-400 sm:flex-row sm:items-center sm:justify-between">
					<p>Aladdeen · Markdown stays yours.</p>
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
