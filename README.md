# Meeting Notes Synthesizer

Turn a folder of meeting notes into a living "meeting memory." Meeting Notes Synthesizer reads across all of your meetings and builds a single synthesis: a running decision history, open action items grouped by person, a weekly rollup, and a view of how decisions evolved over time.

This is **not** a single-meeting summarizer. It works *across* meetings to answer the questions a summary can't: what did we decide, has that changed, who still owes what, and what happened this week?

## Features

- **Decision history** — every decision pulled from your notes, with its date and a link back to the source note.
- **Open actions by person** — outstanding action items grouped by owner, with due dates.
- **Weekly rollup** — decisions and actions from the current week (Monday-start).
- **Decision evolution** — when a decision on the same topic is revisited, see the full chain and which version is current.
- **Bring your own key** — works with Anthropic, OpenAI, OpenRouter, or any OpenAI-compatible endpoint. Your key and notes never leave your machine except to the provider you choose.

## How it works

A note is treated as a meeting if it lives in your configured meeting folder **or** carries your configured tag. The plugin extracts decisions and action items from each note with a single LLM call per note, caches the results, and re-processes only notes that have changed. A separate command builds the synthesis into a `Meeting Synthesis.md` note at your vault root.

## Installation

### From Obsidian Community Plugins
1. Open **Settings → Community plugins**.
2. Click **Browse**, search for **Meeting Notes Synthesizer**, and install it.
3. Enable the plugin.

### Manual
1. Download `main.js`, `manifest.json`, and `styles.css` from the latest [GitHub release](https://github.com/ibrh96-prog/obsidian-meeting-notes-synthesizer/releases).
2. Copy them into `<your-vault>/.obsidian/plugins/meeting-notes-synthesizer/`.
3. Reload Obsidian and enable the plugin.

## Setup

Open **Settings → Meeting Notes Synthesizer**.

**Language model**
- **Provider** — Anthropic or OpenAI-compatible.
- **API key** — your own key. Stored locally in your vault; never committed or shared.
- **Base URL** — for OpenAI-compatible providers. For OpenRouter, use `https://openrouter.ai/api` (no trailing `/v1`).
- **Model** — the model id passed to the provider (e.g. `claude-sonnet-4-6`, or an OpenRouter model id).

**Meeting detection**
- **Meeting folder** — a vault-relative folder whose notes are treated as meetings.
- **Meeting tag** — any note carrying this tag also counts as a meeting.

## Usage

Two commands (plus a ribbon icon):
- **Sync meeting notes** — reads your meeting notes and extracts decisions and actions. This is the step that calls your LLM.
- **Generate synthesis report** — builds `Meeting Synthesis.md` from the cached data, with no LLM call. The ribbon icon runs this command.

Typical flow: add or edit meeting notes → **Sync meeting notes** → **Generate synthesis report**.

## Free tier and Pro

- **Free** — 3 syncs per month, all features included.
- **Pro** — unlimited syncs. One-time purchase, $19.99.

Pro is a one-time offline license: no account, no subscription, no server. Your license is verified locally on your machine.

[Get Pro on Gumroad »](GUMROAD_URL_PLACEHOLDER)

To activate, paste your license key into **Settings → Meeting Notes Synthesizer → License**.

## Privacy

Meeting Notes Synthesizer has no server, no database, and no telemetry. Your notes and API key stay on your machine. The only network request the plugin makes is to the LLM provider you configure, using your own key.

## License

Source-available. Use of the plugin is governed by the EULA — see [EULA.md](EULA.md).
