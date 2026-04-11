//! Shielded CPI Instructions for The White Protocol Privacy Pool v2
//!
//! Cross-program invocation interface for DeFi integrations.
//! Allows external protocols to interact with shielded balances.

pub mod execute_action;

pub use execute_action::ExecuteShieldedAction;
