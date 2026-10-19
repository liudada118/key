#!/usr/bin/env bash
set -eu

APP_ROOT=$1
DEPLOY_INPUT=$2
COMMIT=$3
DEPLOY_ROOT=$(dirname "$DEPLOY_INPUT")
MAINTENANCE=$DEPLOY_INPUT/scripts/deploy-maintenance.mjs
cd "$APP_ROOT"
exec 9>"$DEPLOY_ROOT/.deploy.lock"
flock -n 9 || { echo "Another deployment is running"; exit 1; }
node "$MAINTENANCE" record "$DEPLOY_ROOT" "$DEPLOY_INPUT" prepared

low_io() {
  if command -v ionice >/dev/null 2>&1; then
    ionice -c 2 -n 7 nice -n 10 "$@"
  else
    nice -n 10 "$@"
  fi
}

HAD_PREVIOUS=0
SWITCHED=0
finish_deployment() {
  result=$?
  trap - EXIT
  if [ "$result" -ne 0 ]; then
    if [ "$SWITCHED" = 1 ]; then
      mv dist "$DEPLOY_INPUT/failed-dist"
      if [ "$HAD_PREVIOUS" = 1 ]; then
        mv "$DEPLOY_INPUT/previous-dist" dist
        pm2 restart key-manager --update-env || true
      else
        pm2 stop key-manager || true
      fi
    fi
    node "$MAINTENANCE" record "$DEPLOY_ROOT" "$DEPLOY_INPUT" failed || true
  fi
  low_io node "$MAINTENANCE" cleanup "$DEPLOY_ROOT" "$DEPLOY_INPUT" || echo "Deferred history cleanup"
  flock -u 9
  exit "$result"
}
trap finish_deployment EXIT

echo "==> Verify and unpack self-contained release"
[ "$(stat -c %d "$APP_ROOT")" = "$(stat -c %d "$DEPLOY_INPUT")" ] || { echo "Release and application must be on the same filesystem"; exit 1; }
(cd "$DEPLOY_INPUT" && low_io sha256sum -c key-manager-build.tgz.sha256)
mkdir -p "$DEPLOY_INPUT/staging"
low_io tar -xzf "$DEPLOY_INPUT/key-manager-build.tgz" -C "$DEPLOY_INPUT/staging"
low_io node "$MAINTENANCE" verify "$DEPLOY_INPUT/staging/dist" "$COMMIT"
if [ ! -f .env ]; then
  test -f "$DEPLOY_INPUT/bootstrap.env"
  mv "$DEPLOY_INPUT/bootstrap.env" .env
fi

echo "==> Apply changed migrations only"
low_io timeout 120s env NODE_OPTIONS="${NODE_OPTIONS:-} --max-old-space-size=192" \
  node "$DEPLOY_INPUT/staging/dist/migrate.js" "$DEPLOY_ROOT/migrations.sha256"

echo "==> Atomically switch dist"
if [ -d dist ]; then
  mv dist "$DEPLOY_INPUT/previous-dist"
  HAD_PREVIOUS=1
fi
if ! mv "$DEPLOY_INPUT/staging/dist" dist; then
  if [ "$HAD_PREVIOUS" = 1 ]; then mv "$DEPLOY_INPUT/previous-dist" dist; fi
  exit 1
fi
SWITCHED=1

echo "==> Restart and verify running commit"
pm2 restart key-manager --update-env
healthy=0
consecutive=0
for i in $(seq 1 15); do
  if curl -fsS --max-time 3 http://127.0.0.1:3000/healthz -o "$DEPLOY_INPUT/health.json" \
    && node "$MAINTENANCE" health "$DEPLOY_INPUT/health.json" "$COMMIT" \
    && curl -fsS --max-time 3 http://127.0.0.1:3000/ -o "$DEPLOY_INPUT/health-index.html" \
    && cmp -s "$DEPLOY_INPUT/health-index.html" dist/public/index.html; then
    consecutive=$((consecutive + 1))
    if [ "$consecutive" -ge 3 ]; then healthy=1; break; fi
  else
    consecutive=0
  fi
  sleep 2
done
[ "$healthy" = 1 ] || { echo "Health check failed; restoring previous dist"; exit 1; }
pm2 save
node "$MAINTENANCE" record "$DEPLOY_ROOT" "$DEPLOY_INPUT" success
echo "==> Deploy completed (no server Git/build/package installation)"
