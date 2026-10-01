import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

import type { ReleaseArtifact } from "../../shared/releases";
import { formatSize } from "../format";
import { CheckIcon, DownloadButton, LampMark, SectionHeading } from "../ui";

const installSteps = [
	{
		title: "Download",
		detail: "Get the disk image (.dmg) for Macs with Apple silicon.",
	},
	{
		title: "Drag to Applications",
		detail: "Open the disk image and drag Aladdeen into your Applications folder.",
	},
	{
		title: "Allow the first launch",
		detail:
			"Aladdeen isn't notarized by Apple yet, so macOS asks first. Open System Settings → Privacy & Security, then click Open Anyway next to Aladdeen. You only do this once.",
	},
] as const;

function CopyChecksum({ value }: { value: string }): ReactNode {
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		if (!copied) return;
		const timer = window.setTimeout(() => setCopied(false), 2000);
		return () => window.clearTimeout(timer);
	}, [copied]);

	const copy = async (): Promise<void> => {
		try {
			await navigator.clipboard.writeText(value);
			setCopied(true);
		} catch {
			// Clipboard access can be refused; the value stays selectable.
		}
	};

	return (
		<button
			type="button"
			onClick={() => void copy()}
			className="shrink-0 rounded-full border border-line px-3 py-1 text-xs font-semibold text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
			aria-live="polite"
		>
			{copied ? (
				<span key="copied" className="rise-in inline-flex items-center gap-1 text-[#22a565]">
					<CheckIcon className="h-3.5 w-3.5" />
					Copied
				</span>
			) : (
				<span key="copy">Copy</span>
			)}
		</button>
	);
}

export function Download({ artifact }: { artifact: ReleaseArtifact }): ReactNode {
	return (
		<section id="download" className="relative mx-auto w-full max-w-6xl px-5 py-24 md:px-8 md:py-32">
			<SectionHeading eyebrow="Download" title="Get Aladdeen for your Mac.">
				Free while Aladdeen is in beta. One download, no account, nothing else to install.
			</SectionHeading>

			<div className="mt-14 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
				<div data-reveal="scale" className="relative overflow-hidden rounded-3xl border border-line-strong bg-raised p-8 shadow-[var(--shadow)] md:p-10">
					<div aria-hidden="true" className="lamp-glow absolute -right-16 -top-20 h-64 w-64 rounded-full bg-[var(--lamp-glow)] blur-[70px]" />
					<div className="relative flex items-center gap-4">
						<LampMark className="h-14 w-14" />
						<div>
							<p className="text-xl font-bold tracking-tight text-ink">Aladdeen Research</p>
							<p className="text-sm text-ink-soft">Version {artifact.version}</p>
						</div>
					</div>

					<dl className="relative mt-8 grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
						<div>
							<dt className="text-ink-faint">Requires</dt>
							<dd className="mt-1 font-medium text-ink">Apple silicon Mac (M1 or newer)</dd>
						</div>
						<div>
							<dt className="text-ink-faint">macOS</dt>
							<dd className="mt-1 font-medium text-ink">12 Monterey or later</dd>
						</div>
						<div>
							<dt className="text-ink-faint">Download size</dt>
							<dd className="mt-1 font-medium text-ink">{formatSize(artifact.byteSize)}</dd>
						</div>
						<div>
							<dt className="text-ink-faint">Price</dt>
							<dd className="mt-1 font-medium text-ink">Free during beta</dd>
						</div>
					</dl>

					<DownloadButton artifact={artifact} size="lg" className="relative mt-8 w-full" />

					<div className="relative mt-6 rounded-xl border border-line bg-paper/60 p-4">
						<div className="flex items-center justify-between gap-3">
							<p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">SHA-256 checksum</p>
							<CopyChecksum value={artifact.sha256} />
						</div>
						<p className="mt-2 break-all font-mono text-xs leading-relaxed text-ink-soft">{artifact.sha256}</p>
					</div>
					<p className="relative mt-4 text-center text-sm text-ink-faint">
						Also on{" "}
						<a className="font-medium text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink" href="https://github.com/aliahadmd/aladdeen/releases/latest">
							GitHub Releases
						</a>
					</p>
				</div>

				<ol className="flex flex-col">
					{installSteps.map((step, index) => (
						<li key={step.title} data-reveal style={{ "--delay": `${index * 110}ms` } as CSSProperties} className="relative flex gap-5 pb-10 last:pb-0">
							{index < installSteps.length - 1 ? (
								<span aria-hidden="true" className="absolute left-5 top-12 bottom-1 w-px bg-gradient-to-b from-line-strong to-transparent" />
							) : null}
							<span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-line-strong bg-raised text-sm font-bold text-ink">
								{index + 1}
							</span>
							<div className="pt-1.5">
								<h3 className="text-lg font-semibold text-ink">{step.title}</h3>
								<p className="mt-1.5 leading-relaxed text-ink-soft">{step.detail}</p>
							</div>
						</li>
					))}
				</ol>
			</div>
		</section>
	);
}
