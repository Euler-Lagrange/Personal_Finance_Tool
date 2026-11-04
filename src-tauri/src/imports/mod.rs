pub mod parse;
pub mod pdf;
pub mod types;
#[cfg(windows)]
mod windows_ocr;
pub const MAX_FILE_BYTES: usize = 10 * 1024 * 1024;
pub const MAX_ROWS: usize = 5000;
pub type Result<T> = std::result::Result<T, String>;

pub mod pdf_table;
