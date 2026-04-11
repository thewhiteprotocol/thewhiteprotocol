//! Compliance Instructions for The White Protocol Privacy Pool v2
//!
//! Compliance layer for regulatory requirements:
//! - Configure compliance settings
//! - Attach encrypted audit metadata to commitments

pub mod attach_metadata;
pub mod configure_compliance;

pub use attach_metadata::AttachAuditMetadata;
pub use configure_compliance::ConfigureCompliance;
