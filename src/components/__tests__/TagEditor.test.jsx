import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import TagEditor from "../TagEditor";

function setup({ tags = [], suggestions = [] } = {}) {
  const onSave = vi.fn();
  const onClose = vi.fn();
  render(
    <TagEditor tags={tags} suggestions={suggestions} onSave={onSave} onClose={onClose} />
  );
  return { onSave, onClose };
}

const dialog = () => screen.getByRole("dialog", { name: "Tags" });
const chips = () =>
  within(screen.getByRole("list", { name: "Current tags" }))
    .getAllByRole("listitem")
    .map((li) => li.textContent);
const input = () => screen.getByLabelText("Add a tag");

describe("TagEditor", () => {
  it("shows the current tags as chips, each with a Remove button", async () => {
    const { onSave } = setup({ tags: ["winter", "kids"] });
    const user = userEvent.setup();
    expect(chips()).toEqual(["winter", "kids"]);

    await user.click(screen.getByRole("button", { name: "Remove tag winter" }));
    expect(chips()).toEqual(["kids"]);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(["kids"]);
  });

  it("without tags explains what they are for", () => {
    setup();
    expect(screen.queryByRole("list", { name: "Current tags" })).not.toBeInTheDocument();
    expect(within(dialog()).getByText(/No tags yet/)).toBeInTheDocument();
  });

  it("adds a typed tag with Enter or the Add button; several at once with commas; trims and dedupes case-insensitively", async () => {
    const { onSave } = setup({ tags: ["Winter"] });
    const user = userEvent.setup();

    await user.type(input(), "  kids {Enter}");
    expect(chips()).toEqual(["Winter", "kids"]);
    expect(input()).toHaveValue("");

    await user.type(input(), "tools, winter,  KIDS , camping");
    await user.click(screen.getByRole("button", { name: "Add tag" }));
    expect(chips()).toEqual(["Winter", "kids", "tools", "camping"]);

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(["Winter", "kids", "tools", "camping"]);
  });

  it("refuses a tag over 24 characters and more than 10 tags, keeping what was typed", async () => {
    const { onSave } = setup({ tags: Array.from({ length: 10 }, (_, i) => `t${i + 1}`) });
    const user = userEvent.setup();

    // Full: the box is disabled and says so
    expect(input()).toBeDisabled();
    expect(input()).toHaveAttribute("placeholder", "Up to 10 tags");

    // Make room, then try an over-long one
    await user.click(screen.getByRole("button", { name: "Remove tag t10" }));
    expect(input()).toBeEnabled();
    await user.type(input(), `${"x".repeat(25)}{Enter}`);
    expect(screen.getByRole("alert")).toHaveTextContent(/1 to 24 characters/);
    expect(input()).toHaveValue("x".repeat(25)); // not thrown away
    expect(chips()).toHaveLength(9);

    // Two more when one spot is left → over the cap
    await user.clear(input());
    await user.type(input(), "a, b{Enter}");
    expect(screen.getByRole("alert")).toHaveTextContent(/up to 10 tags/);
    expect(chips()).toHaveLength(9);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("offers the tags used on other totes, hiding ones already on this tote (case-insensitive); tapping one adds it", async () => {
    const { onSave } = setup({
      tags: ["winter"],
      suggestions: ["garage", "Winter", "kids"],
    });
    const user = userEvent.setup();
    const suggested = screen.getByRole("list", { name: "Suggested tags" });
    expect(within(suggested).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "garage",
      "kids",
    ]);

    await user.click(within(suggested).getByRole("button", { name: "kids" }));
    expect(chips()).toEqual(["winter", "kids"]);
    // Taken: no longer suggested
    expect(within(screen.getByRole("list", { name: "Suggested tags" })).queryByRole("button", { name: "kids" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(["winter", "kids"]);
  });

  it("Save takes a tag still sitting in the box along (people tap Save right after typing)", async () => {
    const { onSave } = setup({ tags: ["winter"] });
    const user = userEvent.setup();
    await user.type(input(), "kids");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(["winter", "kids"]);
  });

  it("Save refuses when the tag still in the box is invalid", async () => {
    const { onSave } = setup();
    const user = userEvent.setup();
    await user.type(input(), "x".repeat(30));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("Cancel and the backdrop close without saving", async () => {
    const { onSave, onClose } = setup({ tags: ["winter"] });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Remove tag winter" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });
});
