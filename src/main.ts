import { Notice, Plugin, TFile } from "obsidian";
import {
	DEFAULT_SETTINGS,
	MeetingNotesSettingTab,
	type MeetingNotesSettings,
} from "./settings";
import { LLMAdapter } from "./llm";
import { NoteCollector } from "./collector";
import { SynthesisEngine } from "./synthesizer";
import { verifyLicense } from "./license";
import type { SynthesisCache } from "./types";

function emptyCache(): SynthesisCache {
	return { notes: {}, lastSynced: "" };
}

/**
 * Shape of the single JSON blob Obsidian persists for this plugin. Settings and
 * the synthesis cache live side by side so saving one never clobbers the other.
 */
interface PersistedData {
	settings: MeetingNotesSettings;
	cache: SynthesisCache;
}

export default class MeetingNotesSynthesizerPlugin extends Plugin {
	settings: MeetingNotesSettings = DEFAULT_SETTINGS;
	cache: SynthesisCache = emptyCache();

	llm!: LLMAdapter;
	collector!: NoteCollector;
	engine!: SynthesisEngine;

	override async onload(): Promise<void> {
		console.log("Meeting Notes Synthesizer loaded.");

		await this.loadSettings();

		this.llm = new LLMAdapter(this.settings);
		this.collector = new NoteCollector(this.app, this.settings);
		this.engine = new SynthesisEngine(this.llm, this.cache);

		this.addSettingTab(new MeetingNotesSettingTab(this.app, this));

		this.addCommand({
			id: "sync-meeting-notes",
			name: "Sync meeting notes",
			callback: () => {
				void this.runSync();
			},
		});

		this.addCommand({
			id: "generate-synthesis-report",
			name: "Generate synthesis report",
			callback: () => {
				void this.runGenerateReport();
			},
		});

		this.addRibbonIcon(
			"list-checks",
			"Generate meeting synthesis report",
			() => {
				void this.runGenerateReport();
			}
		);
	}

	override onunload(): void {}

	async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as Partial<PersistedData> | null;

		// Tolerate the legacy flat-settings layout (pre-cache builds saved the
		// settings object at the top level) so an existing API key survives.
		const settingsSource =
			data && "settings" in data
				? data.settings
				: (data as Partial<MeetingNotesSettings> | null);
		this.settings = Object.assign({}, DEFAULT_SETTINGS, settingsSource ?? {});

		this.cache =
			(data && "cache" in data ? data.cache : null) ?? emptyCache();
	}

	async saveSettings(): Promise<void> {
		await this.persist();
	}

	/** Persist settings and cache together as one blob. */
	private async persist(): Promise<void> {
		const data: PersistedData = {
			settings: this.settings,
			cache: this.cache,
		};
		await this.saveData(data);
	}

	private async runSync(): Promise<void> {
		const d = new Date();
		const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
		const isPro = verifyLicense(this.settings.proLicenseKey).valid;

		if (!isPro) {
			if (this.settings.freeUsage.month !== monthKey) {
				this.settings.freeUsage = { month: monthKey, count: 0 };
			}
			if (this.settings.freeUsage.count >= 3) {
				new Notice(
					"Free limit reached: 3 syncs per month. Upgrade to Pro for unlimited syncs."
				);
				return;
			}
		}

		const notes = await this.collector.collect();
		await this.engine.syncNotes(notes);
		await this.persist();

		if (!isPro) {
			this.settings.freeUsage.count += 1;
			await this.persist();
		}

		let decisions = 0;
		let actions = 0;
		for (const entry of Object.values(this.cache.notes)) {
			decisions += entry.decisions.length;
			actions += entry.actions.length;
		}

		new Notice(
			`Synced ${notes.length} note(s) — ${decisions} decision(s), ${actions} action(s).`
		);
	}

	/**
	 * Render the report from the current cache and write it to a fixed vault
	 * note, overwriting if it exists, then open it. Reads the cache only — does
	 * not trigger a sync.
	 */
	private async runGenerateReport(): Promise<void> {
		const path = "Meeting Synthesis.md";
		try {
			const markdown = this.engine.buildReportMarkdown(
				this.currentWeekStartISO()
			);

			const existing = this.app.vault.getAbstractFileByPath(path);
			let file: TFile;
			if (existing instanceof TFile) {
				await this.app.vault.modify(existing, markdown);
				file = existing;
			} else {
				file = await this.app.vault.create(path, markdown);
			}

			await this.app.workspace.getLeaf(false).openFile(file);
			new Notice("Synthesis report updated.");
		} catch (error) {
			console.error(
				"Meeting Notes Synthesizer: failed to write synthesis report",
				error
			);
			new Notice("Failed to write synthesis report. See console.");
		}
	}

	/**
	 * The current week's Monday as a calendar-date string (YYYY-MM-DD). Built
	 * from the Monday's LOCAL year/month/day components — never toISOString(),
	 * which would shift the date across the UTC boundary in non-UTC timezones.
	 * Monday-start week: Sunday (getDay() === 0) belongs to the previous Monday,
	 * so it steps back 6 days rather than forward.
	 */
	private currentWeekStartISO(): string {
		const now = new Date();
		const daysSinceMonday = now.getDay() === 0 ? 6 : now.getDay() - 1;
		const monday = new Date(now);
		monday.setDate(now.getDate() - daysSinceMonday);

		const year = monday.getFullYear();
		const month = String(monday.getMonth() + 1).padStart(2, "0");
		const day = String(monday.getDate()).padStart(2, "0");
		return `${year}-${month}-${day}`;
	}
}
