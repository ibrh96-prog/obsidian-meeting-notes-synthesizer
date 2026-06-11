// Core domain types for the Meeting Notes Synthesizer plugin.

export interface MeetingNote {
	path: string;
	title: string;
	date: string; // ISO date
	attendees: string[];
	rawContent: string;
	mtime: number; // file last-modified time, for incremental sync
}

export interface Decision {
	id: string;
	text: string;
	topic: string;
	date: string;
	sourcePath: string;
	status: "active" | "superseded";
	supersededBy: string | null;
}

export interface ActionItem {
	id: string;
	text: string;
	owner: string;
	date: string;
	sourcePath: string;
	open: boolean;
	dueDate: string | null;
}

export interface SynthesisCache {
	notes: Record<
		string,
		{ mtime: number; decisions: Decision[]; actions: ActionItem[] }
	>;
	lastSynced: string;
}
