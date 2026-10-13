#!/usr/bin/env bash
# One-time setup for the fork's release signing key (issue #1).
#
# Creates a PKCS12 keystore with a random password and stores it in this repo's Actions secrets
# (KEYSTORE_BASE64, KEYSTORE_PASSWORD, KEY_ALIAS, KEY_PASSWORD), which build.yml uses to sign every
# APK. Same key on every build = each APK installs over the previous one and keeps the app's data.
#
# Run it on your own machine, with a `gh` logged in as the repo owner and a JDK (for keytool):
#   scripts/setup-release-signing.sh [owner/repo]
#
# Then back up the two files it leaves behind (the keystore and its password), e.g. in a password
# manager, and delete them here. Losing them means the next APK can't update the installed app.
set -euo pipefail

repo="${1:-kjeldahl/opencode-mobile}"
ks="opencode-mobile-release.p12"
pw_file="$ks.password"
alias_name="release"

for tool in keytool gh openssl base64; do
  command -v "$tool" >/dev/null || { echo "missing: $tool" >&2; exit 1; }
done
[[ ! -e "$ks" && ! -e "$pw_file" ]] || { echo "$ks or $pw_file already exists; not overwriting" >&2; exit 1; }
if gh secret list -R "$repo" | grep -q '^KEYSTORE_BASE64'; then
  echo "$repo already has KEYSTORE_BASE64. Replacing it changes the signature: installed builds" >&2
  echo "would then have to be uninstalled once. Delete the secret first if you really want that." >&2
  exit 1
fi

pass="$(openssl rand -base64 30 | tr -d '/+=\n')"
umask 077
keytool -genkeypair -keystore "$ks" -storetype PKCS12 -storepass "$pass" -keypass "$pass" \
  -alias "$alias_name" -keyalg RSA -keysize 4096 -validity 10000 \
  -dname "CN=opencode-mobile ($repo)" >/dev/null
printf '%s\n' "$pass" > "$pw_file"

base64 < "$ks" | tr -d '\n' | gh secret set KEYSTORE_BASE64 -R "$repo"
printf '%s' "$pass" | gh secret set KEYSTORE_PASSWORD -R "$repo"
printf '%s' "$alias_name" | gh secret set KEY_ALIAS -R "$repo"
printf '%s' "$pass" | gh secret set KEY_PASSWORD -R "$repo"

echo
echo "Secrets set on $repo. Certificate fingerprint:"
keytool -list -keystore "$ks" -storepass "$pass" -alias "$alias_name" | grep -i 'SHA-256' || true
echo
echo "Now back up $ks and $pw_file (password manager), then delete them from this folder."
