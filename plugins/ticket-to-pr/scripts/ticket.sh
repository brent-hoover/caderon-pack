#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
usage: ticket.sh <command> <source> <ref> [args]
  commands: show | comment
  sources:  github | jig
  show:     ticket.sh show <source> <ref>
  comment:  ticket.sh comment <source> <ref>   (body read from stdin)
EOF
  exit 2
}

main() {
  [ "$#" -ge 3 ] || usage
  local cmd="$1" src="$2" ref="$3"
  case "$src" in
    github|jig) ;;
    *) echo "unknown source: $src" >&2; exit 2 ;;
  esac
  case "$cmd" in
    show)    "show_${src}" "$ref" ;;
    comment) "comment_${src}" "$ref" ;;
    *) echo "unknown command: $cmd" >&2; usage ;;
  esac
}

main "$@"
