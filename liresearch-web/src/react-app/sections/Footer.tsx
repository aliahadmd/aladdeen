import type { CSSProperties, ReactNode } from "react";

import type { ReleaseArtifact } from "../../shared/releases";
import { navLinks } from "../content";
import { BrandMark, DownloadButton } from "../ui";

export function FinalCallToAction({ artifact }: { artifact: ReleaseArtifact }): ReactNode {
	return (
		<section className="relative overflow-hidden px-5 pb-28 pt-12 md:px-8 md:pb-36">
			<div className="relative mx-auto flex max-w-3xl flex-col items-center text-center">
				<div data-reveal="scale" className="relative grid h-40 w-40 place-items-center">
					<div aria-hidden="true" className="prism-glow absolute inset-0 rounded-full bg-[var(--prism-glow)] blur-[40px]" />
					<BrandMark className="relative h-24 w-24 shadow-[0_20px_50px_-15px_var(--prism-glow)]" />
				</div>
				<h2 data-reveal style={{ "--delay": "100ms" } as CSSProperties} className="mt-8 text-balance text-5xl font-bold tracking-[-0.045em] text-ink md:text-6xl">
					Your research, <span className="text-shimmer">connected.</span>
				</h2>
				<p data-reveal style={{ "--delay": "180ms" } as CSSProperties} className="mt-5 max-w-xl text-lg leading-relaxed text-ink-soft">
					Every file in one calm place, and nothing ever leaves your Mac. Zero cloud, zero catch.
				</p>
				<div data-reveal style={{ "--delay": "260ms" } as CSSProperties} className="mt-9">
					<DownloadButton artifact={artifact} size="lg" />
				</div>
			</div>
		</section>
	);
}

export function Footer({ artifact }: { artifact: ReleaseArtifact }): ReactNode {
	return (
		<footer className="border-t border-line">
			<div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 py-12 md:flex-row md:items-center md:justify-between md:px-8">
				<div className="flex items-center gap-3">
					<BrandMark className="h-9 w-9" />
					<div>
						<p className="text-sm font-semibold text-ink">LiResearch</p>
						<p className="text-xs text-ink-faint">
							Version {artifact.version} · Open source (GPLv3)
						</p>
					</div>
				</div>
				<nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-3 text-sm">
					{navLinks.map((link) => (
						<a key={link.href} href={link.href} className="text-ink-soft transition-colors hover:text-ink">
							{link.label}
						</a>
					))}
					<a href="https://github.com/LiLabsAI/LiResearch/releases" className="text-ink-soft transition-colors hover:text-ink">
						Releases
					</a>
					<a href="https://github.com/LiLabsAI/LiResearch" className="text-ink-soft transition-colors hover:text-ink">
						GitHub
					</a>
					<a href="https://github.com/LiLabsAI/LiResearch/blob/main/LICENSE" className="text-ink-soft transition-colors hover:text-ink">
						License
					</a>
				</nav>
				<p className="text-xs text-ink-faint">
					© {new Date().getFullYear()}{" "}
					<a href="https://aliahad.com" className="underline decoration-line-strong underline-offset-4 hover:text-ink">
						Ali Ahad
					</a>
				</p>
			</div>
		</footer>
	);
}
