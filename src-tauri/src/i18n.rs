use std::sync::atomic::{AtomicU8, Ordering};
use tauri::menu::MenuItem;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Locale {
    ZhCn = 0,
    En = 1,
}

static CURRENT_LOCALE: AtomicU8 = AtomicU8::new(Locale::ZhCn as u8);

pub fn parse_locale(tag: &str) -> Locale {
    if tag.trim().to_ascii_lowercase().starts_with("en") {
        Locale::En
    } else {
        Locale::ZhCn
    }
}

pub fn current_locale() -> Locale {
    match CURRENT_LOCALE.load(Ordering::Relaxed) {
        1 => Locale::En,
        _ => Locale::ZhCn,
    }
}

pub fn set_current_locale(locale: Locale) {
    CURRENT_LOCALE.store(locale as u8, Ordering::Relaxed);
}

pub fn is_en() -> bool {
    current_locale() == Locale::En
}

pub fn tr<'a>(zh: &'a str, en: &'a str) -> &'a str {
    if is_en() {
        en
    } else {
        zh
    }
}

pub struct TrayMenuState {
    pub show_item: MenuItem<tauri::Wry>,
    pub quit_item: MenuItem<tauri::Wry>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_locale_tags() {
        assert_eq!(parse_locale("en"), Locale::En);
        assert_eq!(parse_locale("en-US"), Locale::En);
        assert_eq!(parse_locale("zh-CN"), Locale::ZhCn);
        assert_eq!(parse_locale("zh"), Locale::ZhCn);
    }
}
