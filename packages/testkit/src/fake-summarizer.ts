import type {
  ConversationSummarizer,
  ConversationSummary,
  SummarizeConversationRequest,
} from "@ctrl-zebra/core";

export class FakeSummarizerScriptExhaustedError extends Error {
  constructor() {
    super("FakeSummarizer has no scripted summary for this request.");
    this.name = "FakeSummarizerScriptExhaustedError";
  }
}

export class FakeSummarizer implements ConversationSummarizer {
  readonly requests: SummarizeConversationRequest[] = [];
  readonly #summaries: readonly ConversationSummary[];
  #nextSummary = 0;

  constructor(summaries: readonly ConversationSummary[]) {
    this.#summaries = [...summaries];
  }

  async summarize(
    request: SummarizeConversationRequest,
    signal: AbortSignal,
  ): Promise<ConversationSummary> {
    signal.throwIfAborted();
    this.requests.push({
      messages: [...request.messages],
      coveredMessageRange: { ...request.coveredMessageRange },
    });
    const summary = this.#summaries[this.#nextSummary];
    this.#nextSummary += 1;

    if (summary === undefined) {
      throw new FakeSummarizerScriptExhaustedError();
    }

    signal.throwIfAborted();
    return summary;
  }
}
