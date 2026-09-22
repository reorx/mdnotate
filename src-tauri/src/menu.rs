//! The menu bar: Tauri's own, with two items added to the File menu.
//!
//! Patched rather than rebuilt, for three reasons:
//!
//! 1. `WINDOW_SUBMENU_ID` and `HELP_SUBMENU_ID` are load-bearing. macOS hangs
//!    the native window list off the first and the Help search box off the
//!    second, by id — build the menu ourselves and they have to be remembered.
//! 2. The About panel is filled in from `package_info()` and the bundle's
//!    `copyright` / `publisher`. Rebuilding means copying that out as well.
//! 3. The Edit submenu — undo, redo, cut, copy, paste and **select all ⌘A** —
//!    must stay exactly as it is. `src/lib/use-select-all.ts` works against
//!    this menu as it stands, so touching it is changing a behaviour that has
//!    already been pinned down.

use tauri::menu::{Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Runtime};

const NEW_WINDOW: &str = "new-window";
const OPEN_FILE: &str = "open-file";

/// What a menu item was for. The id strings appear in this file alone; the rest
/// of the app matches on the enum, so a rename cannot quietly miss a call site.
#[derive(Debug, PartialEq, Eq)]
pub enum MenuAction {
    NewWindow,
    OpenFile,
}

/// Which of ours was chosen, if it was one of ours at all: every predefined
/// item — quit, close, copy — comes through the same event and is not ours to
/// act on.
pub fn menu_action(id: &str) -> Option<MenuAction> {
    match id {
        NEW_WINDOW => Some(MenuAction::NewWindow),
        OPEN_FILE => Some(MenuAction::OpenFile),
        _ => None,
    }
}

/// The default menu, with New Window and Open… at the head of File.
///
/// Both accelerators are free: the only keys the frontend claims for itself are
/// ⌘A, ⌘F, ⌘G and Escape.
pub fn build_menu<R: Runtime>(handle: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let menu = Menu::default(handle)?;
    let new_window = MenuItem::with_id(handle, NEW_WINDOW, "New Window", true, Some("CmdOrCtrl+N"))?;
    let open = MenuItem::with_id(handle, OPEN_FILE, "Open…", true, Some("CmdOrCtrl+O"))?;

    let file = menu.items()?.into_iter().find_map(|item| match item {
        MenuItemKind::Submenu(submenu) if submenu.text().is_ok_and(|text| text == "File") => {
            Some(submenu)
        }
        _ => None,
    });

    match file {
        // Above the separator, and above Close Window, which is all the
        // default File menu holds.
        Some(file) => {
            let separator = PredefinedMenuItem::separator(handle)?;
            file.insert_items(&[&new_window, &open, &separator], 0)?;
        }
        // "File" is Tauri's own hard-coded English, and nothing promises it
        // stays that text or that submenu across versions. ⌘O and ⌘N are not
        // allowed to disappear with it, so they get a File menu of their own,
        // next to the app menu where File belongs. Two File menus is a
        // conspicuous way to fail; silently having no way to open a document
        // is not.
        None => {
            let file = Submenu::with_items(handle, "File", true, &[&new_window, &open])?;
            menu.insert(&file, 1)?;
        }
    }

    Ok(menu)
}

#[cfg(test)]
mod tests {
    use super::{menu_action, MenuAction};

    #[test]
    fn the_two_items_of_ours_are_recognised() {
        assert_eq!(menu_action("new-window"), Some(MenuAction::NewWindow));
        assert_eq!(menu_action("open-file"), Some(MenuAction::OpenFile));
    }

    /// Every predefined item arrives through the same handler, so anything
    /// unrecognised has to mean "not ours" rather than a default.
    #[test]
    fn anything_else_is_not_ours_to_act_on() {
        assert_eq!(menu_action("close"), None);
        assert_eq!(menu_action(""), None);
    }
}
