# dtctl Troubleshooting Guide

This guide covers common issues and solutions for working with dtctl.

## Installation

`dtctl` is available at: https://github.com/dynatrace-oss/dtctl

You must install dtctl before this skill can be used. Follow the installation instructions in the upstream repository.

### Verify Installation

After installation, verify dtctl is available:

```bash
dtctl version
```

## Common Issues

### dtctl not found

**Problem**: Command `dtctl` is not recognized.

**Solution**: 
- Ensure the binary is in your PATH
- If installed to a custom location, add that directory to PATH:
  ```bash
  export PATH="$PATH:/path/to/dtctl/directory"
  ```
- Add the PATH export to your shell config file (~/.bashrc or ~/.zshrc) to persist across sessions
- Or reinstall the binary following the upstream installation instructions

### 401/403 Authentication Errors

**Problem**: Unauthorized or forbidden errors when running dtctl commands.

**Solution**:
- Check your token scopes are sufficient for the operation
- Update your token credentials:
  ```bash
  dtctl config set-credentials <token-ref> --token <your-new-token>
  ```
- Verify token is correctly stored:
  ```bash
  dtctl auth whoami
  ```
- See [config-management.md](config-management.md) for detailed token setup
- See [Token Scope Issues](#token-scope-issues) below for more details

### Wrong Tenant / Context Issues

**Problem**: Commands are executing against the wrong Dynatrace environment.

**Solution**:
- Check current context quickly: `dtctl config current-context`
- List available contexts: `dtctl config get-contexts`
- Switch to the correct context: `dtctl config use-context <name>`
- Verify current context settings: `dtctl config describe-context <name>`

### Owner Missing / Cannot Find Resources

**Problem**: API returns UUIDs and you need to filter by owner.

**Solution**:
- Get your user UUID: `dtctl auth whoami --id-only`
- Filter resources by your UUID in JSON output:
  ```bash
  ME=$(dtctl auth whoami --id-only)
  dtctl get workflows -o json --plain | jq -r --arg me "$ME" '.[] | select(.owner==$me) | "\(.id) | \(.title)"'
  ```
- Or use the built-in filter: `dtctl get workflows --mine`

### Apply Errors

**Problem**: `dtctl apply` fails with validation or format errors.

**Solution**:
- Validate your YAML syntax
- Use `describe` or `get -o yaml` to see the correct structure:
  ```bash
  dtctl describe workflow <id> -o yaml
  dtctl get dashboard <id> -o yaml
  ```
- Use these outputs as templates for your apply files
- Test with `--dry-run` flag first: `dtctl apply -f file.yaml --dry-run`

### Safety Level Blocking Operations

**Problem**: Operations are blocked due to safety level restrictions.

**Solution**:
- Check current safety level: `dtctl config get-contexts`
- Verify you own the resource: `dtctl get <resource> --mine`
- If needed, adjust context safety level:
  ```bash
  dtctl config set-context <name> --safety-level <level>
  ```
  Where level is: `readonly`, `readwrite-mine`, `readwrite-all`, or `dangerously-unrestricted`
- For production contexts, keep `readwrite-mine` or stricter
- **Note**: Safety levels are client-side checks. The API token scopes determine actual permissions.

### Resource Not Found / Empty Lists

**Problem**: Commands return no results or "not found" errors for resources you expect to exist.

**Solution**:
- Verify you're in the correct context: `dtctl config current-context`
- Check your user identity: `dtctl auth whoami`
- List with verbose output to see API calls: `dtctl get workflows -v`
- Try with your resources only: `dtctl get workflows --mine`
- Check if it's a permission issue (404 can mean "no permission to view")

### Configuration File Location Issues

**Problem**: Unsure which config file is being used or changes not taking effect.

**Solution**:
- Check which config file is active:
  ```bash
  dtctl config view -v | head -1
  ```
- View entire configuration:
  ```bash
  dtctl config view
  ```
- Config file search order:
  1. `.dtctl.yaml` in current directory (searches upward)
  2. `$XDG_CONFIG_HOME/dtctl/config` (usually `~/.config/dtctl/config`)
- Override with `--config` flag: `dtctl --config /path/to/config get workflows`

### Token Not Found in Keyring

**Problem**: Error says token reference is not found.

**Error:**
```
Error: token "project-dev-token" not found in keyring
```

**Solution**:
```bash
# Add the missing token
dtctl config set-credentials project-dev-token --token dt0s16.YOUR_TOKEN

# Verify it works
dtctl auth whoami
```

See [config-management.md](config-management.md) for complete token management guide.

### Permission Denied vs Not Found Confusion

**Problem**: Unclear whether resource doesn't exist or you lack permission.

**Explanation**:
- `404 Not Found` can mean:
  - Resource truly doesn't exist, OR
  - You don't have permission to view it (API security by obscurity)
- `403 Forbidden` means:
  - Your token lacks required scopes for the operation
- Safety level blocks happen **before** API calls:
  - `readonly` context blocks all modifications locally
  - Check both safety level AND token scopes

**Solution**:
- Verify context safety level: `dtctl config get-contexts`
- Verify token scopes are sufficient (see Token Scope Issues below)
- Try listing all resources to confirm access: `dtctl get workflows`
- Check with resource owner if you should have access

## Token Scope Issues

### Insufficient Scopes

**Problem**: 403 errors when attempting operations.

**Solution**:
1. Check required scopes: https://github.com/dynatrace-oss/dtctl/blob/main/docs/TOKEN_SCOPES.md
2. Generate new token with additional scopes in Dynatrace UI:
   - Go to: Access Tokens in your Dynatrace environment
   - Create new token with required scopes
   - Copy token immediately (shown only once)
3. Update token in keyring:
   ```bash
   dtctl config set-credentials <token-ref> --token <new-token>
   ```
4. Verify:
   ```bash
   dtctl auth whoami
   ```

### Token Expired

**Problem**: Previously working token now returns 401.

**Solution**:
1. Generate new token in Dynatrace UI
2. Update in keyring:
   ```bash
   dtctl config set-credentials <token-ref> --token <new-token>
   ```
3. Verify:
   ```bash
   dtctl auth whoami
   dtctl get workflows --mine
   ```

## Debugging Tips

### Using Verbose Output

Add `-v` or `-vv` flags for detailed debugging information:

```bash
# Basic verbose output (shows config file, API calls)
dtctl get workflows -v

# Full debug output (includes auth headers, request/response details)
dtctl get workflows -vv
```

**Use cases**:
- Diagnose API connectivity issues
- See which config file is loaded
- Debug authentication problems
- Understand what the CLI is doing

### Verifying Configuration

Check your complete setup:

```bash
# Which config file is active?
dtctl config view -v | head -5

# What contexts are available?
dtctl config get-contexts

# Which context am I using?
dtctl config current-context

# Who am I authenticated as?
dtctl auth whoami

# Can I access resources?
dtctl get workflows --mine
```

## Keyring Issues

### Linux - Secret Service Not Available

**Problem**: dtctl cannot access keyring on Linux.

**Solution**:
```bash
# Install keyring backend
# Ubuntu/Debian:
sudo apt-get install gnome-keyring

# Fedora:
sudo dnf install gnome-keyring

# Arch:
sudo pacman -S gnome-keyring

# Initialize keyring (if needed)
gnome-keyring-daemon --start
```

### macOS - Keychain Locked

**Problem**: dtctl cannot access Keychain.

**Solution**:
- Open "Keychain Access" app
- Unlock "login" keychain if locked
- Verify dtctl can access stored credentials

### Windows - Credential Manager

**Problem**: Token not accessible on Windows.

**Solution**:
- Open "Credential Manager" from Control Panel
- Check for dtctl credentials under "Generic Credentials"
- If missing, re-add token: `dtctl config set-credentials <ref> --token <token>`

## Additional Resources

- Upstream repo: https://github.com/dynatrace-oss/dtctl
- Releases: https://github.com/dynatrace-oss/dtctl/releases
- Token scopes: https://github.com/dynatrace-oss/dtctl/blob/main/docs/TOKEN_SCOPES.md
- Configuration guide: [config-management.md](config-management.md)
- CLI help: `dtctl --help`, `dtctl <command> --help`
