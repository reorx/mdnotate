//! Local image resolution is scoped to a document load. Batch resolution scans
//! the nearest Obsidian vault once, never following directory symlinks. Reading
//! is separate so IPC can return bytes rather than JSON-encoded image arrays.

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("mdnotate-images-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
            std::fs::create_dir_all(root.join(".obsidian")).unwrap();
            std::fs::create_dir_all(root.join("notes")).unwrap();
            std::fs::write(root.join("notes/note.md"), "test").unwrap();
            Self(root.canonicalize().unwrap())
        }
        fn put(&self, path: &str, bytes: &[u8]) -> PathBuf {
            let path = self.0.join(path);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, bytes).unwrap();
            path
        }
        fn resolve(&self, reference: &str, obsidian: bool) -> Result<PathBuf, String> {
            resolve_images(&self.0.join("notes/note.md"), &[ImageReference { reference: reference.into(), obsidian }]).remove(0)
        }
    }
    impl Drop for Fixture { fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); } }
    #[test]
    fn nearby_then_root_then_unique_attachment_and_suffix() {
        let f = Fixture::new();
        let attachment = f.put("attachments/中文 image.webp", b"RIFF1234WEBP");
        assert_eq!(f.resolve("中文 image.webp", true).unwrap(), attachment);
        assert_eq!(f.resolve("attachments/中文 image.webp", true).unwrap(), attachment);
        assert!(f.resolve("中文 image.webp", false).is_err());
        let root = f.put("中文 image.webp", b"root");
        assert_eq!(f.resolve("中文 image.webp", true).unwrap(), root);
        let near = f.put("notes/中文 image.webp", b"near");
        assert_eq!(f.resolve("中文 image.webp", true).unwrap(), near);
    }
    #[test]
    fn missing_ambiguous_and_hidden_paths_are_not_guessed() {
        let f = Fixture::new();
        f.put("a/image.jpg", b"a"); f.put("b/image.jpg", b"b");
        assert!(f.resolve("image.jpg", true).unwrap_err().contains("Ambiguous"));
        assert!(f.resolve("missing.jpg", true).unwrap_err().contains("not found"));
        f.put(".git/hidden.jpg", b"a"); f.put(".obsidian/hidden.jpg", b"b");
        assert!(f.resolve("hidden.jpg", true).is_err());
    }
    #[test]
    fn no_vault_only_relative_and_explicit_paths() {
        let f = Fixture::new(); std::fs::remove_dir(f.0.join(".obsidian")).unwrap();
        let image = f.put("images/a.jpg", b"a");
        assert_eq!(f.resolve("../images/a.jpg", true).unwrap(), image);
        assert_eq!(f.resolve(image.to_str().unwrap(), false).unwrap(), image);
        assert!(f.resolve("a.jpg", true).is_err());
    }
    #[test]
    fn image_bytes_mime_type_and_size_are_validated() {
        let f = Fixture::new();
        let webp = f.put("a.webp", include_bytes!("../../tests/fixtures/images/pixel.webp"));
        assert_eq!(image_mime(&webp), Some("image/webp"));
        assert_eq!(read_image(&webp).unwrap(), include_bytes!("../../tests/fixtures/images/pixel.webp"));
        let jpeg = f.put("a.jpg", include_bytes!("../../tests/fixtures/images/pixel.jpg"));
        assert!(read_image(&jpeg).is_ok());
        assert!(read_image(&f.put("bad.webp", b"not an image")).is_err());
        assert!(read_image(&f.put("text.txt", b"secret")).is_err());
        let large = f.put("large.png", b"");
        std::fs::OpenOptions::new().write(true).open(&large).unwrap().set_len(MAX_IMAGE_BYTES + 1).unwrap();
        assert!(read_image(&large).unwrap_err().contains("25 MiB"));
    }
    #[cfg(unix)]
    #[test]
    fn directory_symlinks_do_not_escape_or_loop() {
        let f = Fixture::new();
        std::os::unix::fs::symlink(&f.0, f.0.join("loop")).unwrap();
        assert!(f.resolve("missing.jpg", true).is_err());
    }
}

use std::path::{Path, PathBuf};
use std::io::Read;

const MAX_IMAGE_BYTES: u64 = 25 * 1024 * 1024;
#[derive(serde::Deserialize)]
pub struct ImageReference { pub reference: String, pub obsidian: bool }

