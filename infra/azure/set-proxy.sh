#!/usr/bin/env bash
#
# set-proxy.sh
#
# Apply a deployment-level default proxy to ONE regional WhatsApp Azure App Service.
# Every instance on that region's app will route Baileys traffic through this
# proxy unless it has a per-instance override set via the API.
#
# Usage:
#   # Set for UK West (default):
#   ./set-proxy.sh --url "http://user:pass@proxy.example.com:8080"
#
#   # Set for another region:
#   ./set-proxy.sh --region de --url "socks5://user:pass@proxy.de.example.com:1080"
#
#   # Remove the proxy:
#   ./set-proxy.sh --region uk-west --unset
#
#   # Show current state without changing anything:
#   ./set-proxy.sh --region uk-west --show
#
# Supported regions (must match the Azure App Service name wasup-<code>):
#   uk-west  uk-south  de  fr  it  fi  se  no
#
# Requires: az CLI, logged in to the correct subscription.

set -euo pipefail

RESOURCE_GROUP="${RESOURCE_GROUP:-whatsapp-multi-rg}"
REGION="uk-west"
PROXY_URL=""
ACTION="set"

usage() {
    cat <<EOF
Usage: $0 [options]
  --region <code>    Target region (default: uk-west). One of: uk-west uk-south de fr it fi se no
  --url <url>        Proxy URL to set, e.g. http://user:pass@host:8080 or socks5://host:1080
  --unset            Remove the deployment-level proxy on this region
  --show             Show the currently configured proxy on this region (redacted)
  --rg <name>        Resource group (default: whatsapp-multi-rg, env: RESOURCE_GROUP)
  -h, --help         Show this help
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --region) REGION="$2"; shift 2;;
        --url)    PROXY_URL="$2"; ACTION="set"; shift 2;;
        --unset)  ACTION="unset"; shift;;
        --show)   ACTION="show"; shift;;
        --rg)     RESOURCE_GROUP="$2"; shift 2;;
        -h|--help) usage; exit 0;;
        *) echo "Unknown argument: $1" >&2; usage; exit 1;;
    esac
done

APP_NAME="wasup-${REGION}"

echo "[set-proxy] Resource group: $RESOURCE_GROUP"
echo "[set-proxy] Target app:     $APP_NAME"
echo "[set-proxy] Action:         $ACTION"

redact() {
    # Redact password in proxy URL for log output
    sed -E 's|(://[^:]+):[^@]+@|\1:***@|'
}

case "$ACTION" in
    show)
        current="$(az webapp config appsettings list \
            -g "$RESOURCE_GROUP" -n "$APP_NAME" \
            --query "[?name=='DEFAULT_PROXY_URL'].value" -o tsv 2>/dev/null || true)"
        if [[ -z "$current" ]]; then
            echo "[set-proxy] No DEFAULT_PROXY_URL is set on $APP_NAME (instances connect directly unless they have their own override)."
        else
            echo "[set-proxy] DEFAULT_PROXY_URL on $APP_NAME: $(echo "$current" | redact)"
        fi
        ;;

    set)
        if [[ -z "$PROXY_URL" ]]; then
            echo "Error: --url is required when setting a proxy." >&2
            exit 1
        fi
        echo "[set-proxy] Applying DEFAULT_PROXY_URL = $(echo "$PROXY_URL" | redact)"
        az webapp config appsettings set \
            -g "$RESOURCE_GROUP" -n "$APP_NAME" \
            --settings "DEFAULT_PROXY_URL=$PROXY_URL" "REGION_CODE=$REGION" \
            -o none
        echo "[set-proxy] Restarting $APP_NAME so the new setting takes effect..."
        az webapp restart -g "$RESOURCE_GROUP" -n "$APP_NAME" -o none
        echo "[set-proxy] Done. Verify with:"
        echo "  curl -s https://${APP_NAME}.azurewebsites.net/api/proxy -H \"X-API-Key: \$API_KEY\" | jq"
        ;;

    unset)
        echo "[set-proxy] Removing DEFAULT_PROXY_URL from $APP_NAME"
        az webapp config appsettings delete \
            -g "$RESOURCE_GROUP" -n "$APP_NAME" \
            --setting-names DEFAULT_PROXY_URL \
            -o none
        echo "[set-proxy] Restarting $APP_NAME..."
        az webapp restart -g "$RESOURCE_GROUP" -n "$APP_NAME" -o none
        echo "[set-proxy] Done."
        ;;
esac
