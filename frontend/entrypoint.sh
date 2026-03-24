#!/bin/sh
# Replace build-time placeholders with runtime public env values.

escape_sed_replacement() {
  printf '%s' "$1" | sed 's/[|&]/\\&/g'
}

replace_public_env() {
  PLACEHOLDER="$1"
  VALUE="$2"
  LABEL="$3"
  ESCAPED_VALUE=$(escape_sed_replacement "$VALUE")

  find /app/.next -name "*.js" -exec sed -i "s|$PLACEHOLDER|$ESCAPED_VALUE|g" {} +
  echo "Configured $LABEL: ${VALUE:-<empty>}"
}

replace_public_env "__NEXT_PUBLIC_API_URL__" "${NEXT_PUBLIC_API_URL:-http://localhost:8000}" "API URL"
replace_public_env "__NEXT_PUBLIC_OPENWEBIF_URL__" "${NEXT_PUBLIC_OPENWEBIF_URL:-}" "OpenWebIF URL"

exec "$@"
