import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MarkdownMessage, maxMarkdownCodePoints } from "./markdown-message.js";
import { strings } from "./strings.js";

describe("MarkdownMessage", () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  });

  it("renders the approved technical Markdown subset as React elements", () => {
    render(
      <MarkdownMessage
        content={[
          "# Heading",
          "",
          "1. ordered",
          "2. list",
          "",
          "**strong** and *emphasis* with `inline` code.",
          "",
          "> quoted",
          "",
          "| Name | Value |",
          "| --- | --- |",
          "| one | two |",
          "",
          "```ts",
          "const value = 1;",
          "```",
        ].join("\n")}
      />,
    );

    expect(screen.getByRole("heading", { name: "Heading" })).toBeVisible();
    expect(screen.getByRole("list", { name: "" })).toBeVisible();
    expect(screen.getByText("strong").closest("strong")).not.toBeNull();
    expect(screen.getByText("emphasis").closest("em")).not.toBeNull();
    expect(screen.getByText("quoted")).toBeVisible();
    expect(screen.getByRole("table")).toBeVisible();
    expect(screen.getByText("const value = 1;")).toBeVisible();
  });

  it("keeps raw HTML and images inert", () => {
    const { container } = render(
      <MarkdownMessage
        content={'<script>alert("x")</script>\n\n![remote](https://evil.test/x.png)'}
      />,
    );

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText('<script>alert("x")</script>')).toBeVisible();
    expect(screen.getByText("remote")).toBeVisible();
  });

  it("keeps nested and malformed Markdown bounded to a stable React projection", () => {
    const { container } = render(
      <MarkdownMessage
        content={[
          "- outer",
          "  - **nested**",
          "    - `inline`",
          "",
          "Unclosed *emphasis and [link](https://example.test",
          "<div>still inert</div>",
        ].join("\n")}
      />,
    );

    expect(container.querySelector("ul ul")).not.toBeNull();
    expect(screen.getByText("nested").closest("strong")).not.toBeNull();
    expect(screen.getByText("inline").closest("code")).not.toBeNull();
    expect(screen.getByText("Unclosed *emphasis and [link](https://example.test")).toBeVisible();
    expect(screen.getByText("<div>still inert</div>")).toBeVisible();
  });

  it("opens only approved links through the Extension callback", async () => {
    const onOpenLink = vi.fn();
    const user = userEvent.setup();
    render(
      <MarkdownMessage
        content={
          "[safe](https://example.test/docs) [bad](javascript:alert(1)) [file](file:///secret)"
        }
        onOpenLink={onOpenLink}
      />,
    );

    const safe = screen.getByRole("link", { name: "safe" });
    expect(screen.queryByRole("link", { name: "bad" })).toBeNull();
    expect(screen.queryByRole("link", { name: "file" })).toBeNull();
    await user.click(safe);
    expect(onOpenLink).toHaveBeenCalledWith("https://example.test/docs");
  });

  it("copies fenced code and reports the result without moving focus", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(<MarkdownMessage content={"```ts\nconst value = 1;\n```"} />);

    const copy = screen.getByRole("button", { name: strings.markdown.copy });
    await user.click(copy);
    await waitFor(() => expect(screen.getByText(strings.markdown.copied)).toBeVisible());
    expect(document.activeElement).toBe(copy);
    expect(writeText).toHaveBeenCalledWith("const value = 1;\n");
  });

  it("activates copy and approved links from the keyboard", async () => {
    const user = userEvent.setup();
    const onOpenLink = vi.fn();
    render(
      <MarkdownMessage
        content={["[safe](https://example.test/docs)", "", "```ts", "const value = 1;", "```"].join(
          "\n",
        )}
        onOpenLink={onOpenLink}
      />,
    );

    const copy = screen.getByRole("button", { name: strings.markdown.copy });
    copy.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByText(strings.markdown.copied)).toBeVisible());
    expect(document.activeElement).toBe(copy);

    const safe = screen.getByRole("link", { name: "safe" });
    safe.focus();
    await user.keyboard("{Enter}");
    expect(onOpenLink).toHaveBeenCalledWith("https://example.test/docs");
  });

  it("bounds oversized and streaming-unclosed content before parsing", () => {
    const content = `\`\`\`text\n${"x".repeat(maxMarkdownCodePoints + 1)}`;
    render(<MarkdownMessage content={content} />);

    expect(screen.getByText(strings.markdown.truncated)).toBeVisible();
    expect(screen.getByRole("button", { name: strings.markdown.copy })).toBeVisible();
  });
});
