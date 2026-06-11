import { App, PluginSettingTab, Setting } from "obsidian";
import type MeetingNotesSynthesizerPlugin from "./main";

export type LLMProvider = "anthropic" | "openai-compatible";

export interface MeetingNotesSettings {
	provider: LLMProvider;
	apiKey: string;
	baseUrl: string;
	model: string;
	meetingFolder: string;
	meetingTag: string;
	proLicenseKey: string;
}

export const DEFAULT_SETTINGS: MeetingNotesSettings = {
	provider: "anthropic",
	apiKey: "",
	baseUrl: "https://api.anthropic.com",
	model: "claude-sonnet-4-6",
	meetingFolder: "Meetings",
	meetingTag: "#meeting",
	proLicenseKey: "",
};

export class MeetingNotesSettingTab extends PluginSettingTab {
	private readonly plugin: MeetingNotesSynthesizerPlugin;

	constructor(app: App, plugin: MeetingNotesSynthesizerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	override display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// --- Language model section ---
		new Setting(containerEl).setName("Language model").setHeading();

		new Setting(containerEl)
			.setName("Provider")
			.setDesc("Which API shape to use for synthesis requests.")
			.addDropdown((dropdown) => {
				dropdown
					.addOption("anthropic", "Anthropic")
					.addOption("openai-compatible", "OpenAI-compatible")
					.setValue(this.plugin.settings.provider)
					.onChange(async (value) => {
						this.plugin.settings.provider = value as LLMProvider;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("API key")
			.setDesc("Stored locally in this vault. Never committed or shared.")
			.addText((text) => {
				text.inputEl.type = "password";
				text
					.setPlaceholder("sk-...")
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.apiKey = value.trim();
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Base URL")
			.setDesc("API endpoint root, without a trailing slash.")
			.addText((text) => {
				text
					.setPlaceholder("https://api.anthropic.com")
					.setValue(this.plugin.settings.baseUrl)
					.onChange(async (value) => {
						this.plugin.settings.baseUrl = value.trim().replace(/\/+$/, "");
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Model")
			.setDesc("Model identifier passed to the provider.")
			.addText((text) => {
				text
					.setPlaceholder("claude-sonnet-4-6")
					.setValue(this.plugin.settings.model)
					.onChange(async (value) => {
						this.plugin.settings.model = value.trim();
						await this.plugin.saveSettings();
					});
			});

		// --- Meeting detection section ---
		new Setting(containerEl).setName("Meeting detection").setHeading();

		new Setting(containerEl)
			.setName("Meeting folder")
			.setDesc("Vault-relative folder whose notes are treated as meetings.")
			.addText((text) => {
				text
					.setPlaceholder("Meetings")
					.setValue(this.plugin.settings.meetingFolder)
					.onChange(async (value) => {
						this.plugin.settings.meetingFolder = value.trim();
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Meeting tag")
			.setDesc("Any note carrying this tag also counts as a meeting.")
			.addText((text) => {
				text
					.setPlaceholder("#meeting")
					.setValue(this.plugin.settings.meetingTag)
					.onChange(async (value) => {
						this.plugin.settings.meetingTag = value.trim();
						await this.plugin.saveSettings();
					});
			});

		// --- License section ---
		new Setting(containerEl).setName("License").setHeading();

		new Setting(containerEl)
			.setName("Pro license key")
			.setDesc("Unlocks Pro features. Leave empty to run the free tier.")
			.addText((text) => {
				text
					.setPlaceholder("MNS-...")
					.setValue(this.plugin.settings.proLicenseKey)
					.onChange(async (value) => {
						this.plugin.settings.proLicenseKey = value.trim();
						await this.plugin.saveSettings();
					});
			});
	}
}
