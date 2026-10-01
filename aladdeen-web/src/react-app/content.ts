// Page copy and data. Everything a visitor reads lives here so wording can be
// changed without touching layout or animation code.

export interface Screenshot {
	src: string;
	alt: string;
	width: number;
	height: number;
}

export const screenshots = {
	markdown: {
		src: "/screenshots/markdown-preview.webp",
		alt: "Aladdeen showing a Markdown document with a rendered pie chart, the project sidebar, and a heading outline",
		width: 1273,
		height: 799,
	},
	excel: {
		src: "/screenshots/excel-workbook.webp",
		alt: "An Excel workbook with a thousand rows open in Aladdeen, with the formula bar and formatting toolbar",
		width: 1277,
		height: 800,
	},
	powerpoint: {
		src: "/screenshots/powerpoint-editor.webp",
		alt: "A fifty-slide PowerPoint presentation open in Aladdeen with the slide list, ribbon, and speaker notes",
		width: 1283,
		height: 802,
	},
	appearance: {
		src: "/screenshots/appearance-settings.webp",
		alt: "Aladdeen appearance settings with System, Light, and Dark modes and a gallery of theme presets",
		width: 1272,
		height: 801,
	},
	welcomeLocal: {
		src: "/screenshots/welcome-local-first.webp",
		alt: "Welcome screen: Research stays on your Mac",
		width: 1278,
		height: 795,
	},
	welcomeOrganize: {
		src: "/screenshots/welcome-organize.webp",
		alt: "Welcome screen: Organize without moving anything, with document type filters",
		width: 1278,
		height: 792,
	},
	welcomeFormats: {
		src: "/screenshots/welcome-formats.webp",
		alt: "Welcome screen: A workspace for every format",
		width: 1279,
		height: 794,
	},
	welcomeSearch: {
		src: "/screenshots/welcome-search.webp",
		alt: "Welcome screen: Find the passage, not just the file",
		width: 1277,
		height: 789,
	},
	createEnvironment: {
		src: "/screenshots/create-environment.webp",
		alt: "Create your first environment screen with an environment name field",
		width: 1277,
		height: 792,
	},
} satisfies Record<string, Screenshot>;

export const navLinks = [
	{ href: "#tour", label: "Tour" },
	{ href: "#formats", label: "Formats" },
	{ href: "#privacy", label: "Privacy" },
	{ href: "#download", label: "Download" },
	{ href: "#faq", label: "FAQ" },
] as const;

export const marqueeFiles = [
	{ name: "Field notes.md", color: "#7c7cf5" },
	{ name: "Interview transcripts.docx", color: "#3b82f6" },
	{ name: "Survey results.xlsx", color: "#22a565" },
	{ name: "Committee briefing.pptx", color: "#f97316" },
	{ name: "Primary sources.pdf", color: "#ef4444" },
	{ name: "Archive export.html", color: "#eab308" },
	{ name: "Literature review.md", color: "#7c7cf5" },
	{ name: "Grant proposal.docx", color: "#3b82f6" },
	{ name: "Budget 2026.xlsx", color: "#22a565" },
	{ name: "Conference talk.pptx", color: "#f97316" },
	{ name: "Methods appendix.pdf", color: "#ef4444" },
	{ name: "Reading list.md", color: "#7c7cf5" },
] as const;

export const showcaseSlides = [
	{
		id: "markdown",
		label: "Markdown",
		title: "Write, then read it beautifully.",
		description:
			"A focused editor beside a polished preview. Tables, task lists, footnotes, math, and diagrams render as you type, and a heading outline keeps long documents navigable.",
		points: ["Rich preview with diagrams and math", "Jump anywhere with the outline", "Export to PDF or Word"],
		image: screenshots.markdown,
	},
	{
		id: "excel",
		label: "Excel",
		title: "Real spreadsheets, not previews.",
		description:
			"Edit workbooks with formulas, formatting, sorting, filters, and conditional formatting. Workbooks with features Aladdeen can't fully reproduce are protected instead of being silently rewritten.",
		points: ["Formulas, sheets, and styles", "Sort, filter, find and replace", "Safe saves for complex workbooks"],
		image: screenshots.excel,
	},
	{
		id: "powerpoint",
		label: "PowerPoint",
		title: "Edit the deck. Then present it.",
		description:
			"Change slides, text, and layouts, write speaker notes, and present full screen. The parts of a presentation you didn't touch are saved back exactly as they were.",
		points: ["Slides, layouts, and notes", "Full-screen presenting", "Untouched parts stay identical"],
		image: screenshots.powerpoint,
	},
] as const;

export type FormatId = "markdown" | "word" | "excel" | "powerpoint" | "pdf" | "html";

