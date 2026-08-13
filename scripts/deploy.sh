#!/usr/bin/env bash
# Copy the integration into a Home Assistant config directory for testing.
#
#   HA_CONFIG=/path/to/homeassistant ./scripts/deploy.sh
#
# Restart Home Assistant after the first copy; frontend-only changes just need a hard refresh.
set -euo pipefail
HA_CONFIG="${HA_CONFIG:-}"
if [ -z "$HA_CONFIG" ]; then
  echo "Set HA_CONFIG to your Home Assistant config directory, e.g." >&2
  echo "  HA_CONFIG=~/homeassistant ./scripts/deploy.sh" >&2
  exit 1
fi
[ -d "$HA_CONFIG" ] || { echo "No such directory: $HA_CONFIG" >&2; exit 1; }
mkdir -p "$HA_CONFIG/custom_components"
rsync -a --delete --exclude='__pycache__' \
  "$(dirname "$0")/../custom_components/casa_dashboard" "$HA_CONFIG/custom_components/"
echo "Deployed to $HA_CONFIG/custom_components/casa_dashboard"
