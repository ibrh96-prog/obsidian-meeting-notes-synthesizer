import { Plugin } from "obsidian";

export default class MeetingNotesSynthesizerPlugin extends Plugin {
	override async onload(): Promise<void> {
		console.log("Meeting Notes Synthesizer loaded.");
	}

	override async onunload(): Promise<void> {}
}
