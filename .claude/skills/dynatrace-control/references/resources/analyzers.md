# Analyzers Resource

## Overview
Davis AI analyzers provide anomaly detection and analysis capabilities in Dynatrace.

## List Analyzers
```bash
dtctl get analyzers -o json --plain
```

## JSON Schema

Each analyzer object contains:

```json
{
  "name": "string (analyzer identifier)",
  "displayName": "string",
  "description": "string",
  "category": {
    "displayName": "string (category name)"
  },
  "type": "string (IMPLEMENTED|etc)"
}
```

## Key Fields

- **name**: Unique analyzer identifier (e.g., "dt.statistics.ui.anomaly_detection.AutoAdaptiveAnomalyDetectionAnalyzer")
- **displayName**: Human-readable analyzer name
- **description**: Analyzer description (may contain markdown links)
- **category.displayName**: Category of analysis (e.g., "Anomaly detection")
- **type**: Analyzer implementation type

## Common Operations

### List all analyzers
```bash
dtctl get analyzers
```

### Search by category
```bash
dtctl get analyzers -o json --plain | jq -r '.[] | select(.category.displayName | test("Anomaly"; "i")) | "\(.name) | \(.displayName)"'
```

### Filter by type
```bash
dtctl get analyzers -o json --plain | jq -r '.[] | select(.type=="IMPLEMENTED")'
```

## Important Notes

- Analyzer names use dot-notation namespacing (e.g., "dt.statistics.ui.*")
- Descriptions may contain markdown links to documentation
- Categories group related analyzers
