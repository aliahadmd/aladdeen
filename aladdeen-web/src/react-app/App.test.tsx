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
			screen.getByText(/still in beta and under active development/i),
		).toBeInTheDocument();
		expect(
			screen.getByRole("heading", {
				name: "A research workspace that adapts to the source.",
			}),
		).toBeInTheDocument();
		expect(
			screen.getByRole("heading", {
				name: "Local-first is the architecture, not a setting.",
			}),
		).toBeInTheDocument();
		expect(document.querySelector("#features")).toBeInTheDocument();
		expect(document.querySelector("#privacy")).toBeInTheDocument();
		expect(document.querySelector("#faq")).toBeInTheDocument();
		expect(
			screen.getByRole("heading", {
				name: "Four formats, each with the right workspace.",
			}),
		).toBeInTheDocument();
		expect(
			screen.getByRole("heading", {
				name: "Find the document, heading, or exact source line.",
			}),
		).toBeInTheDocument();
		expect(document.querySelectorAll("#features img")).toHaveLength(0);
		expect(
			screen.queryByText(/Aladdeen must not be used in ways that harm people/),
		).not.toBeInTheDocument();
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
