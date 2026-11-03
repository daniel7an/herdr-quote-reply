import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { focused, run, exec, theme, nextCommand, notify } from "herdr";

// Select text in an agent's output, press ⌘⇧A: the selection is pasted into
// that agent's input as a "> " quote, with the cursor below it for your reply.
// Nothing is submitted; you type and press Enter yourself.

function selectedSession() {
  const f = focused();
  return f?.shown || f?.terminal || null;
}

// Only the pasteboard's revision is queried here; the text itself stays in-process.
async function clipboardRevision() {
  const r = await exec("/usr/bin/osascript", ["-l", "JavaScript", "-e", 'ObjC.import("AppKit"); String($.NSPasteboard.generalPasteboard.changeCount)']);
  if (r.code !== 0 || !/^\d+$/.test(r.stdout.trim())) throw new Error("Could not check the clipboard. Try again.");
  return r.stdout.trim();
}

export function quoteBlock(text) {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\s+$/, "").split("\n");
  return "\n" + lines.map((line) => (line.trim() ? "> " + line : ">")).join("\n") + "\n\n";
}

const wait = (cx, ms) => new Promise((resolve) => cx.timer.after(ms, () => resolve()));

export default class QuoteReply extends View {
  init(_props, cx) {
    this.busy = false;
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "quote") this.quote(cx);
      }
    });
  }

  quote(cx) {
    if (this.busy) return;
    const address = selectedSession();
    if (!address) {
      notify({ title: "Quote selection", body: "Focus a terminal, select text, then press ⌘⇧A.", level: "info" });
      return;
    }
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        // Herdr copies a selection as soon as it's made, so the clipboard already holds it.
        // Refuse only if nothing new was copied since the last quote (avoids re-pasting stale text).
        const revision = await clipboardRevision();
        if (revision === this.lastRevision) throw new Error("Nothing new selected since the last quote. Select text, then press ⌘⇧A.");
        if (selectedSession() !== address) throw new Error("The focused terminal changed. Select the text again.");
        const text = cx.read_from_clipboard() || "";
        if (!text.trim()) throw new Error("Nothing selected. Select text, then press ⌘⇧A.");
        cx.write_to_clipboard(quoteBlock(text));
        run("terminal.paste");
        // Our own write bumps the revision; remember it so the next ⌘⇧A needs a fresh selection.
        await wait(cx, 100);
        this.lastRevision = await clipboardRevision();
      } catch (e) {
        notify({ title: "Quote selection", body: String(e.message || e), level: "warning" });
      } finally {
        this.busy = false;
        cx.notify();
      }
    });
  }

  render() {
    const t = theme();
    return h_flex().id("quote-reply").h_full().px(12).items_center().gap(8)
      .border_l_1().border_color(t.border).text_size(11.5).text_color(t.muted).cursor_pointer()
      .hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.quote(cx))
      .child(this.busy ? "Quoting…" : "Quote selection").child(div().text_color(t.dim).child("⌘⇧A"));
  }
}
