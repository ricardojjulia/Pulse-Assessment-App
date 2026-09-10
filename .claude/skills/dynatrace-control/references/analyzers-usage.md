# Analyzers Usage

## Table of Contents
- [Overview](#overview)
- [List Analyzers](#list-analyzers)
- [Execute Analyzers](#execute-analyzers)
  - [Generic Forecast Analyzer](#generic-forecast-analyzer)
  - [Anomaly Detection Analyzers](#anomaly-detection-analyzers)
  - [Statistical Analyzers](#statistical-analyzers)
- [Output Formats](#output-formats)
- [Common Patterns](#common-patterns)
  - [Forecasting CPU Usage](#forecasting-cpu-usage)
  - [Detecting Error Spikes](#detecting-error-spikes)
  - [Capacity Planning](#capacity-planning)
- [Important Notes](#important-notes)

## Overview

Davis AI Analyzers provide advanced statistical analysis and forecasting capabilities. Analyzers can process time series data to detect anomalies, generate forecasts, and perform statistical analysis.

## List Analyzers

```bash
# List all available analyzers
dtctl get analyzers

# Get analyzer details
dtctl get analyzer <analyzer-id>

# List with descriptions
dtctl get analyzers -o wide
```

## Execute Analyzers

### Generic Forecast Analyzer

Generate forecasts from time series data:

```bash
# Basic forecast
dtctl exec analyzer dt.statistics.GenericForecastAnalyzer \
  --query "timeseries avg(dt.host.cpu.usage)" \
  -o chart

# Forecast with specific timeframe
dtctl exec analyzer dt.statistics.GenericForecastAnalyzer \
  --query "timeseries avg(dt.service.response.time), by: {service.name}" \
  -o json

# Forecast with custom parameters
dtctl exec analyzer dt.statistics.GenericForecastAnalyzer \
  --query "timeseries sum(dt.errors.count)" \
  --input '{"timeSeriesData": {"horizon": "24h", "confidence": 0.95}}' \
  -o chart
```

### Anomaly Detection Analyzers

Detect anomalies in time series:

```bash
# Detect anomalies in metrics
dtctl exec analyzer dt.statistics.anomaly_detection.AutoAdaptiveAnomalyDetectionAnalyzer \
  --query "timeseries avg(dt.host.memory.usage)" \
  -o json

# Analyze error rate patterns
dtctl exec analyzer dt.statistics.anomaly_detection.AutoAdaptiveAnomalyDetectionAnalyzer \
  --query "timeseries rate(dt.errors.count)" \
  -o chart
```

### Statistical Analyzers

Perform statistical analysis:

```bash
# Calculate statistical summary
dtctl exec analyzer dt.statistics.GenericForecastAnalyzer \
  --query "timeseries avg(dt.host.cpu.usage)" \
  -o json

# Correlation analysis
dtctl exec analyzer dt.statistics.CorrelationAnalyzer \
  --query "timeseries {avg(dt.host.cpu.usage), avg(dt.host.memory.usage)}" \
  -o table
```

## Output Formats

Analyzers support multiple output formats:

```bash
# JSON output (for programmatic use)
dtctl exec analyzer <analyzer-id> --query "<dql>" -o json

# Chart output (ASCII visualization)
dtctl exec analyzer <analyzer-id> --query "<dql>" -o chart

# Table output (human-readable)
dtctl exec analyzer <analyzer-id> --query "<dql>" -o table

# CSV output (for exports)
dtctl exec analyzer <analyzer-id> --query "<dql>" -o csv
```

## Common Patterns

### Forecasting CPU Usage

```bash
dtctl exec analyzer dt.statistics.GenericForecastAnalyzer \
  --query "timeseries avg(dt.host.cpu.usage), by: {host.name}" \
  --input '{"timeSeriesData": {"horizon": "6h"}}' \
  -o chart
```

### Detecting Error Spikes

```bash
dtctl exec analyzer dt.statistics.anomaly_detection.AutoAdaptiveAnomalyDetectionAnalyzer \
  --query "timeseries sum(dt.errors.count), by: {service.name}" \
  -o json | jq '.result.output[].raisedAlerts'
```

### Capacity Planning

```bash
dtctl exec analyzer dt.statistics.GenericForecastAnalyzer \
  --query "timeseries avg(dt.host.disk.usage)" \
  --input '{"timeSeriesData": {"horizon": "7d", "confidence": 0.90}}' \
  -o json
```

## Important Notes

- Analyzers require time series data (use `timeseries` in DQL queries)
- Some analyzers accept custom parameters via `--input` JSON
- Chart output (`-o chart`) provides ASCII visualization
- Forecast horizon and confidence intervals are analyzer-specific
- Check analyzer details with `dtctl get analyzer <id>` for available parameters
