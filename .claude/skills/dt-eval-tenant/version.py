"""
Version management for the /dt-eval-* skill family.

Provides a single source of truth for the monorepo version, read from VERSION
file at the repo root. This version is included in all generated reports and
can be used for git tagging.

Usage:
  from version import __version__, get_version
  
  print(__version__)              # "1.0.0"
  print(get_version())            # "1.0.0" (same, with path resolution)
  print(get_version(raw=True))    # "1.0.0" (no whitespace)
"""

import os
import pathlib

__version__ = "1.0.0"  # Fallback version if VERSION file not found


def get_repo_root():
    """Get the absolute path to the monorepo root."""
    # VERSION file is at <repo-root>/VERSION
    # This module is at <repo-root>/.claude/skills/dt-eval-tenant/version.py
    current_file = pathlib.Path(__file__)
    repo_root = current_file.parent.parent.parent.parent  # Go up 4 levels
    return repo_root


def get_version(raw=True):
    """
    Read version from VERSION file in repo root.
    
    Args:
        raw: If True, strip whitespace. If False, return as-is.
    
    Returns:
        Version string (e.g., "1.0.0")
    
    Raises:
        FileNotFoundError: If VERSION file cannot be found in the expected locations.
    """
    # Try to find VERSION file
    locations = [
        get_repo_root() / "VERSION",
        pathlib.Path(__file__).parent.parent.parent.parent / "VERSION",
        pathlib.Path.cwd() / "VERSION",
    ]
    
    for version_file in locations:
        if version_file.exists():
            with open(version_file, "r") as f:
                version = f.read()
            return version.strip() if raw else version
    
    # Fallback: return hardcoded version if file not found
    # (graceful degradation in edge cases)
    return __version__


if __name__ == "__main__":
    # Quick test
    print(f"Version: {get_version()}")
    print(f"Version (raw): {get_version(raw=True)}")
