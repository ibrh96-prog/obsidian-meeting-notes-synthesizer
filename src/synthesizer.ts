import type { LLMAdapter } from "./llm";
import type {
	ActionItem,
	Decision,
	MeetingNote,
	SynthesisCache,
} from "./types";

// --- Shape the LLM is asked to return (validated before use) ---

interface ExtractedDecision {
	text: string;
	topic: string;
}

interface ExtractedAction {
	text: string;
	owner: string;
	dueDate: string | null;
}

interface ExtractionResult {
	attendees: string[];
	decisions: ExtractedDecision[];
	actions: ExtractedAction[];
}

const EXTRACTION_SYSTEM_PROMPT = [
	"You are a meeting-notes extraction engine. Read the meeting note and",
	"extract its attendees, decisions, and action items.",
	"",
	"Return ONLY a valid JSON object — no markdown code fences, no commentary,",
	"no prose before or after. The object must match exactly this shape:",
	"{",
	'  "attendees": string[],',
	'  "decisions": [{ "text": string, "topic": string }],',
	'  "actions": [{ "text": string, "owner": string, "dueDate": string | null }]',
	"}",
	"",
	"Rules:",
	"- If a field is unknown, use an empty array or null as appropriate.",
	'- "owner" is the person responsible for the action; use "" if unclear.',
	'- "topic" is a short subject label for the decision.',
	'- "dueDate" is an ISO date (YYYY-MM-DD) or null.',
	"- Do NOT invent content that is not in the note.",
].join("\n");

/**
 * Owns the synthesis cache and answers cross-meeting queries.
 *
 * The engine is deliberately free of any Obsidian Plugin API: it never touches
 * the vault, settings, or saveData. It reads notes that were collected for it,
 * reaches the network only through the injected {@link LLMAdapter}, and mutates
 * the {@link SynthesisCache} it was constructed with. Persisting that cache is
 * the caller's job. This keeps the engine pure and testable.
 */
export class SynthesisEngine {
	private readonly llm: LLMAdapter;
	private readonly cache: SynthesisCache;

	constructor(llm: LLMAdapter, cache: SynthesisCache) {
		this.llm = llm;
		this.cache = cache;
	}

	/**
	 * Extract decisions/actions for every note, incrementally.
	 *
	 * Unchanged notes (same mtime as the cache) are skipped so we don't pay for
	 * a BYOK API call we've already made. Changed/new notes are re-extracted.
	 * Notes that disappeared from the vault are dropped from the cache. The
	 * cache object passed to the constructor is mutated in place; the caller is
	 * responsible for persisting it afterwards.
	 */
	async syncNotes(notes: MeetingNote[]): Promise<void> {
		const seenPaths = new Set<string>();

		for (const note of notes) {
			seenPaths.add(note.path);

			const existing = this.cache.notes[note.path];
			if (existing && existing.mtime === note.mtime) {
				// Unchanged since last sync — reuse the cached extraction.
				continue;
			}

			const extracted = await this.extractNote(note);
			if (!extracted) {
				// Extraction failed for this note. Leave any prior cache entry
				// untouched (stale mtime stays) so the next sync retries it.
				continue;
			}

			const attendees = this.dedupe([
				...note.attendees,
				...extracted.attendees,
			]);
			note.attendees = attendees;

			const decisions: Decision[] = extracted.decisions.map((d, index) => ({
				id: this.makeId(note.path, "decision", index),
				text: d.text,
				topic: d.topic,
				date: note.date,
				sourcePath: note.path,
				status: "active",
				supersededBy: null,
			}));

			const actions: ActionItem[] = extracted.actions.map((a, index) => ({
				id: this.makeId(note.path, "action", index),
				text: a.text,
				owner: a.owner,
				date: note.date,
				sourcePath: note.path,
				open: true,
				dueDate: a.dueDate,
			}));

			this.cache.notes[note.path] = {
				mtime: note.mtime,
				decisions,
				actions,
			};
		}

		// Drop cache entries for notes that no longer exist in the vault.
		for (const path of Object.keys(this.cache.notes)) {
			if (!seenPaths.has(path)) {
				delete this.cache.notes[path];
			}
		}

		// Re-evaluate supersession now the cache reflects the latest extraction.
		this.applySupersession();

		this.cache.lastSynced = new Date().toISOString();
	}