export const formats: ReadonlyArray<{
	id: FormatId;
	name: string;
	extension: string;
	color: string;
	summary: string;
	abilities: readonly string[];
}> = [
	{
		id: "markdown",
		name: "Markdown",
		extension: ".md",
		color: "#7c7cf5",
		summary: "Write in plain text, read in a polished preview.",
		abilities: ["Tables, math, and diagrams", "Heading outline", "Export to PDF or Word"],
	},
	{
		id: "word",
		name: "Word",
		extension: ".docx",
		color: "#3b82f6",
		summary: "Edit documents with their formatting intact.",
		abilities: ["Rich formatting", "Comments", "Tracked changes"],
	},
	{
		id: "excel",
		name: "Excel",
		extension: ".xlsx",
		color: "#22a565",
		summary: "Work with the numbers, not a screenshot of them.",
		abilities: ["Formulas and sheets", "Sorting and filters", "Conditional formatting"],
	},
	{
		id: "powerpoint",
		name: "PowerPoint",
		extension: ".pptx",
		color: "#f97316",
		summary: "Shape the story, then present it.",
		abilities: ["Slides and layouts", "Speaker notes", "Full-screen presenting"],
	},
	{
		id: "pdf",
		name: "PDF",
		extension: ".pdf",
		color: "#ef4444",
		summary: "Read closely and mark up what matters.",
		abilities: ["Search and outline", "Fill in forms", "Highlights, notes, and page tools"],
	},
	{
		id: "html",
		name: "HTML",
		extension: ".html",
		color: "#eab308",
		summary: "Edit the source with a live, safe preview.",
		abilities: ["Side-by-side preview", "Click to find the source", "Scripts and network off"],
	},
];

export const searchDemoQueries = [
	{
		query: "migration evidence",
		results: [
			{
				file: "Field notes.md",
				where: "Interviews › Session 04",
				before: "…the ",
				match: "migration evidence",
				after: " changed after the second review…",
				color: "#7c7cf5",
			},
			{
				file: "Research brief.docx",
				where: "Reports",
				before: "…compare the ",
				match: "migration evidence",
				after: " with the primary sources…",
				color: "#3b82f6",
			},
			{
				file: "Survey results.xlsx",
				where: "Responses › D214",
				before: "Theme: ",
				match: "migration evidence",
				after: " (coded)",
				color: "#22a565",
			},
		],
	},
	{
		query: "sample size",
		results: [
			{
				file: "Methods appendix.pdf",
				where: "Page 12",
				before: "…the final ",
				match: "sample size",
				after: " was 1,240 households…",
				color: "#ef4444",
			},
			{
				file: "Committee briefing.pptx",
				where: "Slide 7 notes",
				before: "Mention why the ",
				match: "sample size",
				after: " doubled in year two.",
				color: "#f97316",
			},
			{
				file: "Literature review.md",
				where: "Limitations",
				before: "…small ",
				match: "sample size",
				after: "s limit how far these findings…",
				color: "#7c7cf5",
			},
		],
	},
] as const;

export const guidedSteps = [
	{
		title: "Research stays on your Mac",
		detail: "Aladdeen reads and edits documents where they already live. No account, cloud, or connection needed.",
		image: screenshots.welcomeLocal,
	},
	{
		title: "Organize without moving anything",
		detail: "Bring folders and single files together, and choose which document types each folder shows.",
		image: screenshots.welcomeOrganize,
	},
	{
		title: "A workspace for every format",
		detail: "Each file type opens in tools designed for it, from Markdown to PowerPoint.",
		image: screenshots.welcomeFormats,
	},
	{
		title: "Find the passage, not just the file",
		detail: "Search inside every document at once and jump straight to the matching line.",
		image: screenshots.welcomeSearch,
	},
	{
		title: "Name your first environment",
		detail: "Create a workspace like “Thesis” or “Client work”, then add a folder. That's it.",
		image: screenshots.createEnvironment,
	},
] as const;

export const themePresets = [
	{ name: "Aladdeen", accent: "#6366f1", surface: "#1e1e2a" },
	{ name: "Mono", accent: "#8e8e98", surface: "#1a1a1c" },
	{ name: "Catppuccin", accent: "#cba6f7", surface: "#24273a" },
	{ name: "Everforest", accent: "#a7c080", surface: "#2d353b" },
	{ name: "Solarized", accent: "#268bd2", surface: "#002b36" },
	{ name: "Nord", accent: "#88c0d0", surface: "#2e3440" },
	{ name: "Rosé Pine", accent: "#ebbcba", surface: "#232136" },
	{ name: "Gruvbox", accent: "#fabd2f", surface: "#282828" },
] as const;

export const privacyStats = [
	{ value: 0, suffix: "", label: "Accounts to create" },
	{ value: 0, suffix: "", label: "Files uploaded anywhere" },
	{ value: 100, suffix: "%", label: "Works offline" },
	{ value: 6, suffix: "", label: "Formats in one window" },
] as const;

export const privacyPoints = [
	{
		title: "Your files never move",
		detail: "Documents stay in their folders, in their original format. Use them in any other app, any time.",
	},
	{
		title: "Nothing leaves your Mac",
		detail: "No sign-in, no sync, no analytics. Aladdeen doesn't even fetch remote images inside your documents.",
	},
	{
		title: "Only the essentials remembered",
		detail: "It keeps a list of the folders you added, your open tabs, and your settings. Never your documents' contents.",
	},
] as const;
