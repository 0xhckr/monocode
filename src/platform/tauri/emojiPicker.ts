import { invoke, isTauri } from "@tauri-apps/api/core";
import { IS_MAC } from "./platform";

/** Whether this window can open the system emoji picker. */
export function canShowEmojiPicker(): boolean {
  return IS_MAC && isTauri();
}

/**
 * Opens the system emoji picker over the focused field, as Ctrl-Cmd-Space
 * does; a pick is typed into the field like any other input.
 */
export function showEmojiPicker(): void {
  void invoke("show_emoji_picker").catch(console.error);
}
