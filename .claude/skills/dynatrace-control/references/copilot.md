# Davis CoPilot Integration

## Table of Contents
- [Main Command: Interactive Chat](#main-command-interactive-chat)
- [Subcommand: document-search](#subcommand-document-search)
- [Subcommand: dql2nl](#subcommand-dql2nl)
- [Subcommand: nl2dql](#subcommand-nl2dql)

Davis CoPilot provides AI-powered assistance for Dynatrace operations, accessible via `dtctl exec copilot`.

## Main Command: Interactive Chat

Ask Davis CoPilot questions about your environment, get troubleshooting help, or analyze issues.

```bash
# Ask a question
dtctl exec copilot "What caused the CPU spike on host-123?"

# Stream response in real-time
dtctl exec copilot "Explain the recent errors" --stream

# Read question from file
dtctl exec copilot -f question.txt

# Provide additional context
dtctl exec copilot "Analyze this" --context "Error logs from production"

# Disable Dynatrace documentation retrieval
dtctl exec copilot "What is DQL?" --no-docs

# Add formatting instructions
dtctl exec copilot "List top errors" --instruction "Answer in bullet points"
```

**Key flags:**
- `--stream` - Stream response in real-time (useful for long responses)
- `--context` - Provide additional context for the conversation
- `-f` - Read message from file instead of command line
- `--instruction` - Add formatting instructions (e.g., "Answer in bullet points", "Be concise")
- `--no-docs` - Disable Dynatrace documentation retrieval (faster, but less comprehensive)

## Subcommand: document-search

Search for relevant notebooks and dashboards using semantic search.

```bash
# Search notebooks about CPU performance
dtctl exec copilot document-search "CPU performance" --collections notebooks

# Search across multiple collections
dtctl exec copilot document-search "error monitoring" --collections dashboards,notebooks

# Exclude specific documents
dtctl exec copilot document-search "performance" --exclude doc-123,doc-456

# Output as JSON
dtctl exec copilot document-search "kubernetes" --collections notebooks -o json
```

**Flags:**
- `--collections` - Document collections to search (dashboards, notebooks)
- `--exclude` - Document IDs to exclude from results

## Subcommand: dql2nl

Explain DQL queries in natural language - useful for understanding complex queries.

```bash
# Explain a DQL query
dtctl exec copilot dql2nl "fetch logs | filter status='ERROR' | limit 10"

# Read query from file
dtctl exec copilot dql2nl -f query.dql

# Get explanation as JSON
dtctl exec copilot dql2nl "fetch logs | limit 10" -o json
```

**Use cases:**
- Understand inherited or complex DQL queries
- Document query logic for team members
- Learn DQL patterns and best practices

## Subcommand: nl2dql

Generate DQL queries from natural language descriptions.

```bash
# Generate DQL from natural language
dtctl exec copilot nl2dql "show me error logs from the last hour"

# Read prompt from file
dtctl exec copilot nl2dql -f prompt.txt

# Output as JSON (includes messageToken for feedback)
dtctl exec copilot nl2dql "find hosts with high CPU" -o json
```

**Use cases:**
- Quickly prototype DQL queries without manual syntax
- Learn DQL by seeing examples
- Generate queries for repetitive analysis tasks

**Workflow example:**
```bash
# Generate query from natural language
dtctl exec copilot nl2dql "Find error logs from last 24 hours" > generated.dql

# Review and execute the query
dtctl query -f generated.dql

# If needed, ask for explanation
dtctl exec copilot dql2nl -f generated.dql
```
