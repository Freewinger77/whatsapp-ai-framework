#!/usr/bin/env bash
#
# set-proxy-pool.sh
#
# Apply a finite proxy pool to ONE regional WhatsApp Azure App Service.
# Every new instance on that app auto-claims a free slot from the pool
# (recycled on delete). The 6th+ instance connects direct (no proxy).
#
# Only the 4 pool-enabled regions have a matching file in ./proxies/:
#   wasup-uk-south  → proxies/uk-south.txt
#   wasup-uk-west   → proxies/uk-west.txt
#   wasup-se        → proxies/se.txt
#   wasup-fi        → proxies/fi.txt
#
# Usage:
#   ./set-proxy-pool.sh --region uk-west                     # uses proxies/uk-west.txt
#   ./set-proxy-pool.sh --region se --from proxies/se.txt    # explicit file
#   ./set-proxy-pool.sh --region uk-south --show             # show (redacted)
#   ./set-proxy-pool.sh --region uk-south --unset            # remove pool
#
# Requires: az CLI, logged in to the correct subscription.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESOURCE_GROUP="${RESOURCE_GROUP:-whatsapp-multi-rg}"
REGION=""
FROM_FILE=""
ACTION="set"

usage() {
    cat <<EOF
Usage: $0 --region <code> [options]

Options:
  --region <code>   Target region: uk-south | uk-west | se | fi
                    (default file: proxies/<code>.txt)
  --from <file>     Proxy list file (host:port:user:pass per line, # for comments)
  --unset           Remove the PROXY_POOL env var on the region
  --show            Print the currently configured PROXY_POOL (redacted)
  --rg <name>       Resource group (default: whatsapp-multi-rg, env: RESOURCE_GROUP)
  -h, --help        Show this help
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --region) REGION="$2"; shift 2;;
        --from)   FROM_FILE="$2"; shift 2;;
        --unset)  ACTION="unset"; shift;;
        --show)   ACTION="show"; shift;;
        --rg)     RESOURCE_GROUP="$2"; shift 2;;
        -h|--help) usage; exit 0;;
        *) echo "Unknown argument: $1" >&2; usage; exit 1;;
    esac
done

if [[ -z "$REGION" ]]; then
    echo "Error: --region is required." >&2
    usage
    exit 1
fi

APP_NAME="wasup-${REGION}"

# Default file path if --from not provided
if [[ -z "$FROM_FILE" && "$ACTION" == "set" ]]; then
    FROM_FILE="$SCRIPT_DIR/proxies/${REGION}.txt"
fi

echo "[set-proxy-pool] Resource group: $RESOURCE_GROUP"
echo "[set-proxy-pool] Target app:     $APP_NAME"
echo "[set-proxy-pool] Action:         $ACTION"

redact_url() {
    # Redact password inside proxy URLs for log/show output
    sed -E 's|(://[^:]+):[^@]+@|\1:***@|g'
}

case "$ACTION" in
    show)
        current="$(az webapp config appsettings list \
            -g "$RESOURCE_GROUP" -n "$APP_NAME" \
            --query "[?name=='PROXY_POOL'].value" -o tsv 2>/dev/null || true)"
        if [[ -z "$current" ]]; then
            echo "[set-proxy-pool] No PROXY_POOL set on $APP_NAME (auto-assignment disabled)."
            exit 0
        fi
        echo "[set-proxy-pool] PROXY_POOL on $APP_NAME:"
        echo "$current" | tr ',' '\n' | redact_url | nl
        ;;

    set)
        if [[ ! -f "$FROM_FILE" ]]; then
            echo "Error: proxy list file not found: $FROM_FILE" >&2
            exit 1
        fi

        # Build comma-separated URL list (skip blank/# lines)
        urls=()
        while IFS= read -r raw || [[ -n "$raw" ]]; do
            line="$(echo "$raw" | sed -E 's/\r$//; s/^[[:space:]]+//; s/[[:space:]]+$//')"
            [[ -z "$line" || "$line" =~ ^# ]] && continue
            # Expect host:port:user:pass  (colon count == 3)
            if [[ "$(echo "$line" | awk -F: '{print NF}')" -ne 4 ]]; then
                echo "Warning: skipping malformed line: $line" >&2
                continue
            fi
            host="$(echo "$line" | cut -d: -f1)"
            port="$(echo "$line" | cut -d: -f2)"
            user="$(echo "$line" | cut -d: -f3)"
            pass="$(echo "$line" | cut -d: -f4)"
            urls+=("http://${user}:${pass}@${host}:${port}")
        done < "$FROM_FILE"

        if [[ ${#urls[@]} -eq 0 ]]; then
            echo "Error: no valid proxy lines in $FROM_FILE" >&2
            exit 1
        fi

        pool_value="$(IFS=,; echo "${urls[*]}")"
        echo "[set-proxy-pool] Parsed ${#urls[@]} proxies:"
        printf '  %s\n' "${urls[@]}" | redact_url | nl

        echo "[set-proxy-pool] Applying PROXY_POOL to $APP_NAME..."
        az webapp config appsettings set \
            -g "$RESOURCE_GROUP" -n "$APP_NAME" \
            --settings "PROXY_POOL=$pool_value" "REGION_CODE=$REGION" \
            -o none

        echo "[set-proxy-pool] Restarting $APP_NAME so the new pool is loaded..."
        az webapp restart -g "$RESOURCE_GROUP" -n "$APP_NAME" -o none

        echo "[set-proxy-pool] Done. Verify with:"
        echo "  curl -s https://${APP_NAME}.azurewebsites.net/api/proxy/pool -H \"X-API-Key: \$API_KEY\" | jq"
        ;;

    unset)
        echo "[set-proxy-pool] Removing PROXY_POOL from $APP_NAME"
        az webapp config appsettings delete \
            -g "$RESOURCE_GROUP" -n "$APP_NAME" \
            --setting-names PROXY_POOL \
            -o none
        echo "[set-proxy-pool] Restarting $APP_NAME..."
        az webapp restart -g "$RESOURCE_GROUP" -n "$APP_NAME" -o none
        echo "[set-proxy-pool] Done."
        ;;
esac
