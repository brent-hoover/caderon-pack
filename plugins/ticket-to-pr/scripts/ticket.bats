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