	/**
	 * All active decisions across every cached note, newest first. When a topic
	 * is given, keep only decisions whose topic contains it (case-insensitive).
	 * Superseded decisions (see {@link applySupersession}) are excluded — history
	 * shows the decisions that currently stand.
	 */
	getDecisionHistory(topic?: string): Decision[] {
		const needle = topic?.trim().toLowerCase() ?? "";

		const decisions: Decision[] = [];
		for (const entry of Object.values(this.cache.notes)) {
			for (const decision of entry.decisions) {
				if (decision.status !== "active") {
					continue;
				}
				if (needle !== "" && !decision.topic.toLowerCase().includes(needle)) {
					continue;
				}
				decisions.push(decision);
			}
		}

		decisions.sort((a, b) => b.date.localeCompare(a.date));
		return decisions;
	}

	/**
	 * All still-open actions across every cached note. When an owner is given,
	 * keep only actions whose owner contains it (case-insensitive). Sorted so
	 * dated actions come first (earliest due first), undated actions after.
	 */
	getOpenActions(owner?: string): ActionItem[] {
		const needle = owner?.trim().toLowerCase() ?? "";

		const actions: ActionItem[] = [];
		for (const entry of Object.values(this.cache.notes)) {
			for (const action of entry.actions) {
				if (!action.open) {
					continue;
				}
				if (needle !== "" && !action.owner.toLowerCase().includes(needle)) {
					continue;
				}
				actions.push(action);
			}
		}

		actions.sort((a, b) => {
			if (a.dueDate && b.dueDate) {
				return a.dueDate.localeCompare(b.dueDate);
			}
			if (a.dueDate) {
				return -1;
			}
			if (b.dueDate) {
				return 1;
			}
			return 0;
		});
		return actions;
	}

	/**
	 * Everything that happened in one calendar week: decisions made and actions
	 * recorded whose `date` falls in [weekStart, weekStart + 7 days). Decisions
	 * are limited to active ones; actions include both open and closed (it's a
	 * "what happened this week" summary). Items with an unparseable date are
	 * excluded rather than crashing the rollup.
	 *
	 * The window check is timezone-safe: both the week boundary and each item's
	 * date are reduced to a calendar-date string (YYYY-MM-DD) and compared
	 * lexicographically — valid chronological order for this fixed-width,
	 * zero-padded format — so no Date/timezone parsing affects the boundary.
	 */
	getWeeklyRollup(weekStartISO: string): {
		decisions: Decision[];
		actions: ActionItem[];
	} {
		const weekStart = weekStartISO.slice(0, 10);
		const weekEnd = this.addDays(weekStart, 7);

		const inWindow = (date: string): boolean => {
			const day = this.dateKey(date);
			return day !== "" && day >= weekStart && day < weekEnd;
		};

		const decisions: Decision[] = [];
		const actions: ActionItem[] = [];
		for (const entry of Object.values(this.cache.notes)) {
			for (const decision of entry.decisions) {
				if (decision.status === "active" && inWindow(decision.date)) {
					decisions.push(decision);
				}
			}
			for (const action of entry.actions) {
				if (inWindow(action.date)) {
					actions.push(action);
				}
			}
		}

		decisions.sort((a, b) => this.dateKey(b.date).localeCompare(this.dateKey(a.date)));
		actions.sort((a, b) => this.dateKey(a.date).localeCompare(this.dateKey(b.date)));

		return { decisions, actions };
	}

	/**
	 * Reduce a date string to its calendar-date key (YYYY-MM-DD) for timezone-
	 * safe lexicographic comparison. Returns "" when the value isn't a valid
	 * calendar date — and "" sorts before any real date, so undated items are
	 * treated as oldest.
	 */
	private dateKey(date: string): string {
		const day = date.slice(0, 10);
		return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : "";
	}

