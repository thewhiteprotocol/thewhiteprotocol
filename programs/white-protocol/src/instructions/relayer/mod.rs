//! Relayer Instructions for The White Protocol Privacy Pool v2
//!
//! On-chain relayer registry management including:
//! - Registry configuration
//! - Relayer registration
//! - Relayer updates
//! - Relayer deactivation

pub mod configure_registry;
pub mod deactivate_relayer;
pub mod register_relayer;
pub mod update_relayer;

pub use configure_registry::ConfigureRelayerRegistry;
pub use deactivate_relayer::DeactivateRelayer;
pub use register_relayer::RegisterRelayer;
pub use update_relayer::UpdateRelayer;
