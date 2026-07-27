import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Badge } from "./badge.js";
import { Button } from "./button.js";
import { Card } from "./card.js";
import { EmptyState } from "./empty-state.js";
import { Notice } from "./notice.js";

describe("UI Base Components (T1102)", () => {
  describe("Button", () => {
    it("renders with default props and handles click events", async () => {
      const user = userEvent.setup();
      const handleClick = vi.fn();
      render(<Button onClick={handleClick}>Click Me</Button>);

      const button = screen.getByRole("button", { name: "Click Me" });
      expect(button).toBeInTheDocument();
      expect(button).toHaveAttribute("type", "button");

      await user.click(button);
      expect(handleClick).toHaveBeenCalledOnce();
    });

    it("supports variants (primary, secondary, ghost, danger) and sizes (sm, md)", () => {
      const { rerender } = render(
        <Button variant="secondary" size="sm">
          Secondary Small
        </Button>,
      );
      expect(screen.getByRole("button", { name: "Secondary Small" })).toBeInTheDocument();

      rerender(
        <Button variant="danger" size="md">
          Delete Item
        </Button>,
      );
      expect(screen.getByRole("button", { name: "Delete Item" })).toBeInTheDocument();
    });

    it("respects the disabled state and prevents click", async () => {
      const user = userEvent.setup();
      const handleClick = vi.fn();
      render(
        <Button disabled onClick={handleClick}>
          Disabled Button
        </Button>,
      );

      const button = screen.getByRole("button", { name: "Disabled Button" });
      expect(button).toBeDisabled();

      await user.click(button);
      expect(handleClick).not.toHaveBeenCalled();
    });
  });

  describe("Badge", () => {
    it("renders badge with text and specified variant", () => {
      render(<Badge variant="success">Passed</Badge>);
      const badge = screen.getByText("Passed");
      expect(badge).toBeInTheDocument();
      expect(badge.tagName).toBe("SPAN");
    });
  });

  describe("Card", () => {
    it("renders title, headerAction, and children correctly", () => {
      render(
        <Card title="Card Title" headerAction={<Button size="sm">Action</Button>}>
          <p>Card Content</p>
        </Card>,
      );

      expect(screen.getByRole("heading", { name: "Card Title" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Action" })).toBeInTheDocument();
      expect(screen.getByText("Card Content")).toBeInTheDocument();
    });
  });

  describe("Notice", () => {
    it("renders notice with title, role and content", () => {
      render(
        <Notice variant="error" title="Error Occurred">
          Something went wrong.
        </Notice>,
      );

      const notice = screen.getByRole("alert");
      expect(notice).toBeInTheDocument();
      expect(screen.getByText("Error Occurred")).toBeInTheDocument();
      expect(screen.getByText("Something went wrong.")).toBeInTheDocument();
    });
  });

  describe("EmptyState", () => {
    it("renders title, description and action", () => {
      render(
        <EmptyState
          title="No Messages"
          description="Start a conversation by typing below."
          action={<Button>Create Session</Button>}
        />,
      );

      expect(screen.getByRole("heading", { name: "No Messages" })).toBeInTheDocument();
      expect(screen.getByText("Start a conversation by typing below.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Create Session" })).toBeInTheDocument();
    });
  });
});
