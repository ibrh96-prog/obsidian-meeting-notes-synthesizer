import type { LLMAdapter } from "./llm";
import type {
	ActionItem,
	Decision,
	MeetingNote,
	SynthesisCache,
} from "./types";

/**
 * Owns the synthesis cache and answers cross-meeting queries.
 * Phase 2 skeleton: methods compile and return empty results. Real
 * extraction/analysis lands in Phase 3.
 */
export class SynthesisEngine {
	private readonly llm: LLMAdapter;
	private readonly cache: SynthesisCache;

	constructor(llm: LLMAdapter, cache: SynthesisCache) {
		this.llm = llm;
		this.cache = cache;
	}

	async syncNotes(notes: MeetingNote[]): Promise<void> {
		// TODO Phase 3: for each changed note (mtime differs from cache),
		// call the LLM to extract decisions/actions and store them in the cache.
		void notes;
		void this.llm;
		void this.cache;
	}

	getDecisionHistory(topic?: string): Decision[] {
		// TODO Phase 3: return decisions from the cache, filtered by topic.
		void topic;
		return [];
	}

	getOpenActions(owner?: string): ActionItem[] {
		// TODO Phase 3: return open action items from the cache, filtered by owner.
		void owner;
		return [];
	}

	getWeeklyRollup(weekStartISO: string): {
		decisions: Decision[];
		actions: ActionItem[];
	} {
		// TODO Phase 3: collect decisions/actions falling within the given week.
		void weekStartISO;
		return { decisions: [], actions: [] };
	}

	detectConflicts(): Decision[] {
		// TODO Phase 3: flag superseded/conflicting decisions across meetings.
		return [];
	}
}
