#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

json_bool() {
  case "${1:-}" in
    true|1|yes) printf 'true' ;;
    *) printf 'false' ;;
  esac
}

json_escape() {
  local value="${1:-}"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/ }"
  printf '%s' "$value"
}

repo_root() {
  git rev-parse --show-toplevel 2>/dev/null || pwd
}

run_cmd() {
  local label="$1"
  shift
  "$@" >/tmp/white-bridge-hosted-startup-"$label".json
}

print_summary() {
  local status="$1"
  local detail="${2:-}"
  local root="${REPO_ROOT:-$(repo_root)}"
  local commit
  commit="$(git -C "$root" rev-parse --short HEAD 2>/dev/null || printf 'unknown')"
  BRIDGE_HOSTED_STARTUP_OK="$status" \
    BRIDGE_HOSTED_STARTUP_DETAIL="$detail" \
    BRIDGE_HOSTED_STARTUP_GIT_COMMIT="$commit" \
    node "$SCRIPT_DIR/write-hosted-startup-status.js" >/dev/null 2>&1 || true
  printf '{\n'
  printf '  "ok": %s,\n' "$(json_bool "$status")"
  printf '  "repoCommit": "%s",\n' "$(json_escape "$commit")"
  printf '  "hostedBootstrapEnabled": %s,\n' "$(json_bool "${BRIDGE_HOSTED_STARTUP_BOOTSTRAP:-false}")"
  printf '  "requireZkeys": %s,\n' "$(json_bool "${BRIDGE_HOSTED_REQUIRE_ZKEYS:-false}")"
  printf '  "requireOperatorPrereq": %s,\n' "$(json_bool "${BRIDGE_HOSTED_REQUIRE_OPERATOR_PREREQ:-false}")"
  printf '  "failClosed": %s,\n' "$(json_bool "${BRIDGE_HOSTED_FAIL_CLOSED:-true}")"
  printf '  "daemonMode": "%s",\n' "$(json_escape "${BRIDGE_DAEMON_MODE:-}")"
  printf '  "liveSubmitEnabled": %s,\n' "$(json_bool "${BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT:-false}")"
  printf '  "relayerStartCommand": "%s",\n' "$(json_escape "${BRIDGE_RELAYER_START_COMMAND:-npm run relayer:start}")"
  printf '  "detail": "%s",\n' "$(json_escape "$detail")"
  printf '  "transactionsSubmitted": false,\n'
  printf '  "proofsGenerated": false,\n'
  printf '  "secretsPrinted": false\n'
  printf '}\n'
}

start_relayer() {
  local root="${REPO_ROOT:-$(repo_root)}"
  local command="${BRIDGE_RELAYER_START_COMMAND:-npm run relayer:start}"
  cd "$root"
  exec bash -c "$command"
}

fail_or_safe_start() {
  local detail="$1"
  if [ "${BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT:-false}" = "true" ]; then
    print_summary false "$detail; live_submit_startup_guard"
    exit 1
  fi
  if [ "${BRIDGE_HOSTED_FAIL_CLOSED:-true}" = "true" ]; then
    print_summary false "$detail"
    exit 1
  fi
  export BRIDGE_DAEMON_MODE=disabled
  export BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false
  print_summary true "$detail; starting_with_daemon_disabled"
  start_relayer
}

main() {
  REPO_ROOT="$(repo_root)"
  export REPO_ROOT
  cd "$REPO_ROOT"
  rm -f /tmp/white-bridge-hosted-startup-zkeys.json /tmp/white-bridge-hosted-startup-prereq.json /tmp/white-bridge-hosted-startup-status.json

  if [ "${BRIDGE_HOSTED_STARTUP_BOOTSTRAP:-false}" != "true" ]; then
    print_summary true "hosted_bootstrap_disabled"
    start_relayer
  fi

  if [ "${BRIDGE_HOSTED_REQUIRE_ZKEYS:-true}" = "true" ]; then
    if ! run_cmd zkeys bash -c 'cd "$REPO_ROOT/chains/solana" && npm --silent run bridge:bootstrap:zkeys'; then
      fail_or_safe_start "zkey_bootstrap_failed"
    fi
  fi

  if [ "${BRIDGE_HOSTED_REQUIRE_OPERATOR_PREREQ:-false}" = "true" ]; then
    if ! run_cmd prereq bash -c 'cd "$REPO_ROOT/chains/solana" && npm --silent run bridge:operator:prereq'; then
      fail_or_safe_start "operator_prereq_failed"
    fi
  elif [ -n "${PR012B_DESTINATION_MESSAGE_HASH:-${BRIDGE_DESTINATION_MESSAGE_HASH:-}}" ]; then
    run_cmd status bash -c 'cd "$REPO_ROOT/chains/solana" && npm --silent run bridge:operator:status' || true
  fi

  print_summary true "startup_checks_passed"
  start_relayer
}

main "$@"
