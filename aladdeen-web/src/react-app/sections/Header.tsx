import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

import type { ReleaseArtifact } from "../../shared/releases";
import { navLinks } from "../content";
import { useScrollProgress } from "../motion";
import { DownloadButton, LampMark } from "../ui";

export type Theme = "light" | "dark" | "system";

const themeOrder: Theme[] = ["light", "dark", "system"];

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

function ThemeButton({ theme, onChange }: { theme: Theme; onChange: (theme: Theme) => void }): ReactNode {
	const next = themeOrder[(themeOrder.indexOf(theme) + 1) % themeOrder.length]!;
	return (
		<button
			type="button"
			onClick={() => onChange(next)}
			aria-label={`Theme: ${theme}. Switch theme`}
			title={`Theme: ${theme}`}
			className="grid h-9 w-9 place-items-center rounded-full border border-line text-ink-soft transition-colors duration-200 hover:border-line-strong hover:text-ink"
		>
			<span key={theme} className="rise-in">
				<ThemeIcon theme={theme} />
			</span>
		</button>
	);
}

export function Header({
	artifact,
	theme,
	onThemeChange,
}: {
	artifact: ReleaseArtifact;
	theme: Theme;
	onThemeChange: (theme: Theme) => void;
}): ReactNode {
	const scrolled = useScrollProgress();
	const [menuOpen, setMenuOpen] = useState(false);

	useEffect(() => {
		if (!menuOpen) return;
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key === "Escape") setMenuOpen(false);
		};
		window.addEventListener("keydown", onKeyDown);
		return () => {
			document.body.style.overflow = previousOverflow;
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [menuOpen]);

	return (
		<header
			className={`fixed inset-x-0 top-0 z-50 transition-[background-color,border-color,backdrop-filter] duration-300 ${
				scrolled || menuOpen
					? "border-b border-line bg-paper/80 backdrop-blur-xl"
					: "border-b border-transparent bg-transparent"
			}`}
		>
			<div
				aria-hidden="true"
				className="absolute inset-x-0 bottom-[-1px] h-px origin-left bg-gradient-to-r from-accent via-[#c084fc] to-lamp"
				style={{ transform: "scaleX(var(--scroll-progress, 0))" }}
			/>
			<div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-5 md:px-8">
				<a href="#top" className="flex items-center gap-2.5" aria-label="Aladdeen Research home">
					<LampMark className="h-8 w-8" />
					<span className="text-[15px] font-semibold tracking-tight text-ink">
						Aladdeen <span className="font-normal text-ink-faint">Research</span>
					</span>
				</a>

				<nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
					{navLinks.map((link) => (
						<a
							key={link.href}
							href={link.href}
							className="rounded-full px-3.5 py-2 text-sm font-medium text-ink-soft transition-colors duration-200 hover:bg-accent-soft hover:text-ink"
						>
							{link.label}
						</a>
					))}
				</nav>

				<div className="flex items-center gap-2">
					<ThemeButton theme={theme} onChange={onThemeChange} />
					<div className="hidden lg:block">
						<DownloadButton artifact={artifact} size="sm" />
					</div>
					<button
						type="button"
						onClick={() => setMenuOpen((open) => !open)}
						aria-expanded={menuOpen}
						aria-controls="mobile-navigation"
						aria-label={menuOpen ? "Close menu" : "Open menu"}
						className="grid h-9 w-9 place-items-center rounded-full border border-line text-ink md:hidden"
					>
						<svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5">
							{menuOpen ? (
								<path d="m5 5 10 10M15 5 5 15" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.75" />
							) : (
								<path d="M3 6h14M3 10h14M3 14h14" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.75" />
							)}
						</svg>
					</button>
				</div>
			</div>

			{menuOpen ? (
				<nav
					id="mobile-navigation"
					aria-label="Mobile"
					className="h-[calc(100dvh-4rem)] overflow-y-auto border-t border-line bg-paper px-6 pb-10 pt-6 md:hidden"
				>
					<ul className="flex flex-col">
						{navLinks.map((link, index) => (
							<li key={link.href} className="rise-in" style={{ "--delay": `${index * 50}ms` } as CSSProperties}>
								<a
									href={link.href}
									onClick={() => setMenuOpen(false)}
									className="flex items-center justify-between border-b border-line py-4 text-2xl font-semibold tracking-tight text-ink"
								>
									{link.label}
								</a>
							</li>
						))}
					</ul>
					<DownloadButton artifact={artifact} size="lg" className="mt-8 w-full" />
				</nav>
			) : null}
		</header>
	);
}
