"""
Example: Integrating version into a skill's report generation.

This shows how to import and use the version module from any skill.

Place this in any skill's Python entry point (e.g., dt-eval-consumption/run.py):
"""

# Add this to sys.path so we can import from the shared module
import sys
from pathlib import Path

# Get the shared skills directory
SKILLS_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(SKILLS_DIR / "dt-eval-tenant"))

# Import the version
from version import get_version

version = get_version()
print(f"Running skill with version: {version}")

# Embed in report metadata
# When creating a Word document (using python-docx):
# 
# from docx import Document
# 
# doc = Document()
# 
# # Add version to core properties
# doc.core_properties.comments = f"Skills Family v{version}"
# 
# # Add version to footer
# section = doc.sections[0]
# footer = section.footer.paragraphs[0]
# footer.text = f"v{version}"
# 
# doc.save("report.docx")

# For YAML or JSON serialization:
report_metadata = {
    "version": version,
    "timestamp": "2026-07-28T12:00:00Z",
    "tenant": "abc12345",
}

print(f"Report metadata: {report_metadata}")