	/**
	 * Add a number of days to a YYYY-MM-DD calendar date, returning a YYYY-MM-DD
	 * string. Arithmetic runs in UTC so month boundaries and DST never shift the
	 * result.
	 */
	private addDays(dateOnly: string, days: number): string {
		const [year, month, day] = dateOnly.split("-").map(Number);
		const dt = new Date(Date.UTC(year, month - 1, day));
		dt.setUTCDate(dt.getUTCDate() + days);
		const y = dt.getUTCFullYear();
		const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
		const d = String(dt.getUTCDate()).padStart(2, "0");
		return `${y}-${m}-${d}`;
	}

	// --- Decision evolution (deterministic supersession) ---

	/**
	 * Mark decision supersession across the whole cache, in place. Decisions are
	 * grouped by topic (case-insensitive); within a group the newest-dated one
	 * stays "active" and the rest become "superseded" pointing at it via
	 * supersededBy. Decisions with an empty topic are never grouped together —
	 * an empty topic is not a shared subject — so each stands alone and active.
	 *
	 * Pure in-memory mutation of the cache the engine already holds: no LLM, no
	 * Obsidian API, no I/O. Idempotent, so it can run repeatedly. Called at the
	 * end of {@link syncNotes} (so the persisted cache is correct) and at the
	 * start of {@link buildReportMarkdown} (so a report is consistent even when
	 * generated without a fresh sync).
	 */
	private applySupersession(): void {
		for (const group of this.groupDecisionsByTopic()) {
			const sorted = [...group].sort((a, b) =>
				this.dateKey(a.date).localeCompare(this.dateKey(b.date))
			);
			const newest = sorted[sorted.length - 1];
			for (const decision of sorted) {
				if (decision === newest) {
					decision.status = "active";
					decision.supersededBy = null;
				} else {
					decision.status = "superseded";
					decision.supersededBy = newest.id;
				}
			}
		}
	}

	/**
	 * Topics whose decision changed over time: groups with 2+ decisions, each
	 * sorted oldest → newest so a reader can show the progression ending in the
	 * current (active) one. Single-decision topics are omitted — nothing evolved.
	 */
	getDecisionEvolution(): Array<{ topic: string; decisions: Decision[] }> {
		const evolution: Array<{ topic: string; decisions: Decision[] }> = [];
		for (const group of this.groupDecisionsByTopic()) {
			if (group.length < 2) {
				continue;
			}
			const decisions = [...group].sort((a, b) =>
				this.dateKey(a.date).localeCompare(this.dateKey(b.date))
			);
			evolution.push({ topic: decisions[0].topic, decisions });
		}
		return evolution;
	}

	/**
	 * Every decision currently marked superseded, across the cache. Reads the
	 * already-marked cache state (supersession is applied during sync and report
	 * generation), so it reflects the latest grouping.
	 */
	detectConflicts(): Decision[] {
		const superseded: Decision[] = [];
		for (const entry of Object.values(this.cache.notes)) {
			for (const decision of entry.decisions) {
				if (decision.status === "superseded") {
					superseded.push(decision);
				}
			}
		}
		return superseded;
	}

	/**
	 * Group all cached decisions by normalized topic. Decisions with an empty
	 * topic each become their own singleton group (never grouped together). The
	 * returned arrays hold live references into the cache, so callers can mutate
	 * decisions in place.
	 */
	private groupDecisionsByTopic(): Decision[][] {
		const groups = new Map<string, Decision[]>();
		const singletons: Decision[][] = [];

		for (const entry of Object.values(this.cache.notes)) {
			for (const decision of entry.decisions) {
				const key = decision.topic.trim().toLowerCase();
				if (key === "") {
					singletons.push([decision]);
					continue;
				}
				const existing = groups.get(key);
				if (existing) {
					existing.push(decision);
				} else {
					groups.set(key, [decision]);
				}
			}
		}

		return [...groups.values(), ...singletons];
	}

	// --- Report rendering ---

