pub mod client;
pub mod proposal;
pub mod settings;
pub mod vault;
pub type Result<T> = std::result::Result<T, String>;

pub fn provider(value: &str) -> Result<()> {
    if !["openai", "claude"].contains(&value) {
        return Err("Choose Claude or OpenAI.".into());
    }
    Ok(())
}
pub fn workspace(value: &str) -> Result<()> {
    if !["personal", "demo"].contains(&value) {
        return Err("Invalid workspace.".into());
    }
    Ok(())
}

pub mod configuration;
