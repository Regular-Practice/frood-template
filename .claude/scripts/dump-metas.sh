#!/usr/bin/env bash
#
# Dump metafield + metaobject definitions from the Shopify Admin GraphQL API.
#
# Portable drop-in: copy this single file into any Shopify theme repo's
# .claude/scripts/ directory and run it. Nothing here is store-specific —
# the store + token come from .env.local, the shell environment, or flags.
#
# One-time setup (per store):
#   1. In Shopify admin: Settings → Apps and sales channels → Develop apps →
#      Create an app. Call it something like "Schema dump".
#   2. Configure Admin API scopes. Minimum needed:
#        read_products, read_product_listings, read_customers, read_orders,
#        read_content, read_locales, read_metaobject_definitions, read_metaobjects,
#        read_companies, read_locations, read_markets
#      (Any owner type you don't have scope for just returns an auth error for
#      that one file — the script warns and the rest still dump.)
#   3. Install the app, reveal the Admin API access token (shpat_...).
#
# Run (from anywhere inside the repo):
#   .claude/scripts/dump-metas.sh
#
# Credentials resolve in this order (first match wins):
#   1. --store / --token flags
#   2. SHOPIFY_STORE / SHOPIFY_ADMIN_TOKEN in the shell environment
#   3. .env.local at the repo root (gitignored). Create it once:
#        # .env.local
#        export SHOPIFY_STORE=your-store.myshopify.com
#        export SHOPIFY_ADMIN_TOKEN=shpat_xxx
#
# Flags:
#   --store <domain>   Store domain (e.g. your-store.myshopify.com)
#   --token <shpat_…>  Admin API access token
#   --api <version>    Admin API version (default: 2025-10)
#   --out <dir>        Output directory (default: <repo>/.claude/meta-dump)
#   -h, --help         Show this help
#
# Output defaults to <repo>/.claude/meta-dump/. Add that path to .gitignore —
# it contains store schema, not theme code. Re-run any time the store schema
# changes. Do NOT commit the token or the dump.

set -euo pipefail

# ─── Deps ──────────────────────────────────────────────────────────────────
for dep in curl jq; do
  command -v "$dep" >/dev/null 2>&1 || {
    echo "Missing dependency: $dep (install it and re-run)" >&2
    exit 1
  }
done

# ─── Repo root ───────────────────────────────────────────────────────────────
# Prefer the git toplevel; fall back to two levels up (the .claude/scripts/
# placement) so the script still works in a non-git checkout; then cwd.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null)"; then
  :
elif [ -d "${SCRIPT_DIR}/../.." ]; then
  REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
else
  REPO_ROOT="$PWD"
fi

# ─── Args ────────────────────────────────────────────────────────────────────
# Print the leading comment block (everything after the shebang up to the
# first non-comment line) as help, stripping the leading "# ".
usage() { awk 'NR==1{next} /^#/{sub(/^# ?/,"");print;next} {exit}' "${BASH_SOURCE[0]}"; }

STORE_FLAG="" TOKEN_FLAG="" API_FLAG="" OUT_FLAG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --store)   STORE_FLAG="$2"; shift 2 ;;
    --store=*) STORE_FLAG="${1#*=}"; shift ;;
    --token)   TOKEN_FLAG="$2"; shift 2 ;;
    --token=*) TOKEN_FLAG="${1#*=}"; shift ;;
    --api)     API_FLAG="$2"; shift 2 ;;
    --api=*)   API_FLAG="${1#*=}"; shift ;;
    --out)     OUT_FLAG="$2"; shift 2 ;;
    --out=*)   OUT_FLAG="${1#*=}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; echo "Run with --help for usage." >&2; exit 1 ;;
  esac
done

# ─── Credentials ─────────────────────────────────────────────────────────────
if [ -f "${REPO_ROOT}/.env.local" ]; then
  # shellcheck disable=SC1091
  source "${REPO_ROOT}/.env.local"
fi

STORE="${STORE_FLAG:-${SHOPIFY_STORE:-}}"
TOKEN="${TOKEN_FLAG:-${SHOPIFY_ADMIN_TOKEN:-}}"
API="${API_FLAG:-${SHOPIFY_API_VERSION:-2025-10}}"

if [ -z "$STORE" ] || [ -z "$TOKEN" ]; then
  echo "Missing credentials." >&2
  echo "Set SHOPIFY_STORE + SHOPIFY_ADMIN_TOKEN in ${REPO_ROOT}/.env.local," >&2
  echo "export them in your shell, or pass --store / --token. See --help." >&2
  exit 1
fi

# Normalise the store: accept a bare handle ("my-store"), a full myshopify
# domain, or a pasted URL — append .myshopify.com only when there's no dot.
STORE="${STORE#http://}"; STORE="${STORE#https://}"; STORE="${STORE%%/*}"
[ "$STORE" = "${STORE%.*}" ] && STORE="${STORE}.myshopify.com"

URL="https://${STORE}/admin/api/${API}/graphql.json"
OUT_DIR="${OUT_FLAG:-${REPO_ROOT}/.claude/meta-dump}"
mkdir -p "$OUT_DIR"

gql() {
  curl -sS "$URL" \
    -H "X-Shopify-Access-Token: $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg q "$1" '{query:$q}')"
}

# Run a GraphQL query, extract nodes through the jq filter, write to file.
# Pass the QUERY (not gql's output) so it stays a single quoted argument —
# wrapping gql in "$(…)" with a brace-laden query trips brace expansion and
# corrupts it. When a scope is missing the API returns {errors:[…]}, which the
# filter's `// .` fallback writes verbatim — detect that and warn, don't abort.
dump() {
  local query="$1" filter="$2" file="$3"
  gql "$query" | jq "$filter" > "$file"
  if jq -e 'type == "object" and has("errors")' "$file" >/dev/null 2>&1; then
    echo "  ⚠ $(jq -r '.errors[0].message // "request failed"' "$file")" >&2
  fi
}

OWNER_TYPES=(
  PRODUCT
  PRODUCTVARIANT
  COLLECTION
  CUSTOMER
  ORDER
  COMPANY
  SHOP
  PAGE
  ARTICLE
  BLOG
  LOCATION
  MARKET
)

echo "Dumping schema from ${STORE} (API ${API})"

for OWNER in "${OWNER_TYPES[@]}"; do
  echo "→ metafield definitions: $OWNER"
  dump \
    "{ metafieldDefinitions(first: 250, ownerType: $OWNER) { nodes { name namespace key description type { name } ownerType validations { name value } } } }" \
    '.data.metafieldDefinitions.nodes // .' \
    "${OUT_DIR}/metafields-${OWNER}.json"
done

echo "→ metaobject definitions"
dump \
  '{ metaobjectDefinitions(first: 250) { nodes { name type displayNameKey fieldDefinitions { name key description type { name } validations { name value } } } } }' \
  '.data.metaobjectDefinitions.nodes // .' \
  "${OUT_DIR}/metaobject-definitions.json"

echo
echo "Wrote schema to ${OUT_DIR}/"
ls -1 "${OUT_DIR}"