	/**
	 * Render the full synthesis report as a markdown document. Pure: reads the
	 * in-memory cache and returns a string — writing it to the vault is the
	 * caller's job.
	 *
	 * The engine never computes "today" itself (that would make it
	 * non-deterministic). The caller passes the week's start; when omitted the
	 * Weekly rollup falls back to a "Coming soon" placeholder.
	 */
	buildReportMarkdown(weekStartISO?: string): string {
		// Ensure supersession is current even if the report is generated without
		// a fresh sync this session. Idempotent and cheap (no I/O, no LLM).
		this.applySupersession();

		const lines: string[] = [];

		lines.push("# Meeting Synthesis");
		lines.push("");
		lines.push(`_Last synced: ${this.cache.lastSynced || "never"}_`);
		lines.push("");

		lines.push("## Decision history");
		const decisions = this.getDecisionHistory();
		if (decisions.length === 0) {
			lines.push("_No decisions yet._");
		} else {
			for (const decision of decisions) {
				const link = this.noteName(decision.sourcePath);
				lines.push(
					`- **${decision.topic}** — ${decision.text} _( ${decision.date}, [[${link}]] )_`
				);
			}
		}
		lines.push("");

		lines.push("## Open actions");
		const actions = this.getOpenActions();
		if (actions.length === 0) {
			lines.push("_No open actions._");
		} else {
			for (const action of actions) {
				const owner = action.owner || "unassigned";
				const due = action.dueDate ? ` (due ${action.dueDate})` : "";
				const link = this.noteName(action.sourcePath);
				lines.push(
					`- [ ] ${action.text} — **${owner}**${due} _([[${link}]])_`
				);
			}
		}
		lines.push("");

		lines.push("## Weekly rollup");
		if (weekStartISO) {
			const weekDate = weekStartISO.split("T")[0] ?? weekStartISO;
			lines.push(`_Week of ${weekDate}_`);
			lines.push("");

			const rollup = this.getWeeklyRollup(weekStartISO);

			lines.push("### Decisions this week");
			if (rollup.decisions.length === 0) {
				lines.push("_No decisions this week._");
			} else {
				for (const decision of rollup.decisions) {
					const link = this.noteName(decision.sourcePath);
					lines.push(
						`- **${decision.topic}** — ${decision.text} _([[${link}]])_`
					);
				}
			}
			lines.push("");

			lines.push("### Actions this week");
			if (rollup.actions.length === 0) {
				lines.push("_No actions this week._");
			} else {
				for (const action of rollup.actions) {
					const box = action.open ? "[ ]" : "[x]";
					const owner = action.owner || "unassigned";
					const link = this.noteName(action.sourcePath);
					lines.push(`- ${box} ${action.text} — **${owner}** _([[${link}]])_`);
				}
			}
		} else {
			lines.push("_Coming soon._");
		}
		lines.push("");

		lines.push("## Decision evolution");
		const evolution = this.getDecisionEvolution();
		if (evolution.length === 0) {
			lines.push("_No superseded decisions — every decision still stands._");
			lines.push("");
		} else {
			for (const group of evolution) {
				lines.push(`### ${group.topic}`);
				for (const decision of group.decisions) {
					const day = this.dateKey(decision.date) || decision.date;
					const link = this.noteName(decision.sourcePath);
					const current =
						decision.status === "active" ? "  ✅ **(current)**" : "";
					lines.push(
						`- ${day} — ${decision.text} _([[${link}]])_${current}`
					);
				}
				lines.push("");
			}
		}

		return lines.join("\n");
	}

	/** Vault path → wikilink-friendly note name (drop folders and .md). */
	private noteName(sourcePath: string): string {
		const base = sourcePath.split("/").pop() ?? sourcePath;
		return base.replace(/\.md$/i, "");
	}

	// --- Extraction internals ---

	/**
	 * Ask the LLM to extract one note. Parses the response defensively and
	 * retries once on invalid JSON. Returns null (and warns) if both attempts
	 * fail, so the caller can skip the note without aborting the whole sync.
	 */
	private async extractNote(note: MeetingNote): Promise<ExtractionResult | null> {
		const userPrompt = this.buildUserPrompt(note);

		const first = await this.llm.complete(EXTRACTION_SYSTEM_PROMPT, userPrompt);
		const parsedFirst = this.parseExtraction(first);
		if (parsedFirst) {
			return parsedFirst;
		}

		const retryPrompt =
			`${userPrompt}\n\n` +
			"Your previous output was not valid JSON. Return ONLY the JSON object.";
		const second = await this.llm.complete(EXTRACTION_SYSTEM_PROMPT, retryPrompt);
		const parsedSecond = this.parseExtraction(second);
		if (parsedSecond) {
			return parsedSecond;
		}

		console.warn(
			`[Meeting Notes Synthesizer] Could not parse extraction for note: ${note.path}`
		);
		return null;
	}

