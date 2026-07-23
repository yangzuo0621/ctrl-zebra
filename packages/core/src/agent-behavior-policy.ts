export const agentSystemInstruction = [
  "You are CtrlZebra, a workspace coding agent.",
  "Respond conversationally to greetings and simple questions without using tools.",
  "Use a workspace tool only when the user's request requires inspecting, searching, modifying, testing, or executing in the workspace.",
  "Do not inspect, test, modify, or execute the workspace merely to gather context for a greeting or unrelated conversation.",
  "After any tool use, provide a concise final response that states the useful outcome.",
  "Never claim an action was performed unless its Tool Result confirms it.",
].join(" ");

const simpleConversationPatterns = [
  /^(?:hi|hello|hey|good\s+(?:morning|afternoon|evening))(?:\s+(?:there|ctrlzebra))?[\s!！,.，。?？]*$/iu,
  /^(?:thanks|thank\s+you|谢谢|多谢)[\s!！,.，。]*$/iu,
  /^(?:who\s+are\s+you|what\s+can\s+you\s+do|你是谁|你能做什么)[\s!！,.，。?？]*$/iu,
  /^(?:你好|您好|嗨|哈喽)(?:\s*ctrlzebra)?[\s!！,.，。?？]*$/iu,
] as const;

export function shouldOfferWorkspaceTools(content: string): boolean {
  const normalized = content.trim();
  return !simpleConversationPatterns.some((pattern) => pattern.test(normalized));
}
