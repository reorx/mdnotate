//! Window geometry in logical points: outer origin and inner content size.
//! Register each window's actual initial frame before observing changes: creation
//! and cascading must never become the user's preference, or launches drift.
//! Never query `is_maximized()` here: on macOS tao temporarily changes the style
//! mask to determine zoom state, which can itself produce geometry events.

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, WebviewWindow, Window};
use tauri_plugin_store::StoreExt;

pub const CASCADE_STEP: f64 = 28.0;

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Frame {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Copy, Debug)]
pub struct Area {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

fn place(mut base: Frame, others: &[(f64, f64)], areas: &[Area]) -> Frame {
    // Primary comes first and wins ties, including the no-overlap case.
    let mut selected = areas.first();
    let mut largest_overlap = 0.0;
    for area in areas {
        let width = ((base.x + base.width).min(area.x + area.width) - base.x.max(area.x)).max(0.0);
        let height = ((base.y + base.height).min(area.y + area.height) - base.y.max(area.y)).max(0.0);
        let overlap = width * height;
        if overlap > largest_overlap {
            selected = Some(area);
            largest_overlap = overlap;
        }
    }
    if let Some(area) = selected {
        base.width = base.width.min(area.width);
        base.height = base.height.min(area.height);
        base.x = base.x.clamp(area.x, area.x + area.width - base.width);
        base.y = base.y.clamp(area.y, area.y + area.height - base.height);
    }
    for attempt in 0..=others.len() {
        let occupied = others.iter().any(|&(x, y)| {
            (x - base.x).abs() < CASCADE_STEP / 2.0 && (y - base.y).abs() < CASCADE_STEP / 2.0
        });
        if !occupied || attempt == others.len() {
            break;
        }
        base.x += CASCADE_STEP;
        base.y += CASCADE_STEP;
        if let Some(area) = selected {
            if base.x + base.width > area.x + area.width || base.y + base.height > area.y + area.height {
                // With less than one step of spare space, even the wrapped
                // origin needs clamping to keep the whole window visible.
                base.x = (area.x + CASCADE_STEP).min(area.x + area.width - base.width);
                base.y = (area.y + CASCADE_STEP).min(area.y + area.height - base.height);
            }
        }
    }
    base
}

fn same_frame(a: Frame, b: Frame) -> bool {
    (a.x - b.x).abs() < 1.0
        && (a.y - b.y).abs() < 1.0
        && (a.width - b.width).abs() < 1.0
        && (a.height - b.height).abs() < 1.0
}

fn parse_frame(value: &JsonValue) -> Option<Frame> {
    let frame: Frame = serde_json::from_value(value.clone()).ok()?;
    [frame.x, frame.y, frame.width, frame.height].iter().all(|n| n.is_finite())
        .then_some(frame)
        .filter(|frame| frame.width > 0.0 && frame.height > 0.0)
}

#[derive(Default)]
pub struct WindowFrames {
    known: Mutex<HashMap<String, Frame>>,
}

/// Read the current geometry instead of trusting an individual event payload:
/// a move and resize can describe the same change and arrive separately.
fn read_frame(window: &Window) -> tauri::Result<Frame> {
    let scale = window.scale_factor()?;
    let position = window.outer_position()?.to_logical::<f64>(scale);
    let size = window.inner_size()?.to_logical::<f64>(scale);
    Ok(Frame { x: position.x, y: position.y, width: size.width, height: size.height })
}

pub fn register(window: &WebviewWindow) -> tauri::Result<()> {
    let frame = read_frame(&window.as_ref().window())?;
    window.state::<WindowFrames>().known.lock().unwrap().insert(window.label().to_string(), frame);
    Ok(())
}

/// Primary work area first; each monitor uses its own scale, as do windows.
fn work_areas(app: &AppHandle) -> Vec<Area> {
    let mut monitors: Vec<_> = app.primary_monitor().ok().flatten().into_iter().collect();
    for monitor in app.available_monitors().unwrap_or_default() {
        if !monitors.iter().any(|existing| existing.position() == monitor.position() && existing.size() == monitor.size()) {
            monitors.push(monitor);
        }
    }
    monitors.iter().map(|monitor| {
        let area = monitor.work_area();
        let scale = monitor.scale_factor();
        let position = area.position.to_logical::<f64>(scale);
        let size = area.size.to_logical::<f64>(scale);
        Area { x: position.x, y: position.y, width: size.width, height: size.height }
    }).collect()
}

pub fn initial_frame(app: &AppHandle) -> Option<Frame> {
    let remembered = match app.store("window.json") {
        Ok(store) => store.get("frame").as_ref().and_then(parse_frame),
        Err(error) => {
            eprintln!("mdnotate: could not load window frame: {error}");
            None
        }
    };
    let base = remembered.or_else(|| {
        let front = super::front_window(app)?;
        let scale = front.scale_factor().ok()?;
        let position = front.outer_position().ok()?.to_logical::<f64>(scale);
        let config = super::window_config(app);
        Some(Frame { x: position.x, y: position.y, width: config.width, height: config.height })
    })?;
    let others: Vec<_> = app.webview_windows().values().filter_map(|window| {
        let scale = window.scale_factor().ok()?;
        let position = window.outer_position().ok()?.to_logical::<f64>(scale);
        Some((position.x, position.y))
    }).collect();
    Some(place(base, &others, &work_areas(app)))
}

pub fn remember(window: &Window) {
    if window.is_fullscreen().unwrap_or(true) || window.is_minimized().unwrap_or(true) {
        return;
    }
    let frame = match read_frame(window) {
        Ok(frame) => frame,
        Err(error) => {
            eprintln!("mdnotate: could not read window frame: {error}");
            return;
        }
    };
    {
        let state = window.state::<WindowFrames>();
        let mut known = state.known.lock().unwrap();
        // Events delivered during build have no baseline yet. Later creation
        // events match the actual frame registered immediately after build.
        let Some(previous) = known.get_mut(window.label()) else { return; };
        if same_frame(*previous, frame) {
            return;
        }
        *previous = frame;
    }
    // Never hold the geometry lock while calling the store/event machinery.
    match window.app_handle().store("window.json") {
        Ok(store) => store.set("frame", serde_json::json!(frame)),
        Err(error) => eprintln!("mdnotate: could not remember window frame: {error}"),
    }
}

pub fn forget(window: &Window) {
    window.state::<WindowFrames>().known.lock().unwrap().remove(window.label());
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const SCREEN: Area = Area { x: 0.0, y: 25.0, width: 1440.0, height: 875.0 };
    const BASE: Frame = Frame { x: 240.0, y: 160.0, width: 900.0, height: 640.0 };

    #[test]
    fn remembered_frame_is_used_unchanged_when_free() {
        assert_eq!(place(BASE, &[], &[SCREEN]), BASE);
    }

    #[test]
    fn occupied_origin_steps_without_changing_size() {
        assert_eq!(place(BASE, &[(240.0, 160.0)], &[SCREEN]), Frame { x: 268.0, y: 188.0, ..BASE });
    }

    #[test]
    fn skips_every_occupied_step() {
        assert_eq!(place(BASE, &[(240.0, 160.0), (268.0, 188.0)], &[SCREEN]), Frame { x: 296.0, y: 216.0, ..BASE });
    }

    #[test]
    fn nearby_origins_are_occupied_but_distant_windows_do_not_matter() {
        assert_eq!(place(BASE, &[(245.0, 157.0), (800.0, 400.0)], &[SCREEN]), Frame { x: 268.0, y: 188.0, ..BASE });
        assert_eq!(place(BASE, &[(254.0, 160.0), (240.0, 174.0)], &[SCREEN]), BASE);
    }

    #[test]
    fn cascade_wraps_to_work_area_origin_plus_step() {
        let base = Frame { x: 540.0, y: 260.0, ..BASE };
        assert_eq!(place(base, &[(base.x, base.y)], &[SCREEN]), Frame { x: 28.0, y: 53.0, ..BASE });
    }

    #[test]
    fn a_disconnected_screen_falls_back_to_primary_preserving_size() {
        assert_eq!(place(Frame { x: 6000.0, ..BASE }, &[], &[SCREEN]), Frame { x: 540.0, ..BASE });
    }

    #[test]
    fn oversized_frame_shrinks_to_work_area() {
        let expected = Frame { x: SCREEN.x, y: SCREEN.y, width: SCREEN.width, height: SCREEN.height };
        assert_eq!(place(Frame { width: 2000.0, height: 1200.0, ..BASE }, &[], &[SCREEN]), expected);
        // Even wrapping a full-screen-sized frame must leave it on screen.
        assert_eq!(place(expected, &[(expected.x, expected.y)], &[SCREEN]), expected);
    }

    #[test]
    fn partially_offscreen_frame_is_moved_inside() {
        assert_eq!(place(Frame { x: -200.0, y: 500.0, ..BASE }, &[], &[SCREEN]), Frame { x: 0.0, y: 260.0, ..BASE });
    }

    #[test]
    fn screen_with_largest_overlap_wins() {
        let second = Area { x: 1440.0, ..SCREEN };
        assert_eq!(place(Frame { x: 1200.0, ..BASE }, &[], &[SCREEN, second]), Frame { x: 1440.0, ..BASE });
    }

    #[test]
    fn absent_monitor_information_keeps_geometry_and_still_cascades() {
        assert_eq!(place(BASE, &[], &[]), BASE);
        assert_eq!(place(BASE, &[(BASE.x, BASE.y)], &[]), Frame { x: 268.0, y: 188.0, ..BASE });
    }

    #[test]
    fn fully_occupied_wrap_cycle_terminates() {
        let area = Area { width: 928.0, height: 693.0, ..SCREEN };
        let base = Frame { x: 28.0, y: 53.0, ..BASE };
        assert_eq!(place(base, &[(28.0, 53.0)], &[area]), base);
    }

    #[test]
    fn frame_comparison_tolerates_subpoint_rounding_in_every_field() {
        assert!(same_frame(BASE, Frame { x: 240.5, y: 159.5, width: 900.5, height: 639.5 }));
        for other in [Frame { x: 242.0, ..BASE }, Frame { y: 162.0, ..BASE }, Frame { width: 902.0, ..BASE }, Frame { height: 642.0, ..BASE }] {
            assert!(!same_frame(BASE, other));
        }
    }

    #[test]
    fn stored_frame_requires_finite_coordinates_and_positive_dimensions() {
        assert_eq!(parse_frame(&json!(BASE)), Some(BASE));
        assert!(parse_frame(&json!({"x": -900, "y": -50, "width": 900, "height": 640})).is_some());
        for value in [json!(null), json!([]), json!("frame"), json!({"x": 240, "y": 160, "width": 900}), json!({"x": "240", "y": 160, "width": 900, "height": 640})] {
            assert_eq!(parse_frame(&value), None);
        }
        for key in ["x", "y", "width", "height"] {
            for invalid in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
                // JSON represents non-finite f64 values as null.
                let mut value = json!(BASE);
                value[key] = json!(invalid);
                assert_eq!(parse_frame(&value), None);
            }
        }
        for key in ["width", "height"] {
            for invalid in [-1.0, 0.0] {
                let mut value = json!(BASE);
                value[key] = json!(invalid);
                assert_eq!(parse_frame(&value), None);
            }
        }
    }
}
