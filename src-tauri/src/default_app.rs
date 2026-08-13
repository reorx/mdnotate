//! Reading and changing the app macOS uses to open Markdown files.
//!
//! LaunchServices keys the association off a content type (UTI) rather than the
//! file extension, and which UTI `.md` maps to is machine-dependent: editors
//! like iA Writer and Typora *export* their own markdown UTIs
//! (`net.ia.markdown`, `io.typora.markdown`) and can win the extension binding
//! over `net.daringfireball.markdown`. A handler set on the wrong UTI reads
//! back as "default" while Finder keeps opening something else. So the UTIs
//! are resolved per machine from the extensions, with the daringfireball one
//! kept as a fallback claim.

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DefaultAppStatus {
    /// False where the default handler cannot be inspected at all.
    pub supported: bool,
    pub is_default: bool,
    /// Bundle identifier currently registered for Markdown, if any.
    pub current_handler_id: Option<String>,
    /// Display name of that app, e.g. `Neovide`.
    pub current_handler_name: Option<String>,
    /// Whether LaunchServices can resolve our own bundle identifier. It cannot
    /// for an unbundled `tauri dev` binary that was never installed, and
    /// without that the set request is silently ignored.
    pub app_registered: bool,
}

#[cfg(target_os = "macos")]
mod sys {
    use core_foundation::array::{CFArray, CFArrayRef};
    use core_foundation::base::TCFType;
    use core_foundation::string::{CFString, CFStringRef};
    use core_foundation::url::CFURL;
    use std::ffi::c_void;
    use std::path::PathBuf;
    use std::ptr;

    /// `kLSRolesAll` — match the handler whatever role it claims.
    const LS_ROLES_ALL: u32 = 0xFFFF_FFFF;

    #[link(name = "CoreServices", kind = "framework")]
    extern "C" {
        fn LSCopyDefaultRoleHandlerForContentType(content_type: CFStringRef, role: u32) -> CFStringRef;
        fn LSSetDefaultRoleHandlerForContentType(
            content_type: CFStringRef,
            role: u32,
            handler_bundle_id: CFStringRef,
        ) -> i32;
        fn LSCopyApplicationURLsForBundleIdentifier(bundle_id: CFStringRef, out_error: *mut c_void) -> CFArrayRef;
        fn UTTypeCreatePreferredIdentifierForTag(
            tag_class: CFStringRef,
            tag: CFStringRef,
            conforming_to: CFStringRef,
        ) -> CFStringRef;
    }

    /// The UTI this machine currently binds the extension to. Never `None` in
    /// practice: with no declared type LaunchServices mints a `dyn.*` UTI,
    /// which set/read handler calls accept just the same.
    pub fn preferred_uti_for_extension(ext: &str) -> Option<String> {
        let tag_class = CFString::from_static_string("public.filename-extension");
        let tag = CFString::new(ext);
        let uti = unsafe {
            UTTypeCreatePreferredIdentifierForTag(
                tag_class.as_concrete_TypeRef(),
                tag.as_concrete_TypeRef(),
                ptr::null(),
            )
        };
        if uti.is_null() {
            return None;
        }
        Some(unsafe { CFString::wrap_under_create_rule(uti) }.to_string())
    }

    pub fn default_handler(uti: &str) -> Option<String> {
        let uti = CFString::new(uti);
        let handler = unsafe { LSCopyDefaultRoleHandlerForContentType(uti.as_concrete_TypeRef(), LS_ROLES_ALL) };
        if handler.is_null() {
            return None;
        }
        Some(unsafe { CFString::wrap_under_create_rule(handler) }.to_string())
    }

    /// Queues the change; it does not apply it. macOS puts up its own
    /// "Use mdnotate / Keep <other>" prompt and only rewrites the association
    /// once the user answers, so the returned status says nothing useful (it is
    /// `noErr` even for a bundle identifier LaunchServices has never heard of)
    /// and the handler still reads as the old app when this returns.
    pub fn set_default_handler(uti: &str, bundle_id: &str) {
        let uti = CFString::new(uti);
        let bundle_id = CFString::new(bundle_id);
        unsafe {
            LSSetDefaultRoleHandlerForContentType(
                uti.as_concrete_TypeRef(),
                LS_ROLES_ALL,
                bundle_id.as_concrete_TypeRef(),
            );
        }
    }

