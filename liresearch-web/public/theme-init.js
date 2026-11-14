// Applies the saved or system colour theme before first paint.
(function () {
	try {
		var theme = localStorage.getItem("theme");
		var dark =
			theme === "dark" ||
			(theme !== "light" &&
				window.matchMedia("(prefers-color-scheme: dark)").matches);
		document.documentElement.classList.toggle("dark", dark);
	} catch (error) {}
})();
