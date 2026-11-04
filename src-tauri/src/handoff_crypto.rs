//! age owns the cryptographic format and authenticated encryption. App payload is bounded.
use crate::Result;
use age::secrecy::SecretString;
use std::io::{Read, Write};
use zeroize::Zeroizing;
pub const MAX_DATABASE: usize = 256 * 1024 * 1024;
pub const MAX_ARCHIVE: usize = MAX_DATABASE + 2 * 1024 * 1024;
const WORK: u8 = 18;
pub fn password(s: String) -> Result<SecretString> {
    let s = Zeroizing::new(s);
    if s.chars().count() < 12 || s.len() > 1024 || s.trim() != s.as_str() {
        return Err("Use a passphrase of at least 12 characters (up to 1,024 bytes), without leading or trailing spaces.".into());
    }
    Ok(SecretString::from(s.to_string()))
}
pub fn encrypt(plaintext: &[u8], passphrase: SecretString) -> Result<Vec<u8>> {
    encrypt_at(plaintext, passphrase, if cfg!(test) { 10 } else { WORK })
}
fn encrypt_at(plaintext: &[u8], passphrase: SecretString, work: u8) -> Result<Vec<u8>> {
    if plaintext.len() > MAX_DATABASE + 65536 {
        return Err("Workspace exceeds the 256 MB portable snapshot limit.".into());
    }
    let mut recipient = age::scrypt::Recipient::new(passphrase);
    recipient.set_work_factor(work);
    let encryptor =
        age::Encryptor::with_recipients(std::iter::once(&recipient as &dyn age::Recipient))
            .map_err(|_| "Encryption could not start.")?;
    let mut out = vec![];
    let mut writer = encryptor
        .wrap_output(&mut out)
        .map_err(|_| "Encryption could not start.")?;
    writer
        .write_all(plaintext)
        .map_err(|_| "Snapshot encryption failed.")?;
    writer
        .finish()
        .map_err(|_| "Snapshot encryption did not finish.")?;
    Ok(out)
}
pub fn decrypt(bytes: &[u8], passphrase: SecretString) -> Result<Zeroizing<Vec<u8>>> {
    if bytes.len() > MAX_ARCHIVE || bytes.len() < 100 {
        return Err("Choose a complete handoff file no larger than 258 MB.".into());
    }
    // Reject an unbounded recipient header before handing the input to the format parser.
    if !bytes[..bytes.len().min(8192)]
        .windows(5)
        .any(|v| v == b"\n--- ")
    {
        return Err("Unsupported or damaged handoff header.".into());
    }
    let decryptor = age::Decryptor::new(bytes)
        .map_err(|_| "This is not a supported encrypted handoff file.")?;
    let mut identity = age::scrypt::Identity::new(passphrase);
    identity.set_max_work_factor(WORK);
    let mut reader = decryptor
        .decrypt(std::iter::once(&identity as &dyn age::Identity))
        .map_err(|_| "Unable to unlock this file. Check the passphrase and file integrity.")?;
    let mut out = Zeroizing::new(vec![]);
    reader
        .by_ref()
        .take((MAX_DATABASE + 65537) as u64)
        .read_to_end(&mut out)
        .map_err(|_| "The encrypted file is incomplete or failed authentication.")?;
    if out.len() > MAX_DATABASE + 65536 {
        return Err("Decrypted handoff exceeds the supported size.".into());
    }
    Ok(out)
}
#[cfg(test)]
pub fn synthetic_encrypt(plaintext: &[u8]) -> Vec<u8> {
    encrypt_at(
        plaintext,
        password("synthetic testing passphrase".into()).unwrap(),
        10,
    )
    .unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn age_production_work_factor_authenticates_complete_stream_and_rejects_tampering() {
        let clear = b"Synthetic finance data only";
        let encrypted = encrypt_at(
            clear,
            password("synthetic example passphrase".into()).unwrap(),
            WORK,
        )
        .unwrap();
        assert!(!encrypted.windows(clear.len()).any(|w| w == clear));
        assert_eq!(
            decrypt(
                &encrypted,
                password("synthetic example passphrase".into()).unwrap()
            )
            .unwrap()
            .as_slice(),
            clear
        );
        for altered in [encrypted[..encrypted.len() - 1].to_vec(), {
            let mut b = encrypted.clone();
            let n = b.len() - 8;
            b[n] ^= 1;
            b
        }] {
            assert!(decrypt(
                &altered,
                password("synthetic example passphrase".into()).unwrap()
            )
            .is_err());
        }
        assert!(decrypt(
            &encrypted,
            password("different synthetic password".into()).unwrap()
        )
        .is_err());
    }
}
