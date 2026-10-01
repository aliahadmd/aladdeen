import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RELEASE_ARTIFACTS } from "../shared/releases";
import App from "./App";
import { screenshots } from "./content";

// Every file under public/screenshots, keyed by its path relative to this test.
const publicScreenshots = Object.keys(import.meta.glob("../../public/screenshots/*"));

describe("Aladdeen landing page", () => {
	beforeEach(() => {
		window.localStorage.clear();
		document.documentElement.classList.remove("dark");
	});

	afterEach(() => {
		cleanup();
		document.body.style.overflow = "";
	});

	it("leads with the product promise and every section", () => {
		render(<App />);

		expect(
			screen.getByRole("heading", { level: 1, name: "Every research file. One calm workspace." }),
		).toBeInTheDocument();
		for (const id of ["tour", "formats", "privacy", "download", "faq"]) {
			expect(document.getElementById(id)).toBeInTheDocument();
		}
		for (const heading of [
			"One window. Every format.",
			"The right tools for each file.",
			"Your files never move.",
			"Find the passage, not just the file.",
			"Up and running in a minute.",
			"Private by design. Offline by default.",
			"Questions, answered.",
		]) {
			expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
		}
	});

	it("shows real app screenshots that exist in the site's public folder", () => {
		render(<App />);

		const sources = new Set(
			Array.from(document.querySelectorAll<HTMLImageElement>("img[src^='/screenshots/']"), (image) => image.getAttribute("src")),
		);
		expect(sources).toEqual(new Set(Object.values(screenshots).map((image) => image.src)));
		for (const image of Object.values(screenshots)) {
			expect(publicScreenshots, image.src).toContain(`../../public${image.src}`);
			expect(image.alt.length).toBeGreaterThan(10);
		}
	});

	// The desktop app ships no coding agent, so the site must not advertise one.
	it("advertises no AI agent, provider, or credential functionality", () => {
		render(<App />);

		for (const term of [
			/coding agent/i,
			/\bAI\b/,
			/chatbot/i,
			/\bprompts?\b/i,
			/API key/i,
			/OpenRouter/i,
			/ChatGPT/i,
			/Claude/i,
			/provider/i,
		]) {
			expect(document.body.textContent).not.toMatch(term);
		}
	});

	it("links every download button to the versioned macOS arm64 route", () => {
		render(<App />);

		const links = screen.getAllByRole("link", { name: /^Download for Mac/ });
		expect(links.length).toBeGreaterThanOrEqual(3);
		for (const link of links) {
			expect(link).toHaveAttribute("href", RELEASE_ARTIFACTS.arm64.downloadPath);
			expect(link).toHaveTextContent(`macOS arm64, version ${RELEASE_ARTIFACTS.arm64.version}`);
		}
		expect(Object.keys(RELEASE_ARTIFACTS)).toEqual(["arm64"]);
		expect(screen.getAllByText(/Open Anyway/).length).toBeGreaterThan(0);
		expect(screen.getByText(RELEASE_ARTIFACTS.arm64.sha256)).toBeInTheDocument();
	});

	it("switches tour slides by click and arrow keys", () => {
		render(<App />);

		const tabs = within(screen.getByRole("tablist", { name: "Document formats" })).getAllByRole("tab");
		expect(tabs.map((tab) => tab.textContent)).toEqual(["Markdown", "Excel", "PowerPoint"]);
		expect(tabs[0]).toHaveAttribute("aria-selected", "true");

		fireEvent.click(tabs[1]!);
		expect(tabs[1]).toHaveAttribute("aria-selected", "true");
		expect(screen.getByRole("tabpanel", { name: "Excel" })).toHaveTextContent("Real spreadsheets");

		fireEvent.keyDown(tabs[1]!, { key: "ArrowRight" });
		expect(tabs[2]).toHaveAttribute("aria-selected", "true");
		expect(tabs[2]).toHaveFocus();
	});

	it("expands and collapses FAQ answers", () => {
		render(<App />);

		const question = screen.getByRole("button", { name: "Which Macs are supported?" });
		expect(question).toHaveAttribute("aria-expanded", "false");
		fireEvent.click(question);
		expect(question).toHaveAttribute("aria-expanded", "true");
		expect(screen.getByRole("region", { name: "Which Macs are supported?" })).toHaveTextContent(
			`Aladdeen ${RELEASE_ARTIFACTS.arm64.version} runs on Macs with Apple silicon`,
		);
	});

	it("cycles and persists the three-state theme control", () => {
		render(<App />);

		fireEvent.click(screen.getByRole("button", { name: /Theme: system/ }));

		expect(window.localStorage.getItem("theme")).toBe("light");
		expect(screen.getByRole("button", { name: /Theme: light/ })).toBeInTheDocument();
	});

	it("opens and closes the mobile navigation accessibly", () => {
		render(<App />);

		fireEvent.click(screen.getByRole("button", { name: "Open menu" }));

		expect(screen.getByRole("navigation", { name: "Mobile" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Close menu" })).toHaveAttribute("aria-expanded", "true");
		expect(document.body.style.overflow).toBe("hidden");
		fireEvent.keyDown(window, { key: "Escape" });
		expect(screen.queryByRole("navigation", { name: "Mobile" })).not.toBeInTheDocument();
	});
});
