import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ItemEditSheet from "../ItemEditSheet";

const upload = vi.hoisted(() => vi.fn());
vi.mock("../../services/toteService", () => ({
  toteService: { uploadImage: upload },
}));
vi.mock("../../utils/images", () => ({
  compressImage: vi.fn(async (file) => file),
}));

const lantern = { id: "i1", name: "Lantern", qty: 2, image: "https://cdn/l.jpg" };

function setup(item = lantern) {
  const onSave = vi.fn();
  const onClose = vi.fn();
  const onMove = vi.fn();
  const onViewPhoto = vi.fn();
  render(
    <ItemEditSheet
      item={item}
      onSave={onSave}
      onClose={onClose}
      onMove={onMove}
      onViewPhoto={onViewPhoto}
    />
  );
  return { onSave, onClose, onMove, onViewPhoto };
}

describe("ItemEditSheet", () => {
  beforeEach(() => {
    upload.mockReset();
  });

  it("opens with the item's current name, count and photo", () => {
    setup();
    expect(screen.getByLabelText("Name")).toHaveValue("Lantern");
    expect(screen.getByLabelText("Count")).toHaveValue(2);
    expect(screen.getByRole("img", { name: "Lantern" })).toHaveAttribute("src", lantern.image);
    expect(screen.getByText("Replace photo")).toBeInTheDocument();
  });

  it("a legacy item without qty shows a count of 1", () => {
    setup({ id: 7, name: "Old thing" });
    expect(screen.getByLabelText("Count")).toHaveValue(1);
    expect(screen.getByText("Add photo")).toBeInTheDocument();
  });

  it("Save hands back only the fields that changed (name trimmed, count as a number)", async () => {
    const { onSave, onClose } = setup();
    const user = userEvent.setup();

    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "  Big lantern ");
    await user.clear(screen.getByLabelText("Count"));
    await user.type(screen.getByLabelText("Count"), "5");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledWith({ name: "Big lantern", qty: 5 });
    expect(onClose).not.toHaveBeenCalled(); // the caller closes after saving
  });

  it("Save with nothing changed reports an empty change set", async () => {
    const { onSave } = setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({});
  });

  it("Enter in a field saves", async () => {
    const { onSave } = setup();
    const user = userEvent.setup();
    await user.clear(screen.getByLabelText("Count"));
    await user.type(screen.getByLabelText("Count"), "0{Enter}");
    expect(onSave).toHaveBeenCalledWith({ qty: 0 });
  });

  it("Cancel closes without saving", async () => {
    const { onSave, onClose } = setup();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Name"), " extra");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("rejects an empty name", async () => {
    const { onSave } = setup();
    const user = userEvent.setup();
    await user.clear(screen.getByLabelText("Name"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Item name is required.");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("caps the name at 100 characters", () => {
    setup();
    expect(screen.getByLabelText("Name")).toHaveAttribute("maxLength", "100");
  });

  it("rejects a negative, fractional or empty count", async () => {
    const { onSave } = setup();
    const user = userEvent.setup();
    const count = screen.getByLabelText("Count");
    expect(count).toHaveAttribute("inputMode", "numeric");

    await user.clear(count);
    await user.type(count, "-1");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/whole number, 0 or more/);

    await user.clear(count);
    await user.type(count, "1.5");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/whole number, 0 or more/);

    await user.clear(count);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/whole number, 0 or more/);

    expect(onSave).not.toHaveBeenCalled();
  });

  it("Remove photo saves image: null", async () => {
    const { onSave } = setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Remove photo" }));
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("Add photo")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({ image: null });
  });

  it("Replace photo runs the pick flow (validate → compress → upload) and saves the new url", async () => {
    upload.mockResolvedValue("https://cdn/new.jpg");
    const { onSave } = setup();
    const user = userEvent.setup();

    const file = new File(["x"], "photo.png", { type: "image/png" });
    await user.upload(screen.getByText("Replace photo").closest("label").querySelector("input"), file);

    await waitFor(() =>
      expect(screen.getByRole("img", { name: "Lantern" })).toHaveAttribute("src", "https://cdn/new.jpg")
    );
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0][0]).toBe(file);

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({ image: "https://cdn/new.jpg" });
  });

  it("Enter while a photo is still uploading does not save (same guard as the disabled Save button)", async () => {
    let finishUpload;
    upload.mockImplementation(() => new Promise((resolve) => (finishUpload = resolve)));
    const { onSave } = setup();
    const user = userEvent.setup();

    await user.upload(screen.getByText("Replace photo").closest("label").querySelector("input"), new File(["x"], "p.jpg", { type: "image/jpeg" }));
    expect(await screen.findByText("Uploading…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    await user.type(screen.getByLabelText("Name"), " big{Enter}");
    await user.type(screen.getByLabelText("Count"), "{Enter}");
    expect(onSave).not.toHaveBeenCalled();

    // Once the upload lands, Enter saves — with the NEW photo
    await act(async () => {
      finishUpload("https://cdn/new.jpg");
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
    await user.type(screen.getByLabelText("Name"), "{Enter}");
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({ name: "Lantern big", image: "https://cdn/new.jpg" });
  });

  it("Enter mid-composition (IME) does not save", async () => {
    const { onSave } = setup();
    const input = screen.getByLabelText("Name");
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("refuses a non-image file without uploading", async () => {
    const { onSave } = setup();
    const user = userEvent.setup({ applyAccept: false });
    const input = screen.getByText("Replace photo").closest("label").querySelector("input");
    const file = new File(["x"], "notes.txt", { type: "text/plain" });
    await user.upload(input, file);

    expect(await screen.findByRole("alert")).toHaveTextContent(/Only JPEG, PNG, WebP, and GIF/);
    expect(upload).not.toHaveBeenCalled();
    expect(screen.getByRole("img", { name: "Lantern" })).toHaveAttribute("src", lantern.image);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("shows the upload error and keeps the old photo when the upload fails", async () => {
    upload.mockRejectedValue(new Error("Couldn't upload the photo."));
    setup();
    const user = userEvent.setup();
    const input = screen.getByText("Replace photo").closest("label").querySelector("input");
    await user.upload(input, new File(["x"], "p.jpg", { type: "image/jpeg" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't upload the photo.");
    expect(screen.getByRole("img", { name: "Lantern" })).toHaveAttribute("src", lantern.image);
  });

  it("tapping the thumbnail opens the lightbox with the photo being shown", async () => {
    const { onViewPhoto } = setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "View photo of Lantern" }));
    expect(onViewPhoto).toHaveBeenCalledWith(expect.objectContaining({ image: lantern.image }));
  });

  it("'Move to another tote…' hands off to the caller", async () => {
    const { onMove, onSave } = setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Move to another tote/ }));
    expect(onMove).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("ItemEditSheet note", () => {
  const noteBox = () => screen.getByLabelText(/^Note/);

  it("opens with the item's note (empty for an item without one) and caps it at 200 characters", () => {
    setup({ ...lantern, note: "Left glove missing" });
    expect(noteBox()).toHaveValue("Left glove missing");
    expect(noteBox()).toHaveAttribute("maxLength", "200");
    cleanupAndRender({ id: 7, name: "Old thing" });
    expect(noteBox()).toHaveValue("");
  });

  it("Save hands back only the note when that is all that changed (trimmed)", async () => {
    const { onSave } = setup();
    const user = userEvent.setup();
    await user.type(noteBox(), "  needs new batteries ");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({ note: "needs new batteries" });
  });

  it("clearing the note hands back note: null so the key is removed", async () => {
    const { onSave } = setup({ ...lantern, note: "old" });
    const user = userEvent.setup();
    await user.clear(noteBox());
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({ note: null });
  });

  it("an unchanged note (even with different surrounding whitespace) is not a change", async () => {
    const { onSave } = setup({ ...lantern, note: "same" });
    const user = userEvent.setup();
    await user.type(noteBox(), "  ");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({});
  });

  it("refuses a note over 200 characters (pasted past the cap) without saving", async () => {
    const { onSave } = setup();
    const user = userEvent.setup();
    fireEvent.change(noteBox(), { target: { value: "x".repeat(201) } });
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Note must be 200 characters or less.");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("Enter inside the note makes a new line instead of saving", async () => {
    const { onSave } = setup();
    const user = userEvent.setup();
    await user.type(noteBox(), "line one{Enter}line two");
    expect(noteBox()).toHaveValue("line one\nline two");
    expect(onSave).not.toHaveBeenCalled();
  });

  function cleanupAndRender(item) {
    cleanup();
    setup(item);
  }
});

describe("ItemEditSheet exact count limit", () => {
  it("refuses a count above 9,999 (the +/- row only fits four digits)", async () => {
    const { onSave } = setup();
    const user = userEvent.setup();
    await user.clear(screen.getByLabelText("Count"));
    await user.type(screen.getByLabelText("Count"), "10000{Enter}");
    expect(screen.getByRole("alert")).toHaveTextContent("Count can be at most 9,999.");
    expect(onSave).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText("Count"));
    await user.type(screen.getByLabelText("Count"), "9999{Enter}");
    expect(onSave).toHaveBeenCalledWith({ qty: 9999 });
  });
});
