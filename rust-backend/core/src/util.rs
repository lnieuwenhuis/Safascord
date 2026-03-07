use rand::{distributions::Alphanumeric, thread_rng, Rng};
use regex::Regex;

pub fn random_string(len: usize) -> String {
    thread_rng()
        .sample_iter(&Alphanumeric)
        .take(len)
        .map(char::from)
        .collect()
}

pub fn to_safe_username(input: &str) -> String {
    static NON_ALNUM: once_cell::sync::Lazy<Regex> =
        once_cell::sync::Lazy::new(|| Regex::new(r"[^a-z0-9_]").expect("valid regex"));
    static DUP_UNDERSCORE: once_cell::sync::Lazy<Regex> =
        once_cell::sync::Lazy::new(|| Regex::new(r"_{2,}").expect("valid regex"));
    let lowered = input.to_lowercase();
    let normalized = NON_ALNUM.replace_all(&lowered, "_");
    let squashed = DUP_UNDERSCORE.replace_all(&normalized, "_");
    let trimmed = squashed.trim_matches('_');
    let result: String = trimmed.chars().take(28).collect();
    if result.is_empty() {
        "user".to_string()
    } else {
        result
    }
}
