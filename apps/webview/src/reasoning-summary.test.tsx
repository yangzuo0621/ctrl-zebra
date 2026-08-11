import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { DisplayReasoningBlock } from "./chat-store.js";
import { ReasoningSummary } from "./reasoning-summary.js";
import { strings } from "./strings.js";

const streamingBlock: DisplayReasoningBlock = {
  blockId: "block-1",
  content: "Inspect the current contracts.",
  state: "streaming",
  truncated: false,
  expanded: true,
};

describe("ReasoningSummary", () => {
  it("renders a labelled Provider-sourced region and toggles it from the keyboard", async () => {
    const user = userEvent.setup();

    function Harness() {
      const [blocks, setBlocks] = useState<readonly DisplayReasoningBlock[]>([streamingBlock]);
      return (
        <ReasoningSummary
          blocks={blocks}
          runTruncated={false}
          onToggle={(blockId) =>
            setBlocks((current) =>
              current.map((block) =>
                block.blockId === blockId ? { ...block, expanded: !block.expanded } : block,
              ),
            )
          }
          onAnnounce={() => {}}
        />
      );
    }

    render(<Harness />);

    expect(screen.getByRole("region", { name: strings.reasoning.regionLabel })).toBeVisible();
    expect(screen.getByText(strings.reasoning.providedBy)).toBeVisible();
    expect(screen.getByText(strings.reasoning.streaming)).toBeVisible();
    const disclosure = screen.getByRole("button", { name: strings.reasoning.toggle(true) });
    expect(disclosure).toHaveAttribute("aria-expanded", "true");

    await user.tab();
    expect(disclosure).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(screen.getByRole("button", { name: strings.reasoning.toggle(false) })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByText(streamingBlock.content)).not.toBeInTheDocument();
  });

  it("renders untrusted content as selectable plain text without activating markup", () => {
    const content = '<img src=x onerror="alert(1)">\n```ts\nconst value = 1;\n```';
    render(
      <ReasoningSummary
        blocks={[{ ...streamingBlock, content, state: "complete" }]}
        runTruncated={false}
        onToggle={() => {}}
        onAnnounce={() => {}}
      />,
    );

    const rendered = document.querySelector("pre");
    expect(rendered).toBeVisible();
    expect(rendered?.textContent).toBe(content);
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("a")).toBeNull();
    expect(rendered?.tagName).toBe("PRE");
  });

  it("copies only the visible bounded block and reports success without moving focus", async () => {
    const user = userEvent.setup();
    const announce = vi.fn();
    render(
      <ReasoningSummary
        blocks={[streamingBlock]}
        runTruncated={false}
        onToggle={() => {}}
        onAnnounce={announce}
      />,
    );
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    const copy = screen.getByRole("button", { name: strings.reasoning.copy });

    await user.click(copy);

    expect(writeText).toHaveBeenCalledWith(streamingBlock.content);
    expect(announce).toHaveBeenCalledWith(strings.reasoning.copied);
    expect(copy).toHaveFocus();
  });

  it("labels multiple blocks, partial content, and block/run truncation visibly", () => {
    render(
      <ReasoningSummary
        blocks={[
          { ...streamingBlock, state: "complete", expanded: false },
          {
            ...streamingBlock,
            blockId: "block-2",
            content: "Recovered partial",
            state: "partial",
            truncated: true,
            expanded: false,
          },
        ]}
        runTruncated
        onToggle={() => {}}
        onAnnounce={() => {}}
      />,
    );

    expect(
      screen.getByRole("button", { name: strings.reasoning.toggle(false, " 1") }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: strings.reasoning.toggle(false, " 2") }),
    ).toBeVisible();
    expect(
      screen.getByText(`${strings.reasoning.partial}${strings.reasoning.truncatedSuffix}`),
    ).toBeVisible();
    expect(screen.getByText(strings.reasoning.truncated)).toBeVisible();
  });

  it("renders nothing when no retained reasoning exists", () => {
    render(<ReasoningSummary blocks={[]} runTruncated onToggle={() => {}} onAnnounce={() => {}} />);

    expect(
      screen.queryByRole("region", { name: strings.reasoning.regionLabel }),
    ).not.toBeInTheDocument();
  });
});
