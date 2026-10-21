#!/usr/bin/env bash
# Puts your Twilio Auth Token on the phone-line server and checks that it works.
# You type the token (hidden). It goes straight over SSH into the server's settings file, and is never printed,
# never put in a command line, and never saved on this computer.
set -euo pipefail

KEY="${KEY:-$HOME/.ssh/LightsailDefaultKey-us-east-2.pem}"
SERVER="${SERVER:-ubuntu@3.14.120.244}"

read -rsp "Twilio Auth Token (hidden): " TOKEN; echo
[ -n "$TOKEN" ] || { echo "No token entered."; exit 1; }

printf 'TWILIO_AUTH_TOKEN=%s\n' "$TOKEN" | ssh -i "$KEY" "$SERVER" '
  set -e
  NEW=$(cat)
  sudo sed -i "/^TWILIO_AUTH_TOKEN=/d" /etc/pantry-line.env
  printf "%s\n" "$NEW" | sudo tee -a /etc/pantry-line.env >/dev/null
  sudo chmod 600 /etc/pantry-line.env
  sudo systemctl restart pantry-line
  sleep 1
  echo "pantry-line service: $(systemctl is-active pantry-line)"'

echo "Token saved on the server. Checking the live webhook..."
TWILIO_AUTH_TOKEN="$TOKEN" python3 "$(dirname "$0")/check_webhook.py"
