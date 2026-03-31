#!/usr/bin/env python3
"""Static security analysis using bandit and semgrep."""

import json
import subprocess
import sys
import os


def run_bandit(target_path):
    """Run bandit on Python files."""
    try:
        result = subprocess.run(
            ["bandit", "-r", "-f", "json", "-ll", target_path],
            capture_output=True, text=True, timeout=120
        )
        if result.stdout:
            data = json.loads(result.stdout)
            return {
                "tool": "bandit",
                "metrics": data.get("metrics", {}),
                "results": [
                    {
                        "severity": r["issue_severity"],
                        "confidence": r["issue_confidence"],
                        "issue": r["issue_text"],
                        "cwe": r.get("issue_cwe", {}).get("id", "N/A"),
                        "file": r["filename"],
                        "line": r["line_number"],
                        "code": r.get("code", "").strip(),
                        "test_id": r["test_id"],
                    }
                    for r in data.get("results", [])
                ],
            }
        return {"tool": "bandit", "results": [], "note": "No issues found"}
    except FileNotFoundError:
        return {"tool": "bandit", "error": "bandit not installed"}
    except subprocess.TimeoutExpired:
        return {"tool": "bandit", "error": "timeout after 120s"}
    except Exception as e:
        return {"tool": "bandit", "error": str(e)}


def run_semgrep(target_path):
    """Run semgrep with security rulesets."""
    try:
        result = subprocess.run(
            [
                "semgrep", "scan",
                "--config", "auto",
                "--json",
                "--timeout", "60",
                target_path,
            ],
            capture_output=True, text=True, timeout=180
        )
        if result.stdout:
            data = json.loads(result.stdout)
            return {
                "tool": "semgrep",
                "results": [
                    {
                        "rule": r.get("check_id", "unknown"),
                        "severity": r.get("extra", {}).get("severity", "unknown"),
                        "message": r.get("extra", {}).get("message", ""),
                        "file": r.get("path", ""),
                        "start_line": r.get("start", {}).get("line", 0),
                        "end_line": r.get("end", {}).get("line", 0),
                        "code": r.get("extra", {}).get("lines", "").strip(),
                        "cwe": r.get("extra", {}).get("metadata", {}).get("cwe", []),
                        "owasp": r.get("extra", {}).get("metadata", {}).get("owasp", []),
                    }
                    for r in data.get("results", [])
                ],
                "errors": [str(e) for e in data.get("errors", [])[:5]],
            }
        return {"tool": "semgrep", "results": [], "note": "No issues found"}
    except FileNotFoundError:
        return {"tool": "semgrep", "error": "semgrep not installed"}
    except subprocess.TimeoutExpired:
        return {"tool": "semgrep", "error": "timeout after 180s"}
    except Exception as e:
        return {"tool": "semgrep", "error": str(e)}


def run_pattern_scan(target_path):
    """Custom regex-based security pattern scanner for any language."""
    import re

    patterns = {
        "hardcoded_secret": {
            "pattern": r'(?i)(password|secret|api_key|apikey|token|private_key)\s*[=:]\s*["\'][^"\']{8,}["\']',
            "severity": "HIGH",
            "cwe": "CWE-798",
            "description": "Hardcoded secret or credential",
        },
        "sql_injection": {
            "pattern": r'(?i)(execute|cursor\.execute|query|raw_query)\s*\(\s*[f"\'].*(%s|\{|\.format|\+\s*\w)',
            "severity": "HIGH",
            "cwe": "CWE-89",
            "description": "Potential SQL injection",
        },
        "command_injection": {
            "pattern": r'(?i)(os\.system|subprocess\.call|subprocess\.Popen|exec\(|eval\(|os\.popen)\s*\(',
            "severity": "HIGH",
            "cwe": "CWE-78",
            "description": "Potential command injection",
        },
        "path_traversal": {
            "pattern": r'(?i)(open\(|read\(|write\(|Path\().*(\+|\.format|f["\'])',
            "severity": "MEDIUM",
            "cwe": "CWE-22",
            "description": "Potential path traversal",
        },
        "weak_crypto": {
            "pattern": r'(?i)(md5|sha1|DES|RC4)\s*[\(.]',
            "severity": "MEDIUM",
            "cwe": "CWE-327",
            "description": "Weak cryptographic algorithm",
        },
        "insecure_deserialization": {
            "pattern": r'(?i)(pickle\.loads?|yaml\.load\s*\((?!.*Loader)|marshal\.loads?|shelve\.open)',
            "severity": "HIGH",
            "cwe": "CWE-502",
            "description": "Insecure deserialization",
        },
        "ssrf": {
            "pattern": r'(?i)(requests\.(get|post|put|delete|patch)|urllib\.request\.urlopen|http\.client)\s*\(.*(\+|\.format|f["\'])',
            "severity": "HIGH",
            "cwe": "CWE-918",
            "description": "Potential SSRF vulnerability",
        },
        "xss": {
            "pattern": r'(?i)(innerHTML|document\.write|\.html\(|render_template_string|Markup\()',
            "severity": "MEDIUM",
            "cwe": "CWE-79",
            "description": "Potential XSS vulnerability",
        },
        "debug_enabled": {
            "pattern": r'(?i)(DEBUG\s*=\s*True|app\.debug\s*=\s*True|debug=True)',
            "severity": "LOW",
            "cwe": "CWE-489",
            "description": "Debug mode enabled",
        },
    }

    results = []
    for root, _, files in os.walk(target_path):
        for fname in files:
            if not fname.endswith(('.py', '.js', '.ts', '.jsx', '.tsx', '.java', '.go', '.rb', '.php', '.rs', '.c', '.cpp', '.cs')):
                continue
            fpath = os.path.join(root, fname)
            try:
                with open(fpath, 'r', errors='ignore') as f:
                    lines = f.readlines()
                for i, line in enumerate(lines, 1):
                    for name, pattern_info in patterns.items():
                        if re.search(pattern_info["pattern"], line):
                            results.append({
                                "pattern": name,
                                "severity": pattern_info["severity"],
                                "cwe": pattern_info["cwe"],
                                "description": pattern_info["description"],
                                "file": fpath,
                                "line": i,
                                "code": line.strip()[:200],
                            })
            except Exception:
                continue

    return {"tool": "pattern_scanner", "results": results}


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "/workspace"

    report = {
        "target": target,
        "bandit": run_bandit(target),
        "semgrep": run_semgrep(target),
        "patterns": run_pattern_scan(target),
    }

    total = (
        len(report["bandit"].get("results", []))
        + len(report["semgrep"].get("results", []))
        + len(report["patterns"].get("results", []))
    )
    report["summary"] = {"total_findings": total}

    print(json.dumps(report, indent=2))
