#!/bin/bash
# Upload dashboard to Dynatrace Document Store
# Usage: DT_TOKEN=<your-token> ./deploy-dashboard.sh
# Generate token at: https://abc12345.apps.dynatrace.com/ui/access-tokens
# Required scope: document:documents:write

DT_URL="${DT_URL:-https://abc12345.apps.dynatrace.com}"
DASHBOARD_FILE="dashboards/finops-cloud-management.json"

if [ -z "$DT_TOKEN" ]; then
  echo "Error: DT_TOKEN environment variable is required."
  echo "Generate an API token at: $DT_URL/ui/access-tokens"
  echo "Required scopes: document:documents:write"
  exit 1
fi

if [ ! -f "$DASHBOARD_FILE" ]; then
  echo "Error: Dashboard file not found: $DASHBOARD_FILE"
  exit 1
fi

NAME=$(jq -r '.name' "$DASHBOARD_FILE")
TYPE=$(jq -r '.type' "$DASHBOARD_FILE")
CONTENT=$(jq -c '.content' "$DASHBOARD_FILE")

echo "Deploying dashboard: $NAME"
echo "To: $DT_URL"

# Create a temp file with the content JSON
TMPFILE=$(mktemp)
echo "$CONTENT" > "$TMPFILE"

RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST "$DT_URL/platform/document/v1/documents" \
  -H "Authorization: Bearer $DT_TOKEN" \
  -F "name=$NAME" \
  -F "type=$TYPE" \
  -F "content=@$TMPFILE;type=application/json" \
  -F "isPrivate=false")

rm -f "$TMPFILE"

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
  DOC_ID=$(echo "$BODY" | jq -r '.id')
  echo "Dashboard deployed successfully!"
  echo "Document ID: $DOC_ID"
  echo "Open at: $DT_URL/ui/document/v0/#/$DOC_ID"
else
  echo "Deploy failed (HTTP $HTTP_CODE):"
  echo "$BODY"
  exit 1
fi
