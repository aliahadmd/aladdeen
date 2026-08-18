import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RELEASE_ARTIFACTS } from "../shared/releases";
import App from "./App";

describe("Aladdeen landing page", () => {
	beforeEach(() => {
		window.localStorage.clear();
		document.documentElement.classList.remove("dark");
	});

	afterEach(() => {
		cleanup();
		document.body.style.overflow = "";
	});

	it("renders the product promise and real feature sections", () => {
		render(<App />);

		expect(
			screen.getByRole("heading", {
				name: "Your research, one calm workspace.",
			}),
		).toBeInTheDocument();
		expect(
			screen.getByText(/Everything stays local and works offline/i),
		).toBeInTheDocument();
		expect(
			screen.getByRole("img", {
				name: /editing a large XLSX spreadsheet beside the project sidebar/i,
			}),
		).toHaveAttribute("src", "/screenshots/xlsx-dark.png");
		expect(
			screen.getByRole("heading", {
				name: "A research workspace that adapts to the source.",
			}),
		).toBeInTheDocument();
		expect(
			screen.getByRole("heading", {
				name: "Local by default. Offline by design.",
			}),
		).toBeInTheDocument();
		expect(document.querySelector("#product")).toBeInTheDocument();
		expect(document.querySelector("#privacy")).toBeInTheDocument();
		expect(document.querySelector("#faq")).toBeInTheDocument();
		expect(
			screen.getByRole("heading", {
				name: "Six formats, each with the right workspace.",
			}),
		).toBeInTheDocument();
		expect(
			screen.getByRole("heading", {
				name: "Find the document, heading, or exact source line.",
			}),
		).toBeInTheDocument();
		expect(document.querySelectorAll("#product img")).toHaveLength(0);
		expect(
			screen.queryByText(/Aladdeen must not be used in ways that harm people/),
		).not.toBeInTheDocument();
	});

	// The desktop app ships no coding agent, so the site must not advertise one.
	// This guards against the stale marketing copy creeping back in.
	it("advertises no AI agent, provider, or credential functionality", () => {
		render(<App />);

		expect(document.querySelector("#agent")).toBeNull();
		expect(document.querySelector('a[href="#agent"]')).toBeNull();
		expect(
			document.querySelector('img[src="/screenshots/agent-project-dark.png"]'),
		).toBeNull();

		for (const term of [
			/coding agent/i,
			/optional agent/i,
			/\bAI\b/,
			/chatbot/i,
			/\bprompts?\b/i,
			/API key/i,
			/OpenRouter/i,
			/DeepSeek/i,
			/ChatGPT/i,
			/Claude/i,
			/provider/i,
		]) {
			expect(document.body.textContent).not.toMatch(term);
		}
	});

	it("links only the macOS arm64 download to its versioned Worker route", () => {
		render(<App />);

		const appleLinks = screen.getAllByRole("link", {
			name: /Download for macOS arm64/,
		});
		expect(appleLinks[0]).toHaveAttribute(
			"href",
			RELEASE_ARTIFACTS.arm64.downloadPath,
		);
		expect(Object.keys(RELEASE_ARTIFACTS)).toEqual(["arm64"]);
		expect(screen.getAllByText(/Open Anyway/).length).toBeGreaterThan(0);
		expect(
			screen.getByText(RELEASE_ARTIFACTS.arm64.sha256, { exact: false }),
		).toBeInTheDocument();
	});

	it("cycles and persists the three-state theme control", () => {
		render(<App />);

		const themeButtons = screen.getAllByRole("button", {
			name: /Theme: system/,
		});
		fireEvent.click(themeButtons[0]);

		expect(window.localStorage.getItem("theme")).toBe("light");
		expect(
			screen.getAllByRole("button", { name: /Theme: light/ }).length,
		).toBeGreaterThan(0);
	});

	it("opens and closes the mobile navigation accessibly", () => {
		render(<App />);

		const menuButton = screen.getByRole("button", { name: "Open menu" });
		fireEvent.click(menuButton);

		expect(
			screen.getByRole("navigation", { name: "Mobile" }),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Close menu" })).toHaveAttribute(
			"aria-expanded",
			"true",
		);
		fireEvent.keyDown(window, { key: "Escape" });
		expect(
			screen.queryByRole("navigation", { name: "Mobile" }),
		).not.toBeInTheDocument();
	});
});