	private buildUserPrompt(note: MeetingNote): string {
		const lines = [`Title: ${note.title}`, `Date: ${note.date}`];
		if (note.attendees.length > 0) {
			lines.push(`Frontmatter attendees: ${note.attendees.join(", ")}`);
		}
		lines.push("", "Note content:", note.rawContent);
		return lines.join("\n");
	}

	private parseExtraction(raw: string): ExtractionResult | null {
		const cleaned = this.stripFences(raw);
		try {
			const value: unknown = JSON.parse(cleaned);
			return this.coerceExtraction(value);
		} catch {
			return null;
		}
	}

	/** Remove an accidental ```json … ``` wrapper before parsing. */
	private stripFences(raw: string): string {
		let text = raw.trim();
		if (text.startsWith("```")) {
			text = text
				.replace(/^```[a-zA-Z]*\s*/, "")
				.replace(/\s*```$/, "");
		}
		return text.trim();
	}

	/** Validate/normalize an arbitrary parsed value into an ExtractionResult. */
	private coerceExtraction(value: unknown): ExtractionResult | null {
		if (typeof value !== "object" || value === null) {
			return null;
		}
		const obj = value as Record<string, unknown>;

		const decisions = Array.isArray(obj["decisions"])
			? obj["decisions"]
					.map((d) => this.coerceDecision(d))
					.filter((d): d is ExtractedDecision => d !== null)
			: [];

		const actions = Array.isArray(obj["actions"])
			? obj["actions"]
					.map((a) => this.coerceAction(a))
					.filter((a): a is ExtractedAction => a !== null)
			: [];

		return {
			attendees: this.toStringArray(obj["attendees"]),
			decisions,
			actions,
		};
	}

	private coerceDecision(value: unknown): ExtractedDecision | null {
		if (typeof value !== "object" || value === null) {
			return null;
		}
		const obj = value as Record<string, unknown>;
		const text = typeof obj["text"] === "string" ? obj["text"].trim() : "";
		if (text === "") {
			return null;
		}
		const topic = typeof obj["topic"] === "string" ? obj["topic"].trim() : "";
		return { text, topic };
	}

	private coerceAction(value: unknown): ExtractedAction | null {
		if (typeof value !== "object" || value === null) {
			return null;
		}
		const obj = value as Record<string, unknown>;
		const text = typeof obj["text"] === "string" ? obj["text"].trim() : "";
		if (text === "") {
			return null;
		}
		const owner = typeof obj["owner"] === "string" ? obj["owner"].trim() : "";
		const due = obj["dueDate"];
		const dueDate =
			typeof due === "string" && due.trim() !== "" ? due.trim() : null;
		return { text, owner, dueDate };
	}

	private toStringArray(value: unknown): string[] {
		if (!Array.isArray(value)) {
			return [];
		}
		return value
			.filter((v): v is string => typeof v === "string")
			.map((v) => v.trim())
			.filter((v) => v !== "");
	}

	private dedupe(values: string[]): string[] {
		const seen = new Set<string>();
		const out: string[] = [];
		for (const value of values) {
			const key = value.toLowerCase();
			if (value === "" || seen.has(key)) {
				continue;
			}
			seen.add(key);
			out.push(value);
		}
		return out;
	}

	/**
	 * Stable id for an extracted item: kind + a hash of the source path + index.
	 * Deterministic per note so re-syncing the same note produces the same ids
	 * instead of duplicating.
	 */
	private makeId(sourcePath: string, kind: string, index: number): string {
		return `${kind}-${this.hash(sourcePath)}-${index}`;
	}

	/** Small deterministic djb2 hash, rendered as base-36. */
	private hash(input: string): string {
		let h = 5381;
		for (let i = 0; i < input.length; i++) {
			h = (((h << 5) + h) + input.charCodeAt(i)) | 0;
		}
		return (h >>> 0).toString(36);
	}
}
