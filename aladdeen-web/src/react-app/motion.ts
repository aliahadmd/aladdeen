import { useEffect, useState, useSyncExternalStore, type RefObject } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void): () => void {
	const media = window.matchMedia(REDUCED_MOTION_QUERY);
	media.addEventListener("change", onChange);
	return () => media.removeEventListener("change", onChange);
}

/** True when the visitor asked their system to minimise motion. */
export function usePrefersReducedMotion(): boolean {
	return useSyncExternalStore(
		subscribeReducedMotion,
		() => window.matchMedia(REDUCED_MOTION_QUERY).matches,
		() => false,
	);
}

function canObserve(): boolean {
	return typeof window !== "undefined" && "IntersectionObserver" in window;
}

/**
 * Reveals every `[data-reveal]` element the first time it scrolls into view.
 * Without IntersectionObserver (old browsers, tests) everything shows at once.
 */
export function useRevealOnScroll(): void {
	useEffect(() => {
		const elements = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
		if (!canObserve()) {
			for (const element of elements) element.dataset.revealed = "true";
			return;
		}
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (!entry.isIntersecting) continue;
					(entry.target as HTMLElement).dataset.revealed = "true";
					observer.unobserve(entry.target);
				}
			},
			{ rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
		);
		for (const element of elements) observer.observe(element);
		return () => observer.disconnect();
	}, []);
}

/** Whether the element is currently on screen (always true without IntersectionObserver). */
export function useInView(ref: RefObject<Element | null>, threshold = 0.3): boolean {
	const [inView, setInView] = useState(() => !canObserve());
	useEffect(() => {
		const element = ref.current;
		if (!element || !canObserve()) return;
		const observer = new IntersectionObserver(
			([entry]) => setInView(Boolean(entry?.isIntersecting)),
			{ threshold },
		);
		observer.observe(element);
		return () => observer.disconnect();
	}, [ref, threshold]);
	return inView;
}

/**
 * Publishes page scroll progress as `--scroll-progress` (0–1) on the root
 * element and reports whether the page has scrolled past the top.
 */
export function useScrollProgress(): boolean {
	const [scrolled, setScrolled] = useState(false);
	useEffect(() => {
		let frame = 0;
		const update = (): void => {
			frame = 0;
			const root = document.documentElement;
			const max = root.scrollHeight - window.innerHeight;
			root.style.setProperty("--scroll-progress", String(max > 0 ? window.scrollY / max : 0));
			setScrolled(window.scrollY > 8);
		};
		const onScroll = (): void => {
			if (!frame) frame = window.requestAnimationFrame(update);
		};
		window.addEventListener("scroll", onScroll, { passive: true });
		onScroll();
		return () => {
			window.removeEventListener("scroll", onScroll);
			if (frame) window.cancelAnimationFrame(frame);
		};
	}, []);
	return scrolled;
}

/**
 * Tilts the hero window back and flattens it as the visitor scrolls, by
 * writing `--tilt` and `--zoom` on the element.
 */
export function useHeroTilt(ref: RefObject<HTMLElement | null>, enabled: boolean): void {
	useEffect(() => {
		const element = ref.current;
		if (!element) return;
		if (!enabled) {
			element.style.setProperty("--tilt", "0deg");
			element.style.setProperty("--zoom", "1");
			return;
		}
		let frame = 0;
		const update = (): void => {
			frame = 0;
			const rect = element.getBoundingClientRect();
			const progress = Math.min(Math.max((window.innerHeight - rect.top) / (window.innerHeight * 0.9), 0), 1);
			element.style.setProperty("--tilt", `${(14 * (1 - progress)).toFixed(2)}deg`);
			element.style.setProperty("--zoom", (0.94 + 0.06 * progress).toFixed(3));
		};
		const onScroll = (): void => {
			if (!frame) frame = window.requestAnimationFrame(update);
		};
		window.addEventListener("scroll", onScroll, { passive: true });
		window.addEventListener("resize", onScroll);
		update();
		return () => {
			window.removeEventListener("scroll", onScroll);
			window.removeEventListener("resize", onScroll);
			if (frame) window.cancelAnimationFrame(frame);
		};
	}, [ref, enabled]);
}

/**
 * Calls `advance` every `duration` ms while `running`. Restarting is driven
 * by `step`, so a manual selection gives the new slide its full duration.
 */
export function useAutoAdvance(step: number, duration: number, running: boolean, advance: () => void): void {
	useEffect(() => {
		if (!running) return;
		const timer = window.setTimeout(advance, duration);
		return () => window.clearTimeout(timer);
	}, [step, duration, running, advance]);
}
