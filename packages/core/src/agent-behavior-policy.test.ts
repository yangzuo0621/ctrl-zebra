import { describe, expect, it } from "vitest";

import { agentSystemInstruction, shouldOfferWorkspaceTools } from "./agent-behavior-policy.js";

describe("agent behavior policy", () => {
  it.each([
    "hello",
    "Hi there!",
    "你好！",
    "thank you",
    "who are you?",
  ])("withholds workspace tools for the simple conversation %j", (content) => {
    expect(shouldOfferWorkspaceTools(content)).toBe(false);
  });

  it.each([
    "hello, list files",
    "read README.md",
    "run the tests",
    "你好，请检查 package.json",
  ])("keeps workspace tools available for the task %j", (content) => {
    expect(shouldOfferWorkspaceTools(content)).toBe(true);
  });

  it("states the conversational, workspace, tool-result, and final-response constraints", () => {
    expect(agentSystemInstruction).toContain("greetings and simple questions without using tools");
    expect(agentSystemInstruction).toContain("only when the user's request requires");
    expect(agentSystemInstruction).toContain("After any tool use");
    expect(agentSystemInstruction).toContain("Tool Result confirms it");
  });
});
