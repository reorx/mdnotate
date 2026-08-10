//! Reading and changing the app macOS uses to open Markdown files.
//!
//! LaunchServices keys the association off a content type rather than the file
//! extension; `net.daringfireball.markdown` is the system-declared UTI that
//! covers both `.md` and `.markdown`, and is what `Info.plist` claims.

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
const MARKDOWN_UTI: &str = "net.daringfireball.markdown";

/// `/Applications/Neovide.app` -> `Neovide`.
#[cfg(target_os = "macos")]
fn app_display_name(bundle_id: &str) -> Option<String> {
    let path = sys::app_path(bundle_id)?;
    Some(path.file_stem()?.to_string_lossy().into_owned())
}

#[cfg(target_os = "macos")]
pub fn status(bundle_id: &str) -> DefaultAppStatus {
    let handler = sys::default_handler(MARKDOWN_UTI);
    DefaultAppStatus {
        supported: true,
        is_default: handler.as_deref().is_some_and(|h| h.eq_ignore_ascii_case(bundle_id)),
        current_handler_name: handler.as_deref().and_then(app_display_name),
        current_handler_id: handler,
        app_registered: sys::app_path(bundle_id).is_some(),
    }
}

/// Asks macOS to make us the Markdown handler. The user still has to accept the
/// prompt macOS raises, so callers poll [`status`] for the outcome.
#[cfg(target_os = "macos")]
pub fn request_default(bundle_id: &str) {
    sys::set_default_handler(MARKDOWN_UTI, bundle_id);
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
}
