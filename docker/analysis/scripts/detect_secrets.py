#!/usr/bin/env python3
"""Secret and credential detection in source code."""

import json
import os
import re
import sys


# High-entropy string detection
def shannon_entropy(data):
    """Calculate Shannon entropy of a string."""
    import math
    if not data:
        return 0
    entropy = 0
    for x in range(256):
        p_x = data.count(chr(x)) / len(data)
        if p_x > 0:
            entropy -= p_x * math.log2(p_x)
    return entropy


# Secret patterns
SECRET_PATTERNS = {
    "aws_access_key": {
        "pattern": r'(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}',
        "severity": "CRITICAL",
        "description": "AWS Access Key ID",
    },
    "aws_secret_key": {
        "pattern": r'(?i)aws_secret_access_key\s*[=:]\s*["\']?[A-Za-z0-9/+=]{40}',
        "severity": "CRITICAL",
        "description": "AWS Secret Access Key",
    },
    "github_token": {
        "pattern": r'gh[pousr]_[A-Za-z0-9_]{36,255}',
        "severity": "CRITICAL",
        "description": "GitHub Personal Access Token",
    },
    "generic_api_key": {
        "pattern": r'(?i)(api[_-]?key|apikey)\s*[=:]\s*["\']?[A-Za-z0-9_\-]{20,}',
        "severity": "HIGH",
        "description": "Generic API Key",
    },
    "private_key": {
        "pattern": r'-----BEGIN (RSA |DSA |EC |OPENSSH )?PRIVATE KEY-----',
        "severity": "CRITICAL",
        "description": "Private Key",
    },
    "jwt_token": {
        "pattern": r'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}',
        "severity": "HIGH",
        "description": "JWT Token",
    },
    "password_in_url": {
        "pattern": r'[a-zA-Z]+://[^/\s:]+:[^/\s@]+@',
        "severity": "HIGH",
        "description": "Password in URL",
    },
    "slack_token": {
        "pattern": r'xox[baprs]-[0-9a-zA-Z-]{10,}',
        "severity": "HIGH",
        "description": "Slack Token",
    },
    "google_api_key": {
        "pattern": r'AIza[0-9A-Za-z_-]{35}',
        "severity": "HIGH",
        "description": "Google API Key",
    },
    "heroku_api_key": {
        "pattern": r'(?i)heroku.*[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}',
        "severity": "HIGH",
        "description": "Heroku API Key",
    },
    "generic_secret": {
        "pattern": r'(?i)(secret|password|passwd|pwd|token|credential)\s*[=:]\s*["\'][^"\']{8,}["\']',
        "severity": "MEDIUM",
        "description": "Generic Secret/Password Assignment",
    },
    "connection_string": {
        "pattern": r'(?i)(mongodb|postgres|mysql|redis|amqp)://[^\s"\']+',
        "severity": "HIGH",
        "description": "Database Connection String",
    },
}

# Files to skip
SKIP_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.woff', '.woff2',
                   '.ttf', '.eot', '.mp3', '.mp4', '.avi', '.zip', '.gz', '.tar',
                   '.pyc', '.pyo', '.class', '.o', '.so', '.dll', '.exe', '.bin'}
SKIP_DIRS = {'node_modules', '.git', '__pycache__', '.venv', 'venv', 'dist', 'build',
             '.tox', '.eggs', '*.egg-info'}


def scan_file(filepath):
    """Scan a single file for secrets."""
    findings = []
    try:
        with open(filepath, 'r', errors='ignore') as f:
            lines = f.readlines()

        for line_num, line in enumerate(lines, 1):
            for secret_type, info in SECRET_PATTERNS.items():
                matches = re.finditer(info["pattern"], line)
                for match in matches:
                    # Check if this is likely a placeholder/example
                    matched_text = match.group()
                    lower = matched_text.lower()
                    if any(p in lower for p in ['example', 'placeholder', 'your_', 'xxx', 'changeme', 'todo']):
                        continue

                    findings.append({
                        "type": secret_type,
                        "severity": info["severity"],
                        "description": info["description"],
                        "file": filepath,
                        "line": line_num,
                        "match": matched_text[:80] + ("..." if len(matched_text) > 80 else ""),
                        "context": line.strip()[:150],
                    })

            # High-entropy string detection
            strings = re.findall(r'["\']([A-Za-z0-9+/=_-]{30,})["\']', line)
            for s in strings:
                entropy = shannon_entropy(s)
                if entropy > 4.5:
                    findings.append({
                        "type": "high_entropy_string",
                        "severity": "MEDIUM",
                        "description": f"High entropy string (entropy: {entropy:.2f})",
                        "file": filepath,
                        "line": line_num,
                        "match": s[:60] + "...",
                        "context": line.strip()[:150],
                    })

    except Exception:
        pass

    return findings


def scan_directory(target_path):
    """Scan entire directory for secrets."""
    all_findings = []
    files_scanned = 0

    for root, dirs, files in os.walk(target_path):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]

        for fname in files:
            ext = os.path.splitext(fname)[1].lower()
            if ext in SKIP_EXTENSIONS:
                continue

            fpath = os.path.join(root, fname)
            try:
                if os.path.getsize(fpath) > 1_000_000:  # Skip files > 1MB
                    continue
            except OSError:
                continue

            files_scanned += 1
            all_findings.extend(scan_file(fpath))

    return all_findings, files_scanned


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "/workspace"
    findings, files_scanned = scan_directory(target)

    # Group by severity
    by_severity = {}
    for f in findings:
        sev = f["severity"]
        by_severity.setdefault(sev, []).append(f)

    report = {
        "target": target,
        "tool": "secret_detector",
        "files_scanned": files_scanned,
        "results": findings,
        "summary": {
            "total": len(findings),
            "critical": len(by_severity.get("CRITICAL", [])),
            "high": len(by_severity.get("HIGH", [])),
            "medium": len(by_severity.get("MEDIUM", [])),
        },
    }

    print(json.dumps(report, indent=2))
