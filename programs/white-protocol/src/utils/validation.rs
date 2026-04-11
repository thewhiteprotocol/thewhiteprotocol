//! Input validation utilities for The White Protocol v2

use crate::error::WhiteProtocolError;
use anchor_lang::prelude::*;

/// Maximum length for metadata URIs (IPFS hash + prefix)
pub const MAX_METADATA_URI_LEN: usize = 200;

/// Maximum length for relayer names
pub const MAX_RELAYER_NAME_LEN: usize = 64;

/// Maximum length for pool names/descriptions
pub const MAX_POOL_NAME_LEN: usize = 64;

/// Validate metadata URI
pub fn validate_metadata_uri(uri: &str) -> Result<()> {
    if uri.is_empty() {
        msg!("Metadata URI cannot be empty");
        return Err(error!(WhiteProtocolError::InvalidMetadata));
    }

    if uri.len() > MAX_METADATA_URI_LEN {
        msg!(
            "Metadata URI too long: {} > {}",
            uri.len(),
            MAX_METADATA_URI_LEN
        );
        return Err(error!(WhiteProtocolError::InvalidMetadata));
    }

    if uri.contains('\0') {
        msg!("Metadata URI contains null bytes");
        return Err(error!(WhiteProtocolError::InvalidMetadata));
    }

    if uri
        .chars()
        .any(|c| c.is_control() && c != '\n' && c != '\r' && c != '\t')
    {
        msg!("Metadata URI contains invalid control characters");
        return Err(error!(WhiteProtocolError::InvalidMetadata));
    }

    if !uri.starts_with("https://")
        && !uri.starts_with("http://")
        && !uri.starts_with("ipfs://")
        && !uri.starts_with("ar://")
    {
        msg!("Metadata URI must start with https://, http://, ipfs://, or ar://");
        return Err(error!(WhiteProtocolError::InvalidMetadata));
    }

    Ok(())
}

/// Validate relayer name
pub fn validate_relayer_name(name: &str) -> Result<()> {
    if name.is_empty() {
        msg!("Relayer name cannot be empty");
        return Err(error!(WhiteProtocolError::InvalidInput));
    }

    if name.len() > MAX_RELAYER_NAME_LEN {
        msg!(
            "Relayer name too long: {} > {}",
            name.len(),
            MAX_RELAYER_NAME_LEN
        );
        return Err(error!(WhiteProtocolError::InvalidInput));
    }

    if name.contains('\0') {
        msg!("Relayer name contains null bytes");
        return Err(error!(WhiteProtocolError::InvalidInput));
    }

    if !name
        .chars()
        .all(|c| c.is_alphanumeric() || c == '-' || c == '_' || c == ' ')
    {
        msg!("Relayer name contains invalid characters");
        return Err(error!(WhiteProtocolError::InvalidInput));
    }

    Ok(())
}

/// Validate pool name/description
pub fn validate_pool_name(name: &str) -> Result<()> {
    if name.is_empty() {
        msg!("Pool name cannot be empty");
        return Err(error!(WhiteProtocolError::InvalidInput));
    }

    if name.len() > MAX_POOL_NAME_LEN {
        msg!("Pool name too long: {} > {}", name.len(), MAX_POOL_NAME_LEN);
        return Err(error!(WhiteProtocolError::InvalidInput));
    }

    if name.contains('\0') {
        msg!("Pool name contains null bytes");
        return Err(error!(WhiteProtocolError::InvalidInput));
    }

    Ok(())
}

/// Validate generic string input
pub fn validate_string_input(input: &str, max_len: usize, field_name: &str) -> Result<()> {
    if input.len() > max_len {
        msg!("{} too long: {} > {}", field_name, input.len(), max_len);
        return Err(error!(WhiteProtocolError::InvalidInput));
    }

    if input.contains('\0') {
        msg!("{} contains null bytes", field_name);
        return Err(error!(WhiteProtocolError::InvalidInput));
    }

    Ok(())
}
