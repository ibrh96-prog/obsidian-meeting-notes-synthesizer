import { Notice, Plugin } from "obsidian";
import {
	DEFAULT_SETTINGS,
	MeetingNotesSettingTab,
	type MeetingNotesSettings,
} from "./settings";
import { LLMAdapter } from "./llm";
import { NoteCollector } from "./collector";
import { SynthesisEngine } from "./synthesizer";
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
	}

	override async onunload(): Promise<void> {}

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
		const notes = await this.collector.collect();
		await this.engine.syncNotes(notes);
		await this.persist();

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
}
