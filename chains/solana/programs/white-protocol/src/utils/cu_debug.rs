/// Log a label + current compute units (when cu-debug is enabled).
/// On non-BPF builds, it only prints the label.
#[cfg(feature = "cu-debug")]
#[inline(always)]
pub fn cu(label: &str) {
    msg!(label);
}

#[cfg(feature = "cu-debug")]
#[cfg(any(target_os = "solana", target_arch = "bpf"))]
extern "C" {
    fn sol_log_compute_units_();
}

/// No-op when cu-debug is disabled.
#[cfg(not(feature = "cu-debug"))]
#[inline(always)]
pub fn cu(_label: &str) {}
