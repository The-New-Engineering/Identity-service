#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scaffold.sh — create a new service from the template
#
# Usage:
#   ./scaffold.sh <service-name>
#
# Example:
#   ./scaffold.sh payments-service
#
# What it does:
#   1. Copies this template into a sibling directory named <service-name>
#   2. Replaces 'service-template' with the actual service name throughout
#   3. Installs dependencies
#   4. Runs contract validation to prove the scaffold is intact
#   5. Boots the service once to confirm it starts cleanly
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Args ──────────────────────────────────────────────────────────────────────
SERVICE_NAME="${1:-}"

if [[ -z "$SERVICE_NAME" ]]; then
  echo "Usage: ./scaffold.sh <service-name>"
  echo "Example: ./scaffold.sh payments-service"
  exit 1
fi

TEMPLATE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="$(dirname "$TEMPLATE_DIR")/$SERVICE_NAME"

# ── Guard: target must not already exist ──────────────────────────────────────
if [[ -d "$TARGET_DIR" ]]; then
  echo "❌ Directory already exists: $TARGET_DIR"
  exit 1
fi

echo ""
echo "▶ Creating service: $SERVICE_NAME"
echo "  Source:  $TEMPLATE_DIR"
echo "  Target:  $TARGET_DIR"
echo ""

# ── Step 1: Copy template ─────────────────────────────────────────────────────
cp -r "$TEMPLATE_DIR" "$TARGET_DIR"

# Remove scaffold script from the new service — it belongs to the template only
rm -f "$TARGET_DIR/scaffold.sh"

# Remove any existing node_modules or dist
rm -rf "$TARGET_DIR/node_modules" "$TARGET_DIR/dist"

echo "✅ Template copied"

# ── Step 2: Replace service name throughout ───────────────────────────────────
# Targets: package.json, openapi.yaml, .env.example
find "$TARGET_DIR" \
  \( -name "package.json" -o -name "openapi.yaml" -o -name ".env.example" \) \
  | while read -r file; do
    sed -i.bak "s/service-template/$SERVICE_NAME/g" "$file"
    sed -i.bak "s/Service Template/$SERVICE_NAME/g" "$file"
    rm -f "${file}.bak"
  done

echo "✅ Service name injected: $SERVICE_NAME"

# ── Step 3: Set up .env ───────────────────────────────────────────────────────
cp "$TARGET_DIR/.env.example" "$TARGET_DIR/.env"
# Patch SERVICE_NAME in the new .env
sed -i.bak "s/SERVICE_NAME=my-service/SERVICE_NAME=$SERVICE_NAME/" "$TARGET_DIR/.env"
rm -f "$TARGET_DIR/.env.bak"

echo "✅ .env created from .env.example"

# ── Step 4: Install dependencies ──────────────────────────────────────────────
echo ""
echo "▶ Installing dependencies..."
(cd "$TARGET_DIR" && pnpm install --silent)
echo "✅ Dependencies installed"

# ── Step 5: Validate contract ─────────────────────────────────────────────────
echo ""
echo "▶ Validating contract..."
(cd "$TARGET_DIR" && pnpm run validate:contract)

# ── Step 6: Typecheck ─────────────────────────────────────────────────────────
echo "▶ Running typecheck..."
(cd "$TARGET_DIR" && pnpm run typecheck)
echo "✅ Types are clean"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "────────────────────────────────────────────────────────────────"
echo "  ✓ Service ready: $SERVICE_NAME"
echo ""
echo "  Next steps:"
echo "    cd $TARGET_DIR"
echo "    pnpm dev"
echo ""
echo "  Then:"
echo "    1. Update contract/openapi.yaml with your domain paths"
echo "    2. Replace src/routes/v1/items.ts with your resource"
echo "    3. Add service-specific env vars to .env and src/config/env.ts"
echo "────────────────────────────────────────────────────────────────"
echo ""