pub fn image_mime(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "jpg" | "jpeg" => Some("image/jpeg"), "png" => Some("image/png"),
        "gif" => Some("image/gif"), "webp" => Some("image/webp"), _ => None,
    }
}

fn vault_root(note: &Path) -> Option<&Path> {
    note.parent()?.ancestors().find(|dir| dir.join(".obsidian").is_dir())
}

fn scan_images(root: &Path, out: &mut Vec<PathBuf>, budget: &mut usize) -> Result<(), String> {
    for entry in std::fs::read_dir(root).map_err(|e| format!("Cannot search attachments: {e}"))? {
        let entry = entry.map_err(|e| e.to_string())?;
        if *budget == 0 { return Err("Attachment search exceeds 100000 entries".into()); }
        *budget -= 1;
        if entry.file_name() == ".obsidian" || entry.file_name() == ".git" { continue; }
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        if kind.is_dir() { scan_images(&entry.path(), out, budget)?; }
        else if kind.is_file() && image_mime(&entry.path()).is_some() { out.push(entry.path()); }
    }
    Ok(())
}

/// Exact local paths take precedence. Only Obsidian embeds may fall back to
/// suffix lookup; a basename collision is an error, never a filesystem-order pick.
pub fn resolve_images(note: &Path, references: &[ImageReference]) -> Vec<Result<PathBuf, String>> {
    let vault = vault_root(note);
    let mut index = None;
    references.iter().map(|item| {
        let reference = Path::new(&item.reference);
        if image_mime(reference).is_none() { return Err("Unsupported image format".into()); }
        let nearby = note.parent().unwrap_or(Path::new("/")).join(reference);
        if nearby.is_file() { return nearby.canonicalize().map_err(|e| e.to_string()); }
        if item.obsidian {
            if let Some(root) = vault {
                let exact = root.join(reference);
                if exact.is_file() { return exact.canonicalize().map_err(|e| e.to_string()); }
                let files = index.get_or_insert_with(|| {
                    let mut files = Vec::new();
                    scan_images(root, &mut files, &mut 100_000).map(|_| files)
                });
                let matches: Vec<_> = files.as_ref().map_err(Clone::clone)?.iter()
                    .filter(|path| path.strip_prefix(root).is_ok_and(|relative| relative.ends_with(reference))).collect();
                match matches.len() {
                    1 => return Ok(matches[0].clone()),
                    0 => {},
                    _ => return Err(format!("Ambiguous image: {} ({} matches)", item.reference, matches.len())),
                }
            }
        }
        Err(format!("Image not found: {}", item.reference))
    }).collect()
}

/// Check extension AND magic before exposing bytes. Decode errors beyond the
/// header remain the browser's responsibility; no text or SVG is served here.
pub fn read_image(path: &Path) -> Result<Vec<u8>, String> {
    let mime = image_mime(path).ok_or("Unsupported image format")?;
    let file = std::fs::File::open(path).map_err(|e| format!("Cannot read image: {e}"))?;
    if !file.metadata().map_err(|e| e.to_string())?.is_file() { return Err("Image is not a regular file".into()); }
    let mut bytes = Vec::new();
    file.take(MAX_IMAGE_BYTES + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_IMAGE_BYTES { return Err("Image exceeds 25 MiB".into()); }
    let valid = match mime {
        "image/jpeg" => bytes.starts_with(&[0xff, 0xd8, 0xff]),
        "image/png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "image/gif" => bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a"),
        "image/webp" => bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP"),
        _ => false,
    };
    if !valid { return Err("Invalid or damaged image".into()); }
    Ok(bytes)
}

#[tauri::command]
pub async fn resolve_doc_images(note: String, references: Vec<ImageReference>) -> Result<Vec<Result<String, String>>, String> {
    tauri::async_runtime::spawn_blocking(move || resolve_images(Path::new(&note), &references).into_iter()
        .map(|result| result.map(|path| path.to_string_lossy().into_owned())).collect())
        .await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn read_doc_image(path: String) -> Result<tauri::ipc::Response, String> {
    let bytes = tauri::async_runtime::spawn_blocking(move || read_image(Path::new(&path)))
        .await.map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(bytes))
}
