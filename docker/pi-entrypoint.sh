#!/usr/bin/env sh
# Official @mariozechner/pi-coding-agent exposes `pi`, not `pi run`. smoldoc standardizes on `pi run …`
# so orchestration prompts can spawn children the same way. Strip a leading `run` subcommand.
set -e
if [ "${1:-}" = "run" ]; then
  shift
fi
exec /opt/pi-wrapped/pi-real "$@"
