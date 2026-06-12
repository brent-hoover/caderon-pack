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

show_github()    { gh issue view "$1" --json title,body,comments; }
comment_github() { gh issue comment "$1" --body-file -; }
show_jig()       { jig issue show "$1"; }
comment_jig()    { jig issue comment "$1" --body-file -; }

main() {
  [ "$#" -ge 3 ] || usage
  local cmd="$1" src="$2" ref="$3"
  case "$src" in
    github) [[ "$ref" =~ ^[0-9]+$ ]] \
              || { echo "invalid github ref: $ref (expected an issue number)" >&2; exit 2; } ;;
    jig)    [[ "$ref" =~ ^jig-[0-9]+$ || "$ref" =~ ^[0-9a-fA-F-]{8,}$ ]] \
              || { echo "invalid jig ref: $ref (expected jig-N or a UUID)" >&2; exit 2; } ;;
    *)      echo "unknown source: $src" >&2; exit 2 ;;
  esac
  case "$cmd" in
    show)    "show_${src}" "$ref" ;;
    comment) "comment_${src}" "$ref" ;;
    *) echo "unknown command: $cmd" >&2; usage ;;
  esac
}

main "$@"
