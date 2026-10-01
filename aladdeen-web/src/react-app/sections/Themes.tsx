import { useState, type CSSProperties, type ReactNode } from "react";

import { screenshots, themePresets } from "../content";
import { SectionHeading, WindowFrame } from "../ui";

export function Themes(): ReactNode {
	const [selected, setSelected] = useState(0);
	const preset = themePresets[selected]!;

	return (
		<section
			className="relative mx-auto w-full max-w-6xl px-5 py-24 md:px-8 md:py-32"
			style={{ "--preset": preset.accent, "--preset-surface": preset.surface } as CSSProperties}
		>
			<div className="grid items-center gap-14 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
				<div data-reveal="scale" className="relative order-last lg:order-first">
					<div
						aria-hidden="true"
						className="absolute inset-[6%] -z-10 rounded-full opacity-50 blur-[90px] transition-[background-color] duration-700"
						style={{ backgroundColor: "var(--preset)" }}
					/>
					<div
						className="rounded-[14px] p-[3px] transition-[background-color] duration-700"
						style={{ backgroundColor: "color-mix(in srgb, var(--preset) 55%, transparent)" }}
					>
						<WindowFrame image={screenshots.appearance} />
					</div>
				</div>

				<div className="flex flex-col gap-8">
					<SectionHeading eyebrow="Make it yours" title="Eight themes. Light or dark." align="left">
						Pick a palette that suits the way you read, and let Aladdeen follow your Mac between light and
						dark. Reading settings tune the font, size, spacing, and column width.
					</SectionHeading>

					<div data-reveal>
						<p className="text-sm font-medium text-ink-faint">
							Theme: <span className="font-semibold text-ink">{preset.name}</span>
						</p>
						<div role="group" aria-label="Preview a theme" className="mt-3 grid grid-cols-4 gap-3 sm:grid-cols-8 lg:grid-cols-4">
							{themePresets.map((theme, index) => {
								const isSelected = index === selected;
								return (
									<button
										key={theme.name}
										type="button"
										aria-pressed={isSelected}
										aria-label={theme.name}
										title={theme.name}
										onClick={() => setSelected(index)}
										onMouseEnter={() => setSelected(index)}
										onFocus={() => setSelected(index)}
										className={`group relative aspect-square rounded-2xl border transition-[translate,border-color,box-shadow] duration-300 ease-out-quint hover:-translate-y-1 ${
											isSelected ? "border-transparent shadow-[0_0_0_2px_var(--preset)]" : "border-line"
										}`}
										style={{ backgroundColor: theme.surface }}
									>
										<span
											className="absolute bottom-2.5 right-2.5 h-4 w-4 rounded-full transition-transform duration-300 group-hover:scale-125"
											style={{ backgroundColor: theme.accent }}
										/>
										<span className="absolute left-2.5 top-2.5 h-1.5 w-6 rounded-full bg-white/50" />
										<span className="absolute left-2.5 top-5 h-1.5 w-4 rounded-full bg-white/25" />
									</button>
								);
							})}
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}
