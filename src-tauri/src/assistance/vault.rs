use super::Result;
// Saved keys are native-only and are never returned to the WebView or audit records.
pub trait KeyStore {
    fn read(&self, target: &str) -> Result<Option<String>>;
    fn write(&self, target: &str, key: &str) -> Result<()>;
    fn delete(&self, target: &str) -> Result<()>;
}
pub struct WindowsVault;

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    #[test]
    #[ignore = "Writes and removes only a random synthetic Windows credential; run explicitly."]
    fn isolated_windows_credential_roundtrip() {
        let name = format!("com.jacob.personal-finance/qa/{}", uuid::Uuid::new_v4());
        struct Cleanup(String);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = WindowsVault.delete(&self.0);
            }
        }
        let _cleanup = Cleanup(name.clone());
        assert!(WindowsVault.read(&name).unwrap().is_none());
        WindowsVault
            .write(&name, "synthetic-not-a-provider-key")
            .unwrap();
        assert_eq!(
            WindowsVault.read(&name).unwrap().as_deref(),
            Some("synthetic-not-a-provider-key")
        );
        WindowsVault.write(&name, "synthetic-replaced-key").unwrap();
        assert_eq!(
            WindowsVault.read(&name).unwrap().as_deref(),
            Some("synthetic-replaced-key")
        );
        WindowsVault.delete(&name).unwrap();
        assert!(WindowsVault.read(&name).unwrap().is_none());
    }
}
#[cfg(windows)]
impl KeyStore for WindowsVault {
    fn read(&self, target: &str) -> Result<Option<String>> {
        use windows::{
            core::PCWSTR,
            Win32::{Foundation::ERROR_NOT_FOUND, Security::Credentials::*},
        };
        let name: Vec<u16> = target.encode_utf16().chain(Some(0)).collect();
        let mut credential = std::ptr::null_mut();
        // All Win32 pointers live through the call; Credential Manager owns the returned allocation.
        unsafe {
            if let Err(e) = CredReadW(
                PCWSTR(name.as_ptr()),
                CRED_TYPE_GENERIC,
                None,
                &mut credential,
            ) {
                if e.code() == windows::core::HRESULT::from_win32(ERROR_NOT_FOUND.0) {
                    return Ok(None);
                }
                return Err("Windows Credential Manager is unavailable for this sign-in.".into());
            }
            if credential.is_null() {
                return Err("Windows returned no credential.".into());
            }
            let value = &*credential;
            let result = if value.CredentialBlobSize > 2560 || value.CredentialBlob.is_null() {
                Err(
                    "Stored Windows credential is invalid. Replace it in this feature's settings."
                        .into(),
                )
            } else {
                String::from_utf8(
                    std::slice::from_raw_parts(
                        value.CredentialBlob,
                        value.CredentialBlobSize as usize,
                    )
                    .to_vec(),
                )
                .map(Some)
                .map_err(|_| "Stored Windows credential is invalid.".into())
            };
            CredFree(credential.cast());
            result
        }
    }
    fn write(&self, target: &str, key: &str) -> Result<()> {
        use windows::{core::PWSTR, Win32::Security::Credentials::*};
        let mut name: Vec<u16> = target.encode_utf16().chain(Some(0)).collect();
        let label = if target.contains("/backups/") {
            "Personal Finance backup"
        } else {
            "Personal Finance API"
        };
        let mut user: Vec<u16> = label.encode_utf16().chain(Some(0)).collect();
        let mut bytes = key.as_bytes().to_vec();
        let value = CREDENTIALW {
            Type: CRED_TYPE_GENERIC,
            TargetName: PWSTR(name.as_mut_ptr()),
            UserName: PWSTR(user.as_mut_ptr()),
            CredentialBlobSize: bytes.len() as u32,
            CredentialBlob: bytes.as_mut_ptr(),
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            ..Default::default()
        };
        unsafe {
            CredWriteW(&value, 0)
                .map_err(|_| "Windows could not save the provider credential.".into())
        }
    }
    fn delete(&self, target: &str) -> Result<()> {
        use windows::{
            core::PCWSTR,
            Win32::{Foundation::ERROR_NOT_FOUND, Security::Credentials::*},
        };
        let name: Vec<u16> = target.encode_utf16().chain(Some(0)).collect();
        unsafe {
            match CredDeleteW(PCWSTR(name.as_ptr()), CRED_TYPE_GENERIC, None) {
                Ok(()) => Ok(()),
                Err(e) if e.code() == windows::core::HRESULT::from_win32(ERROR_NOT_FOUND.0) => {
                    Ok(())
                }
                Err(_) => Err("Windows could not remove the provider credential.".into()),
            }
        }
    }
}
#[cfg(not(windows))]
impl KeyStore for WindowsVault {
    fn read(&self, _: &str) -> Result<Option<String>> {
        Err("Provider keys require Windows Credential Manager.".into())
    }
    fn write(&self, _: &str, _: &str) -> Result<()> {
        Err("Provider keys require Windows Credential Manager.".into())
    }
    fn delete(&self, _: &str) -> Result<()> {
        Err("Provider keys require Windows Credential Manager.".into())
    }
}
