#!/usr/bin/env bats

setup() {
  SCRIPT="${BATS_TEST_DIRNAME}/ticket.sh"
}

@test "no args prints usage and exits non-zero" {
  run bash "$SCRIPT"
  [ "$status" -ne 0 ]
  [[ "$output" == *"usage:"* ]]
}

@test "unknown source exits non-zero" {
  run bash "$SCRIPT" show bitbucket 123
  [ "$status" -ne 0 ]
  [[ "$output" == *"unknown source"* ]]
}

@test "show github calls gh issue view with json fields" {
  stubdir="$(mktemp -d)"
  cat >"$stubdir/gh" <<'STUB'
#!/usr/bin/env bash
echo "gh $*" >>"$STUB_LOG"
echo '{"title":"T","body":"B","comments":[]}'
STUB
  chmod +x "$stubdir/gh"
  run env STUB_LOG="$stubdir/log" PATH="$stubdir:$PATH" bash "$SCRIPT" show github 42
  [ "$status" -eq 0 ]
  [[ "$output" == *'"title":"T"'* ]]
  grep -q 'gh issue view 42 --json title,body,comments' "$stubdir/log"
}

@test "comment jig pipes stdin to --body-file -" {
  stubdir="$(mktemp -d)"
  cat >"$stubdir/jig" <<'STUB'
#!/usr/bin/env bash
echo "jig $*" >>"$STUB_LOG"
cat >"$STUB_LOG.body"
STUB
  chmod +x "$stubdir/jig"
  run env STUB_LOG="$stubdir/log" PATH="$stubdir:$PATH" bash -c "echo 'hello clarif' | bash '$SCRIPT' comment jig jig-7"
  [ "$status" -eq 0 ]
  grep -q 'jig issue comment jig-7 --body-file -' "$stubdir/log"
  grep -q 'hello clarif' "$stubdir/log.body"
}
