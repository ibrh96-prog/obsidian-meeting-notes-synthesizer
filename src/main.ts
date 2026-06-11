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
		const data = (await this.loadData()) as Partial<MeetingNotesSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data ?? {});
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private async runSync(): Promise<void> {
		const notes = await this.collector.collect();
		await this.engine.syncNotes(notes);
		new Notice(`Found ${notes.length} meeting note(s).`);
	}
}