    pub fn app_path(bundle_id: &str) -> Option<PathBuf> {
        let bundle_id = CFString::new(bundle_id);
        let urls =
            unsafe { LSCopyApplicationURLsForBundleIdentifier(bundle_id.as_concrete_TypeRef(), ptr::null_mut()) };
        if urls.is_null() {
            return None;
        }
        let urls: CFArray<CFURL> = unsafe { CFArray::wrap_under_create_rule(urls) };
        urls.get(0).and_then(|url| url.to_path())
    }
}

#[cfg(target_os = "macos")]
const MARKDOWN_FALLBACK_UTI: &str = "net.daringfireball.markdown";

/// UTIs to associate, most user-visible first: whatever `.md` / `.markdown`
/// actually resolve to on this machine, then the daringfireball UTI as a
/// fallback (it is also what `Info.plist` claims explicitly).
#[cfg(target_os = "macos")]
fn markdown_utis() -> Vec<String> {
    let mut utis: Vec<String> = Vec::new();
    for ext in ["md", "markdown"] {
        if let Some(uti) = sys::preferred_uti_for_extension(ext) {
            if !utis.contains(&uti) {
                utis.push(uti);
            }
        }
    }
    let fallback = MARKDOWN_FALLBACK_UTI.to_string();
    if !utis.contains(&fallback) {
        utis.push(fallback);
    }
    utis
}

/// `/Applications/Neovide.app` -> `Neovide`.
#[cfg(target_os = "macos")]
fn app_display_name(bundle_id: &str) -> Option<String> {
    let path = sys::app_path(bundle_id)?;
    Some(path.file_stem()?.to_string_lossy().into_owned())
}

#[cfg(target_os = "macos")]
pub fn status(bundle_id: &str) -> DefaultAppStatus {
    let handlers: Vec<Option<String>> = markdown_utis().iter().map(|uti| sys::default_handler(uti)).collect();
    // Every resolved UTI must point at us; a handler on the fallback UTI alone
    // is exactly the "reads as default but Finder disagrees" trap.
    let is_default = handlers
        .iter()
        .all(|h| h.as_deref().is_some_and(|h| h.eq_ignore_ascii_case(bundle_id)));
    // Surface the handler of the UTI `.md` actually binds to — the one Finder uses.
    let handler = handlers.into_iter().next().flatten();
    DefaultAppStatus {
        supported: true,
        is_default,
        current_handler_name: handler.as_deref().and_then(app_display_name),
        current_handler_id: handler,
        app_registered: sys::app_path(bundle_id).is_some(),
    }
}

/// Asks macOS to make us the Markdown handler. The user still has to accept the
/// prompt macOS raises, so callers poll [`status`] for the outcome.
#[cfg(target_os = "macos")]
pub fn request_default(bundle_id: &str) {
    for uti in markdown_utis() {
        sys::set_default_handler(&uti, bundle_id);
    }
}

#[cfg(not(target_os = "macos"))]
pub fn status(_bundle_id: &str) -> DefaultAppStatus {
    DefaultAppStatus {
        supported: false,
        is_default: false,
        current_handler_id: None,
        current_handler_name: None,
        app_registered: false,
    }
}

#[cfg(not(target_os = "macos"))]
pub fn request_default(_bundle_id: &str) {}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    /// Smoke-tests the LaunchServices FFI against a bundle that ships with
    /// every macOS install. Read-only: nothing about the system changes.
    #[test]
    fn resolves_a_known_bundle_identifier_to_its_app_name() {
        assert_eq!(app_display_name("com.apple.finder").as_deref(), Some("Finder"));
        assert_eq!(app_display_name("com.example.definitely-not-installed"), None);
    }

    #[test]
    fn reports_the_markdown_handler_without_claiming_an_uninstalled_app_is_default() {
        let s = status("com.example.definitely-not-installed");
        assert!(s.supported);
        assert!(!s.is_default);
        assert!(!s.app_registered);
    }

    /// `.md` must resolve to *some* UTI on every machine (a third-party
    /// exported one, the daringfireball one, or a minted `dyn.*`), and the
    /// list must keep the fallback claim without duplicating entries.
    #[test]
    fn resolves_markdown_utis_for_this_machine() {
        let utis = markdown_utis();
        assert!(utis.iter().any(|u| u == MARKDOWN_FALLBACK_UTI));
        assert!(!utis[0].is_empty());
        let mut deduped = utis.clone();
        deduped.sort();
        deduped.dedup();
        assert_eq!(deduped.len(), utis.len());
    }
}
