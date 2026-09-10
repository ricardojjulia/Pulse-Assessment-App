#!/usr/bin/env bash
#
# Dynatrace Workflow Deploy Script
#
# Validates and deploys a workflow using dtctl.
# Aborts on any validation or deployment failure. No --force option.
#
# Usage:
#   ./scripts/deploy_workflow.sh <workflow.json|workflow.yaml>
#
# Requirements:
#   - dtctl installed, configured, and authenticated (safety-level readwrite-mine)
#   - Node 22+ with js-yaml installed (for validation)
#
# Exit codes:
#   0 - Success
#   1 - Validation or prerequisite failure
#   2 - Dry-run failed
#   3 - Deploy failed after retries

set -euo pipefail

# Configuration
MAX_ATTEMPTS=3
RETRY_DELAY=5

# Colors (if terminal supports)
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Script directory (for finding validate_workflow.js)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
    cat << EOF
Dynatrace Workflow Deploy Script

Usage:
  $(basename "$0") <workflow.json|workflow.yaml>

Process:
  1. Check prerequisites (dtctl auth, Node.js, validator)
  2. Validate file syntax and structure (validate_workflow.js --strict)
  3. Dry-run against Dynatrace API (dtctl apply --dry-run)
  4. Deploy workflow (dtctl apply), up to $MAX_ATTEMPTS attempts on transient failures

Requirements:
  - dtctl installed and authenticated (safety-level readwrite-mine)
  - Node 22+ with js-yaml (npm install in skill directory)

Exit Codes:
  0 - Deployment successful
  1 - Validation or prerequisite failure
  2 - Dry-run failed (API rejected the workflow definition)
  3 - Deployment failed after retries
EOF
    exit 0
}

log_info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# --- Step 0: Prerequisites ---------------------------------------------------

check_prerequisites() {
    log_info "Checking prerequisites..."

    if ! command -v dtctl &> /dev/null; then
        log_error "dtctl not found. See dtctl skill for installation."
        exit 1
    fi

    if ! dtctl auth whoami --plain &> /dev/null; then
        log_error "dtctl not authenticated. Run: dtctl auth login --safety-level readwrite-mine"
        exit 1
    fi

    if ! command -v node &> /dev/null; then
        log_error "Node.js not found. Install Node 22+."
        exit 1
    fi

    if [[ ! -f "$SCRIPT_DIR/validate_workflow.js" ]]; then
        log_error "validate_workflow.js not found in $SCRIPT_DIR"
        exit 1
    fi

    log_info "Prerequisites OK"
}

# --- Step 1: Local validation -------------------------------------------------

validate_file() {
    local file="$1"
    log_info "Step 1: Validating file syntax and structure..."

    if ! node "$SCRIPT_DIR/validate_workflow.js" "$file" --strict; then
        log_error "Local validation failed. Fix errors above and retry."
        exit 1
    fi

    log_info "Local validation passed"
}

# --- Step 2: Dry-run ----------------------------------------------------------

dry_run() {
    local file="$1"
    log_info "Step 2: Dry-run against Dynatrace API..."

    local output
    if ! output=$(dtctl apply -f "$file" --dry-run 2>&1); then
        log_error "Dry-run failed. API rejected the workflow definition:"
        echo "$output" >&2
        exit 2
    fi

    log_info "Dry-run passed"
}

# --- Step 3: Deploy with retries (transient failures only) --------------------

deploy() {
    local file="$1"
    local attempt=0

    log_info "Step 3: Deploying workflow..."

    while [[ $attempt -lt $MAX_ATTEMPTS ]]; do
        attempt=$((attempt + 1))
        log_info "Deploy attempt $attempt of $MAX_ATTEMPTS..."

        local output
        local exit_code=0
        output=$(dtctl apply -f "$file" --plain 2>&1) || exit_code=$?

        if [[ $exit_code -eq 0 ]]; then
            echo "$output"
            log_info "Deployment successful"
            return 0
        fi

        # Check if error is transient (5xx, timeout, network) vs deterministic (4xx)
        if echo "$output" | grep -qiE '(400|403|404|409|422|validation|invalid|not found)'; then
            log_error "Deployment failed with non-transient error (not retrying):"
            echo "$output" >&2
            exit 3
        fi

        log_warn "Attempt $attempt failed (possibly transient):"
        echo "$output" >&2

        if [[ $attempt -lt $MAX_ATTEMPTS ]]; then
            log_info "Retrying in ${RETRY_DELAY}s..."
            sleep $RETRY_DELAY
        fi
    done

    log_error "Deployment failed after $MAX_ATTEMPTS attempt(s)"
    exit 3
}

# --- Main ---------------------------------------------------------------------

main() {
    if [[ $# -eq 0 ]] || [[ "$1" == "-h" ]] || [[ "$1" == "--help" ]]; then
        usage
    fi

    local file="$1"

    if [[ ! -f "$file" ]]; then
        log_error "File not found: $file"
        exit 1
    fi

    local ext="${file##*.}"
    if [[ "$ext" != "json" && "$ext" != "yaml" && "$ext" != "yml" ]]; then
        log_error "Unsupported file type: .$ext (use .json, .yaml, or .yml)"
        exit 1
    fi

    echo ""
    echo "═══════════════════════════════════════════════════════"
    echo "  Dynatrace Workflow Deploy"
    echo "  File: $file"
    echo "═══════════════════════════════════════════════════════"
    echo ""

    check_prerequisites
    validate_file "$file"
    dry_run "$file"
    deploy "$file"

    echo ""
    echo "═══════════════════════════════════════════════════════"
    log_info "Done."
    echo "═══════════════════════════════════════════════════════"
}

main "$@"
