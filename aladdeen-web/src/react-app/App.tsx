import { useEffect, useState } from "react";

import { RELEASE_ARTIFACTS } from "../shared/releases";
import { useRevealOnScroll } from "./motion";
import { Download } from "./sections/Download";
import { Faq } from "./sections/Faq";
import { FinalCallToAction, Footer } from "./sections/Footer";
import { Formats } from "./sections/Formats";
import { GuidedStart } from "./sections/GuidedStart";
import { Header, type Theme } from "./sections/Header";
import { Hero } from "./sections/Hero";
import { InPlace } from "./sections/InPlace";
import { Marquee } from "./sections/Marquee";
import { Privacy } from "./sections/Privacy";
import { SearchDemo } from "./sections/SearchDemo";
import { Themes } from "./sections/Themes";
import { Tour } from "./sections/Tour";

function readTheme(): Theme {
	if (typeof window === "undefined") return "system";
	const stored = window.localStorage.getItem("theme");
	return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
}

function applyTheme(theme: Theme): void {
	const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
	document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && prefersDark));
}

function App() {
	const [theme, setTheme] = useState<Theme>(readTheme);
	const artifact = RELEASE_ARTIFACTS.arm64;
	useRevealOnScroll();

	useEffect(() => {
		window.localStorage.setItem("theme", theme);
		applyTheme(theme);
		if (theme !== "system") return;
		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const handleChange = (): void => applyTheme("system");
		media.addEventListener("change", handleChange);
		return () => media.removeEventListener("change", handleChange);
	}, [theme]);

	return (
		<div className="min-h-screen bg-paper text-ink">
			<a
				href="#main"
				className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-paper"
			>
				Skip to content
			</a>
			<Header artifact={artifact} theme={theme} onThemeChange={setTheme} />
			<main id="main">
				<Hero artifact={artifact} />
				<Marquee />
				<Tour />
				<Formats />
				<InPlace />
				<SearchDemo />
				<GuidedStart />
				<Themes />
				<Privacy />
				<Download artifact={artifact} />
				<Faq />
				<FinalCallToAction artifact={artifact} />
			</main>
			<Footer artifact={artifact} />
		</div>
	);
}

export default App;
