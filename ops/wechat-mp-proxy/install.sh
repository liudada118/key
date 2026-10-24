#!/usr/bin/env bash
set -euo pipefail
umask 077

fail() { printf '%s\n' "$1" >&2; exit 1; }
[ "$(id -u)" = 0 ] || fail 'Run as root on the intended Linux server.'
[ "$#" = 2 ] || fail 'Usage: bash install.sh CERTIFICATE_CHAIN_PATH PRIVATE_KEY_PATH'
SOURCE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
cd "$SOURCE"
for command in node openssl systemctl systemd-analyze ss htpasswd useradd getent runuser install nologin; do
  command -v "$command" >/dev/null || fail "Missing prerequisite: $command"
done
test -d /run/systemd/system || fail 'A running systemd host is required.'
SYSTEMD_VERSION=$(systemctl --version | sed -n '1s/^systemd \([0-9]*\).*/\1/p')
[[ "$SYSTEMD_VERSION" =~ ^[0-9]+$ ]] && [ "$SYSTEMD_VERSION" -ge 239 ] || fail 'systemd 239+ required for the service resource and sandbox settings.'
node -e 'if(Number(process.versions.node.split(".")[0])<22) process.exit(1)' || fail 'Node.js 22+ required.'
test -f "$1" && test -r "$2" || fail 'Existing certificate chain and private key required.'
test ! -e /etc/wechat-mp-proxy && test ! -L /etc/wechat-mp-proxy || fail 'Existing proxy installation found; do not overwrite it.'
for unit in wechat-mp-squid wechat-mp-tls; do
  test -z "$(systemctl show "$unit.service" --property=FragmentPath --value)" || fail 'Existing proxy service found; manual upgrade required.'
done

readarray -t SETTINGS < <(node --input-type=module -e '
import fs from "node:fs";
const c=JSON.parse(fs.readFileSync("config.json","utf8"));
for(const k of ["hostname","tlsPort","localPort","squidBinary","stunnelBinary","authHelper"]) console.log(c[k]);
')
[ "${#SETTINGS[@]}" = 6 ] || fail 'Invalid generated config.json.'
HOSTNAME=${SETTINGS[0]}; TLS_PORT=${SETTINGS[1]}; LOCAL_PORT=${SETTINGS[2]}
SQUID=${SETTINGS[3]}; STUNNEL=${SETTINGS[4]}; AUTH_HELPER=${SETTINGS[5]}
for binary in "$SQUID" "$STUNNEL" "$AUTH_HELPER"; do test -x "$binary" || fail 'Configured executable is missing.'; done
for port in "$TLS_PORT" "$LOCAL_PORT"; do
  LISTENERS=$(ss -H -ltn "sport = :$port") || fail 'Unable to inspect listening ports.'
  [ -z "$LISTENERS" ] || fail "Port $port is already in use; do not stop another service."
done
openssl verify -verify_hostname "$HOSTNAME" -purpose sslserver -untrusted "$1" "$1" >/dev/null || fail 'Certificate chain or proxy hostname validation failed.'
openssl x509 -in "$1" -noout -checkend 604800 >/dev/null || fail 'Certificate expires within seven days.'
CERT_HASH=$(openssl x509 -in "$1" -pubkey -noout | openssl pkey -pubin -outform DER | openssl dgst -sha256)
KEY_HASH=$(openssl pkey -in "$2" -passin pass: -pubout -outform DER 2>/dev/null | openssl dgst -sha256)
[ "$CERT_HASH" = "$KEY_HASH" ] || fail 'Certificate and private key do not match.'
"$SQUID" -v 2>&1 | grep -Eq 'Version [4-7]\.' || fail 'Use a distribution-supported Squid 4-7 release with security updates.'

# Dedicated users and files, never the distro squid.conf, nginx, PM2, or application .env.
for user in wechat-mp-squid wechat-mp-tls; do
  if getent passwd "$user" >/dev/null; then fail "User $user already exists; inspect before reusing."; fi
  if getent group "$user" >/dev/null; then fail "Group $user already exists; inspect before reusing."; fi
done
NOLOGIN=$(command -v nologin)
useradd --system --user-group --no-create-home --shell "$NOLOGIN" wechat-mp-squid
useradd --system --user-group --no-create-home --shell "$NOLOGIN" wechat-mp-tls
install -d -o root -g root -m 755 /etc/wechat-mp-proxy
install -d -o root -g wechat-mp-squid -m 750 /etc/wechat-mp-proxy/auth
install -d -o root -g wechat-mp-tls -m 750 /etc/wechat-mp-proxy/tls
install -o root -g root -m 644 squid.conf stunnel.conf config.json /etc/wechat-mp-proxy/
if ! "$SQUID" -v 2>&1 | grep -q -- '--enable-icmp'; then
  sed -i -e '/^pinger_enable off$/d' -e '/^netdb_filename none$/d' /etc/wechat-mp-proxy/squid.conf
fi
install -o root -g root -m 644 "$1" /etc/wechat-mp-proxy/tls/fullchain.pem
install -o root -g wechat-mp-tls -m 640 "$2" /etc/wechat-mp-proxy/tls/privkey.pem
PASSWORD=$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))')
printf '%s\n' "$PASSWORD" | htpasswd -i -c -B -C 10 /etc/wechat-mp-proxy/auth/passwd mp_crm
printf 'WECHAT_MP_PROXY_URL=https://mp_crm:%s@%s:%s\n' "$PASSWORD" "$HOSTNAME" "$TLS_PORT" > /etc/wechat-mp-proxy/crm.env
chmod 600 /etc/wechat-mp-proxy/crm.env
unset PASSWORD
chown root:wechat-mp-squid /etc/wechat-mp-proxy/auth/passwd
chmod 640 /etc/wechat-mp-proxy/auth/passwd
runuser -u wechat-mp-squid -- "$SQUID" -k parse -f /etc/wechat-mp-proxy/squid.conf

install -o root -g root -m 644 wechat-mp-squid.service wechat-mp-tls.service /etc/systemd/system/
systemd-analyze verify /etc/systemd/system/wechat-mp-squid.service /etc/systemd/system/wechat-mp-tls.service
systemctl daemon-reload
# Starting is separate from enabling: an invalid TLS service must not persist across boot.
if ! systemctl start wechat-mp-tls.service; then
  systemctl stop wechat-mp-tls.service wechat-mp-squid.service
  fail 'Proxy startup failed. Inspect its dedicated units; existing services were not changed.'
fi
sleep 2
if ! systemctl is-active --quiet wechat-mp-squid.service || ! systemctl is-active --quiet wechat-mp-tls.service; then
  systemctl stop wechat-mp-tls.service wechat-mp-squid.service
  fail 'Proxy did not stay active; not enabled at boot.'
fi
systemctl enable wechat-mp-squid.service wechat-mp-tls.service
printf '%s\n' "Started https://$HOSTNAME:$TLS_PORT. This is NOT proof of WeChat whitelist or fixed egress."
printf '%s\n' 'The CRM credential is in root-only /etc/wechat-mp-proxy/crm.env; transfer it through a protected secret channel, never a chat or screenshot.'
printf '%s\n' 'Next: verify TLS and all ACL tests, allow only the TLS port in the cloud firewall, then update the CRM dedicated proxy setting.'
