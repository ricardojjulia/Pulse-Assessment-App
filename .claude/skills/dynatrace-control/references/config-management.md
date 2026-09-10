# dtctl Configuration Management

## Table of Contents
- [Philosophy](#philosophy)
- [Configuration Structure](#configuration-structure)
  - [Configuration File Lookup Order](#configuration-file-lookup-order)
- [Project-Level Configuration](#project-level-configuration)
  - [Creating a Project Configuration](#creating-a-project-configuration)
  - [Avoiding Git Conflicts](#avoiding-git-conflicts)
  - [First-Time Setup](#first-time-setup)
- [Token Management](#token-management)
  - [Setting Up Tokens](#setting-up-tokens)
  - [Removing Tokens](#removing-tokens)
- [Context Management](#context-management)
  - [Listing Contexts](#listing-contexts)
  - [Switching Contexts](#switching-contexts)
  - [Adding Contexts](#adding-contexts)
  - [Removing Contexts](#removing-contexts)
- [Safety Levels](#safety-levels)
- [Token Scopes](#token-scopes)

This guide covers dtctl configuration with secure token storage.

## Philosophy

**Local-first configuration with secure token storage**
- `.dtctl.yaml` files can be committed to git (no secrets)
- Token references point to tokens stored in OS keyring
- Users are responsible for setting up their own tokens

**Note**: `dtctl config use-context` modifies `current-context` in `.dtctl.yaml`. To avoid git conflicts in team projects, consider adding `.dtctl.yaml` to `.gitignore` or use the `--context` flag instead of switching contexts.

## Configuration Structure

### Configuration File Lookup Order

dtctl searches for configuration in this order:

1. **`--config` flag**: `dtctl --config /path/to/config.yaml <command>`
2. **Local `.dtctl.yaml`**: Searches upward from current directory
3. **Global config**: `$XDG_CONFIG_HOME/dtctl/config` (usually `~/.config/dtctl/config`)

**Recommendation**: Use local `.dtctl.yaml` for project-specific contexts, global config for personal tenants.

## Project-Level Configuration

### Creating a Project Configuration

Create `.dtctl.yaml` in project root:

```yaml
apiVersion: v1
kind: Config
current-context: project-dev
contexts:
  - name: project-dev
    context:
      environment: https://dev123.apps.dynatrace.com
      token-ref: project-dev-token
      safety-level: readwrite-mine
  - name: project-staging
    context:
      environment: https://staging456.apps.dynatrace.com
      token-ref: project-staging-token
      safety-level: readwrite-mine
  - name: project-prod
    context:
      environment: https://prod789.apps.dynatrace.com
      token-ref: project-prod-token
      safety-level: readonly
```

### Avoiding Git Conflicts

Since `dtctl config use-context` modifies `current-context` in `.dtctl.yaml`, team members will have conflicts. Solutions:

**Option 1: Gitignore the file**
```bash
echo '.dtctl.yaml' >> .gitignore
```
Then share the configuration template via documentation.

**Option 2: Use --context flag**
```bash
# Don't switch contexts, specify per command
dtctl --context project-dev get workflows
dtctl --context project-staging apply -f workflow.yaml
```

**Option 3: Accept the changes**
Each team member commits their preferred `current-context`.

### First-Time Setup

```bash
# Set up tokens in OS keyring
dtctl config set-credentials project-dev-token --token dt0s16.YOUR_TOKEN
dtctl config set-credentials project-staging-token --token dt0s16.YOUR_TOKEN
dtctl config set-credentials project-prod-token --token dt0s16.YOUR_TOKEN

# Verify setup
dtctl auth whoami
```

## Token Management

### Setting Up Tokens

```bash
# Add token to keyring
dtctl config set-credentials <token-ref> --token <your-token>

# From stdin (avoids shell history)
printf "%s" "<your-token>" | dtctl config set-credentials <token-ref> --token -

# Update existing token
dtctl config set-credentials project-dev-token --token <new-token>
```

**Token storage locations:**

| Platform | Storage |
|----------|---------|
| macOS | Keychain |
| Linux | Secret Service (gnome-keyring, kwallet) |
| Windows | Credential Manager |

### Removing Tokens

```bash
# Remove context
dtctl config delete-context <name>

# Remove token from keyring - use OS tools:
# macOS: Keychain Access
# Linux: seahorse, kwalletmanager
# Windows: Credential Manager
```

## Context Management

### Listing Contexts

```bash
# List all contexts
dtctl config get-contexts

# Show current context
dtctl config current-context

# Describe specific context
dtctl config describe-context <name>
```

### Switching Contexts

```bash
# Switch context (modifies .dtctl.yaml)
dtctl config use-context project-prod

# Override for single command (recommended for teams)
dtctl --context project-staging get workflows
```

### Adding Contexts

```bash
# Add to global config
dtctl config set-context personal-dev \
  --environment https://abc123.apps.dynatrace.com \
  --token-ref personal-dev-token \
  --safety-level readwrite-mine

# Add token
dtctl config set-credentials personal-dev-token --token dt0s16.xxxxx
```

For local project config, edit `.dtctl.yaml` directly.

### Removing Contexts

```bash
dtctl config delete-context <name>
```

## Safety Levels

| Level | Description | Use Case |
|-------|-------------|----------|
| `readonly` | Read operations only | Production environments |
| `readwrite-mine` | Modify only your resources | Default for development |
| `readwrite-all` | Modify any resource | Shared development, admin |
| `dangerously-unrestricted` | All operations | Emergency admin only |

**Recommendation**: Use `readwrite-mine` as default.

**Note**: Safety levels are client-side checks. API token scopes determine actual permissions.

## Token Scopes

Your API token must have appropriate scopes for operations.

| Safety Level | Required Scopes |
|--------------|----------------|
| `readonly` | Read scopes |
| `readwrite-mine` / `readwrite-all` | Read + Write scopes |
| `dangerously-unrestricted` | Read + Write + Delete scopes |

**Creating tokens:**
1. Go to **Access Tokens** in Dynatrace UI
2. Generate token with appropriate scopes
3. Copy token (shown only once)
4. Store: `dtctl config set-credentials <ref> --token <token>`

**Reference**: https://github.com/dynatrace-oss/dtctl/blob/main/docs/TOKEN_SCOPES.md
