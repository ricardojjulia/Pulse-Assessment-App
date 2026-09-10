# SDK Versions Resource

## Table of Contents
- [Overview](#overview)
- [List SDK Versions](#list-sdk-versions)
- [JSON Schema](#json-schema)
- [Key Fields](#key-fields)
- [Common Operations](#common-operations)
  - [List all SDK versions](#list-all-sdk-versions)
  - [Get SDK versions as JSON](#get-sdk-versions-as-json)
  - [Find default SDK version](#find-default-sdk-version)
  - [Find non-deprecated versions](#find-non-deprecated-versions)
  - [List by runtime version](#list-by-runtime-version)
- [Relationship to Function Execution](#relationship-to-function-execution)
- [Important Notes](#important-notes)
- [Related Commands](#related-commands)
  - [Execute function with SDK awareness](#execute-function-with-sdk-awareness)
  - [Check function SDK version](#check-function-sdk-version)
- [Example Usage](#example-usage)
  - [Select appropriate SDK version](#select-appropriate-sdk-version)

## Overview
SDK versions represent available SDK versions for the function executor in Dynatrace. These versions determine the JavaScript runtime environment and available APIs when executing functions via `dtctl exec function`.

The sdk-versions resource provides:
- List of available SDK versions for function execution
- Information about runtime capabilities for each version
- Version metadata for selecting appropriate SDK for function execution

## List SDK Versions
```bash
dtctl get sdk-versions -o json --plain
```

## JSON Schema

Each SDK version object contains:

```json
{
  "version": "string (SDK version identifier)",
  "name": "string (human-readable version name)",
  "description": "string (version description)",
  "runtimeVersion": "string (e.g., Node.js version)",
  "default": true|false,
  "deprecated": true|false,
  "capabilities": ["array of supported features"]
}
```

## Key Fields

- **version**: SDK version identifier (e.g., "1.0", "2.0")
- **name**: Human-readable version name
- **description**: Description of SDK version features
- **runtimeVersion**: Underlying runtime version (e.g., Node.js 18, Node.js 22)
- **default**: Whether this is the default SDK version for new functions
- **deprecated**: Whether this version is deprecated and should not be used
- **capabilities**: Array of supported features and APIs

## Common Operations

### List all SDK versions
```bash
dtctl get sdk-versions
```

### Get SDK versions as JSON
```bash
dtctl get sdk-versions -o json --plain
```

### Find default SDK version
```bash
dtctl get sdk-versions -o json --plain | jq -r '.[] | select(.default==true) | "\(.version) | \(.name) | \(.runtimeVersion)"'
```

### Find non-deprecated versions
```bash
dtctl get sdk-versions -o json --plain | jq -r '.[] | select(.deprecated!=true) | "\(.version) | \(.name)"'
```

### List by runtime version
```bash
dtctl get sdk-versions -o json --plain | jq -r 'group_by(.runtimeVersion) | .[] | "\(.[0].runtimeVersion): \(length) versions"'
```

## Relationship to Function Execution

SDK versions determine the runtime environment for:
- **App functions**: Functions exposed by installed apps
- **Ad-hoc JavaScript**: Custom JavaScript code executed via `dtctl exec function --code` or `-f`

When executing functions, the SDK version controls:
- Available JavaScript APIs and built-in modules
- Node.js runtime version and features
- Platform-specific capabilities (e.g., fetch, console, timers)
- Security and sandboxing features

## Important Notes

- **Default version**: New functions typically use the default SDK version unless specified
- **Deprecated versions**: Avoid using deprecated SDK versions for new functions
- **Runtime compatibility**: Different SDK versions may have different Node.js runtimes
- **Capabilities**: Check `capabilities` array to determine available features
- **Function execution**: SDK version affects what APIs are available in function code
- **Cross-reference**: See [functions resource](functions.md) for function listing and [SKILL.md](../../SKILL.md) for `exec function` documentation

## Related Commands

### Execute function with SDK awareness
```bash
# Execute ad-hoc JavaScript (uses default SDK version)
dtctl exec function --code 'console.log(process.version)'

# Execute function from file
dtctl exec function -f script.js
```

### Check function SDK version
```bash
# App functions typically use the SDK version specified by the app
dtctl describe function dynatrace.automations/run-javascript
```

## Example Usage

### Select appropriate SDK version
```bash
# List available SDK versions with runtime info
dtctl get sdk-versions

# Check default version before executing code
dtctl get sdk-versions -o json --plain | jq -r '.[] | select(.default==true)'

# Execute JavaScript with knowledge of available runtime
dtctl exec function --code 'console.log("Using SDK with", process.version)'
```
