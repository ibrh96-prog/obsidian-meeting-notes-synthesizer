import { App, TFile, getAllTags } from "obsidian";
import type { MeetingNotesSettings } from "./settings";
import type { MeetingNote } from "./types";

/**
 * Gathers meeting notes from the vault. Pure collection — no LLM calls.
 * A note qualifies if it lives under the configured folder OR carries the
 * configured tag.
 */
export class NoteCollector {
	private readonly app: App;
	private readonly settings: MeetingNotesSettings;

	constructor(app: App, settings: MeetingNotesSettings) {
		this.app = app;
		this.settings = settings;
	}

	async collect(): Promise<MeetingNote[]> {
		const notes: MeetingNote[] = [];

		for (const file of this.app.vault.getMarkdownFiles()) {
			if (!this.isMeetingNote(file)) {
				continue;
			}
			notes.push(await this.toMeetingNote(file));
		}

		return notes;
	}

	private isMeetingNote(file: TFile): boolean {
		return this.matchesFolder(file) || this.matchesTag(file);
	}

	private matchesFolder(file: TFile): boolean {
		const folder = this.settings.meetingFolder.trim().replace(/\/+$/, "");
		if (folder === "") {
			return false;
		}
		return file.path === folder || file.path.startsWith(`${folder}/`);
	}

	private matchesTag(file: TFile): boolean {
		const wanted = this.normalizeTag(this.settings.meetingTag);
		if (wanted === "") {
			return false;
		}
		const cache = this.app.metadataCache.getFileCache(file);
		if (!cache) {
			return false;
		}
		const tags = getAllTags(cache) ?? [];
		return tags.some((tag) => this.normalizeTag(tag) === wanted);
	}

	private normalizeTag(tag: string): string {
		return tag.trim().replace(/^#/, "").toLowerCase();
	}

	private async toMeetingNote(file: TFile): Promise<MeetingNote> {
		const rawContent = await this.app.vault.cachedRead(file);
		return {
			path: file.path,
			title: file.basename,
			date: this.resolveDate(file),
			attendees: [], // TODO Phase 3: parse attendees from content/frontmatter.
			rawContent,
			mtime: file.stat.mtime,
		};
	}

	/**
	 * Best-effort meeting date: frontmatter `date`, then a date in the
	 * filename, then the file's creation time as an ISO string.
	 */
	private resolveDate(file: TFile): string {
		const frontmatter =
			this.app.metadataCache.getFileCache(file)?.frontmatter;
		const fmDate: unknown = frontmatter?.["date"];
		if (typeof fmDate === "string" && fmDate.trim() !== "") {
			return fmDate.trim();
		}

		const fromName = file.basename.match(/\d{4}-\d{2}-\d{2}/);
		if (fromName) {
			return fromName[0];
		}

		return new Date(file.stat.ctime).toISOString();
	}
}
