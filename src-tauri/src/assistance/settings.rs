use super::{vault::KeyStore, Result};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};
/// Suggested Claude model for a provider that has never been configured on this device.
/// Requests send it with high effort; see the client constants.
pub const DEFAULT_CLAUDE_MODEL: &str = "claude-opus-5-5";
#[derive(Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    pub revision: i64,
    pub enabled: bool,
    pub model: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub provider: String,
    #[serde(flatten)]
    pub config: Config,
    pub has_key: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Input {
    pub provider: String,
    pub revision: i64,
    pub enabled: bool,
    pub model: String,
    pub key_action: String,
    pub key: Option<String>,
}
fn path(root: &Path, workspace: &str, provider: &str) -> Result<PathBuf> {
    super::workspace(workspace)?;
    super::provider(provider)?;
    Ok(root
        .join("provider-settings")
        .join(format!("{workspace}-{provider}.json")))
}
pub fn target(root: &Path, workspace: &str, provider: &str) -> Result<String> {
    super::workspace(workspace)?;
    super::provider(provider)?;
    let normalized = root.to_string_lossy().to_lowercase();
    let digest = crate::imports::parse::hash(normalized.as_bytes());
    Ok(format!(
        "com.jacob.personal-finance/{digest}/{workspace}/{provider}"
    ))
}
fn defaults(provider: &str) -> Config {
    Config {
        model: if provider == "claude" {
            DEFAULT_CLAUDE_MODEL.into()
        } else {
            String::new()
        },
        ..Default::default()
    }
}
pub fn read(root: &Path, workspace: &str, provider: &str) -> Result<Config> {
    let path = path(root, workspace, provider)?;
    if !path.exists() {
        return Ok(defaults(provider));
    }
    if fs::metadata(&path)
        .map_err(|_| "Provider settings cannot be read.")?
        .len()
        > 4096
    {
        return Err("Provider settings are invalid.".into());
    }
    let config: Config =
        serde_json::from_slice(&fs::read(path).map_err(|_| "Provider settings cannot be read.")?)
            .map_err(|_| "Provider settings are invalid.".to_string())?;
    if config.revision < 0 || model(&config.model, config.enabled).is_err() {
        return Err("Provider settings are invalid.".into());
    }
    Ok(config)
}
fn model(value: &str, enabled: bool) -> Result<()> {
    if value.len() > 120
        || (enabled && value.is_empty())
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_.:/".contains(&b))
    {
        return Err("Enter the exact API model ID (up to 120 letters, digits or -_.:/).".into());
    }
    Ok(())
}
pub fn view(root: &Path, workspace: &str, provider: &str, vault: &dyn KeyStore) -> Result<View> {
    Ok(View {
        provider: provider.into(),
        config: read(root, workspace, provider)?,
        has_key: vault.read(&target(root, workspace, provider)?)?.is_some(),
    })
}
fn persist(path: &Path, config: &Config) -> Result<()> {
    let parent = path.parent().ok_or("Invalid settings path.")?;
    fs::create_dir_all(parent).map_err(|_| "Provider settings folder cannot be created.")?;
    let temp = parent.join(format!("{}.tmp", uuid::Uuid::new_v4()));
    let bytes =
        serde_json::to_vec(config).map_err(|_| "Provider settings could not be encoded.")?;
    let result = (|| {
        use std::io::Write;
        let mut f = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        f.write_all(&bytes)?;
        f.sync_all()?;
        fs::rename(&temp, path)
    })()
    .map_err(|_| "Provider settings could not be saved. Reload before trying again.".to_string());
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result
}
pub fn save(root: &Path, workspace: &str, input: Input, vault: &dyn KeyStore) -> Result<View> {
    let current = read(root, workspace, &input.provider)?;
    if input.revision != current.revision {
        return Err("Provider settings changed. Reload before saving.".into());
    }
    model(&input.model, input.enabled)?;
    if !["keep", "replace", "remove"].contains(&input.key_action.as_str()) {
        return Err("Choose keep, replace or remove key.".into());
    }
    if input.key_action != "replace" && input.key.as_ref().is_some_and(|s| !s.is_empty()) {
        return Err("Choose Replace key before supplying a new key.".into());
    }
    let destination = path(root, workspace, &input.provider)?;
    let name = target(root, workspace, &input.provider)?;
    let mut next = Config {
        revision: current
            .revision
            .checked_add(1)
            .ok_or("Provider revision is exhausted.")?,
        enabled: input.enabled,
        model: input.model,
    };
    if input.key_action == "replace" {
        let key = input.key.as_deref().ok_or("Enter the API key to save.")?;
        if key.len() < 12 || key.len() > 2000 || !key.bytes().all(|b| b.is_ascii_graphic()) {
            return Err("Enter a valid API key without whitespace (12-2,000 characters).".into());
        }
        // If OS credential mutation or final settings write fails, automatic use stays disabled.
        let disabled = Config {
            enabled: false,
            ..next.clone()
        };
        persist(&destination, &disabled)?;
        vault.write(&name, key)?;
    } else if input.key_action == "remove" {
        next.enabled = false;
        persist(&destination, &next)?;
        vault.delete(&name)?;
    }
    if next.enabled && vault.read(&name)?.is_none() {
        return Err("Save an API key before enabling this provider.".into());
    }
    persist(&destination, &next)?;
    view(root, workspace, &input.provider, vault)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{cell::RefCell, collections::HashMap};
    #[derive(Default)]
    struct Fake {
        values: RefCell<HashMap<String, String>>,
        fail: bool,
    }
    impl KeyStore for Fake {
        fn read(&self, t: &str) -> Result<Option<String>> {
            Ok(self.values.borrow().get(t).cloned())
        }
        fn write(&self, t: &str, k: &str) -> Result<()> {
            if self.fail {
                return Err("Synthetic credential failure".into());
            }
            self.values.borrow_mut().insert(t.into(), k.into());
            Ok(())
        }
        fn delete(&self, t: &str) -> Result<()> {
            self.values.borrow_mut().remove(t);
            Ok(())
        }
    }
    fn input(revision: i64, action: &str) -> Input {
        Input {
            provider: "openai".into(),
            revision,
            enabled: true,
            model: "synthetic-model".into(),
            key_action: action.into(),
            key: if action == "replace" {
                Some("synthetic-key-only".into())
            } else {
                None
            },
        }
    }
    #[test]
    fn provider_settings_default_off_mask_keys_and_isolate_workspaces() {
        let dir = tempfile::tempdir().unwrap();
        let vault = Fake::default();
        let empty = view(dir.path(), "personal", "openai", &vault).unwrap();
        assert!(!empty.config.enabled);
        assert!(!empty.has_key);
        assert_eq!(empty.config.model, "");
        let claude = view(dir.path(), "personal", "claude", &vault).unwrap();
        assert_eq!(claude.config.model, DEFAULT_CLAUDE_MODEL);
        assert!(!claude.config.enabled);
        assert!(!claude.has_key);
        assert!(save(dir.path(), "personal", input(0, "keep"), &vault).is_err());
        let saved = save(dir.path(), "personal", input(0, "replace"), &vault).unwrap();
        assert!(saved.has_key);
        assert!(saved.config.enabled);
        assert!(!serde_json::to_string(&saved)
            .unwrap()
            .contains("synthetic-key"));
        assert!(
            !fs::read_to_string(path(dir.path(), "personal", "openai").unwrap())
                .unwrap()
                .contains("synthetic-key")
        );
        assert!(!view(dir.path(), "demo", "openai", &vault).unwrap().has_key);
        assert!(save(dir.path(), "personal", input(0, "keep"), &vault).is_err());
        let removed = save(dir.path(), "personal", input(1, "remove"), &vault).unwrap();
        assert!(!removed.has_key);
        assert!(!removed.config.enabled);
        assert!(view(dir.path(), "../", "openai", &vault).is_err());
        assert!(view(dir.path(), "personal", "https://elsewhere", &vault).is_err());
    }
    #[test]
    fn interrupted_key_change_leaves_disabled_config_and_requires_fresh_revision() {
        let dir = tempfile::tempdir().unwrap();
        let vault = Fake {
            fail: true,
            ..Default::default()
        };
        assert!(save(dir.path(), "personal", input(0, "replace"), &vault).is_err());
        let config = read(dir.path(), "personal", "openai").unwrap();
        assert!(!config.enabled);
        assert_eq!(config.revision, 1);
        assert!(save(
            dir.path(),
            "personal",
            input(0, "replace"),
            &Fake::default()
        )
        .is_err());
    }
}
