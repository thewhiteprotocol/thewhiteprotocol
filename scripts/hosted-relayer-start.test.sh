#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
SCRIPT="$ROOT/scripts/hosted-relayer-start.sh"
TMP_PREFIX="/tmp/pr012r-test-$$-"

cleanup() {
  rm -rf "${TMP_PREFIX}"*
}
trap cleanup EXIT

make_fixture() {
  local dir
  dir="$(mktemp -d "${TMP_PREFIX}XXXXXX")"
  mkdir -p "$dir/bin" "$dir/chains/solana" "$dir/relayer"
  cat >"$dir/bin/git" <<'SH'
#!/usr/bin/env bash
if [ "$1" = "rev-parse" ] && [ "$2" = "--show-toplevel" ]; then
  pwd
elif [ "$1" = "-C" ]; then
  echo testcommit
else
  exit 1
fi
SH
  chmod +x "$dir/bin/git"
  cat >"$dir/bin/npm" <<'SH'
#!/usr/bin/env bash
cmd="$*"
case "$cmd" in
  "run bridge:bootstrap:zkeys")
    if [ "${BOOTSTRAP_FAIL:-false}" = "true" ]; then
      echo '{"ok":false,"secretsPrinted":false}'
      exit 1
    fi
    echo '{"ok":true,"secretsPrinted":false}'
    ;;
  "run bridge:operator:prereq")
    if [ "${PREREQ_FAIL:-false}" = "true" ]; then
      echo '{"ok":false,"secretsPrinted":false}'
      exit 1
    fi
    echo '{"ok":true,"secretsPrinted":false}'
    ;;
  "run bridge:operator:status")
    echo '{"ok":true,"secretsPrinted":false}'
    ;;
  "run relayer:start")
    echo relayer-started
    ;;
  *)
    echo "unexpected npm command: $cmd" >&2
    exit 9
    ;;
esac
SH
  chmod +x "$dir/bin/npm"
  printf '%s' "$dir"
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  if [[ "$haystack" != *"$needle"* ]]; then
    echo "expected output to contain: $needle" >&2
    echo "$haystack" >&2
    exit 1
  fi
}

assert_not_contains() {
  local haystack="$1"
  local needle="$2"
  if [[ "$haystack" == *"$needle"* ]]; then
    echo "expected output not to contain: $needle" >&2
    echo "$haystack" >&2
    exit 1
  fi
}

run_case() {
  local dir="$1"
  shift
  (cd "$dir" && PATH="$dir/bin:$PATH" "$@" "$SCRIPT" 2>&1)
}

fixture="$(make_fixture)"
out="$(run_case "$fixture" env BRIDGE_HOSTED_STARTUP_BOOTSTRAP=false BRIDGE_RELAYER_START_COMMAND='npm run relayer:start' bash)"
assert_contains "$out" "hosted_bootstrap_disabled"
assert_contains "$out" "relayer-started"

fixture="$(make_fixture)"
set +e
out="$(run_case "$fixture" env BRIDGE_HOSTED_STARTUP_BOOTSTRAP=true BRIDGE_HOSTED_REQUIRE_ZKEYS=true BOOTSTRAP_FAIL=true BRIDGE_RELAYER_START_COMMAND='npm run relayer:start' bash)"
code=$?
set -e
[ "$code" -ne 0 ]
assert_contains "$out" "zkey_bootstrap_failed"
assert_not_contains "$out" "relayer-started"

fixture="$(make_fixture)"
out="$(run_case "$fixture" env BRIDGE_HOSTED_STARTUP_BOOTSTRAP=true BRIDGE_HOSTED_REQUIRE_ZKEYS=true BRIDGE_RELAYER_START_COMMAND='npm run relayer:start' bash)"
assert_contains "$out" "startup_checks_passed"
assert_contains "$out" "relayer-started"

fixture="$(make_fixture)"
set +e
out="$(run_case "$fixture" env BRIDGE_HOSTED_STARTUP_BOOTSTRAP=true BRIDGE_HOSTED_REQUIRE_ZKEYS=true BOOTSTRAP_FAIL=true BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=true BRIDGE_RELAYER_START_COMMAND='npm run relayer:start' bash)"
code=$?
set -e
[ "$code" -ne 0 ]
assert_contains "$out" "live_submit_startup_guard"
assert_not_contains "$out" "relayer-started"

fixture="$(make_fixture)"
out="$(run_case "$fixture" env BRIDGE_HOSTED_STARTUP_BOOTSTRAP=true BRIDGE_HOSTED_REQUIRE_ZKEYS=true BOOTSTRAP_FAIL=true BRIDGE_HOSTED_FAIL_CLOSED=false BRIDGE_RELAYER_START_COMMAND='npm run relayer:start' bash)"
assert_contains "$out" "starting_with_daemon_disabled"
assert_contains "$out" "relayer-started"

fixture="$(make_fixture)"
set +e
out="$(run_case "$fixture" env BRIDGE_HOSTED_STARTUP_BOOTSTRAP=true BRIDGE_HOSTED_REQUIRE_ZKEYS=true BRIDGE_HOSTED_REQUIRE_OPERATOR_PREREQ=true PREREQ_FAIL=true BRIDGE_RELAYER_START_COMMAND='npm run relayer:start' bash)"
code=$?
set -e
[ "$code" -ne 0 ]
assert_contains "$out" "operator_prereq_failed"
assert_not_contains "$out" "relayer-started"

assert_not_contains "$out" "destSecret"
assert_not_contains "$out" "destNullifier"
assert_not_contains "$out" "privateKey"
assert_not_contains "$out" "witness"

grep -q 'scripts/hosted-relayer-start.sh' "$ROOT/render.yaml"

echo '{"ok":true,"status":"hosted_relayer_start_tests_passed"}'
