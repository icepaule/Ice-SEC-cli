#!/usr/bin/env python3
"""Dependency vulnerability scanning."""

import json
import subprocess
import sys
import os


def scan_python_deps(target_path):
    """Scan Python dependencies using pip-audit."""
    req_files = []
    for root, _, files in os.walk(target_path):
        for f in files:
            if f in ("requirements.txt", "requirements-dev.txt", "requirements-test.txt"):
                req_files.append(os.path.join(root, f))

    # Also check for setup.py, pyproject.toml
    for root, _, files in os.walk(target_path):
        for f in files:
            if f in ("setup.py", "pyproject.toml", "Pipfile.lock", "poetry.lock"):
                req_files.append(os.path.join(root, f))

    if not req_files:
        return {"tool": "pip-audit", "results": [], "note": "No Python dependency files found"}

    all_results = []
    for req_file in req_files:
        if not req_file.endswith(".txt"):
            continue
        try:
            result = subprocess.run(
                ["pip-audit", "-r", req_file, "-f", "json", "--progress-spinner", "off"],
                capture_output=True, text=True, timeout=120
            )
            if result.stdout:
                data = json.loads(result.stdout)
                for dep in data.get("dependencies", []):
                    for vuln in dep.get("vulns", []):
                        all_results.append({
                            "source": req_file,
                            "package": dep["name"],
                            "installed_version": dep.get("version", "unknown"),
                            "vuln_id": vuln.get("id", "unknown"),
                            "fix_versions": vuln.get("fix_versions", []),
                            "description": vuln.get("description", "")[:300],
                        })
        except Exception as e:
            all_results.append({"source": req_file, "error": str(e)})

    return {"tool": "pip-audit", "files_scanned": req_files, "results": all_results}


def scan_npm_deps(target_path):
    """Check for known vulnerable npm packages by parsing package-lock.json."""
    results = []
    for root, _, files in os.walk(target_path):
        if "package-lock.json" in files:
            lock_path = os.path.join(root, "package-lock.json")
            try:
                with open(lock_path) as f:
                    data = json.load(f)

                # Known vulnerable package patterns
                vulnerable_patterns = {
                    "lodash": {"before": "4.17.21", "cve": "CVE-2021-23337", "severity": "HIGH"},
                    "minimist": {"before": "1.2.6", "cve": "CVE-2021-44906", "severity": "MEDIUM"},
                    "glob-parent": {"before": "5.1.2", "cve": "CVE-2020-28469", "severity": "HIGH"},
                    "json5": {"before": "2.2.2", "cve": "CVE-2022-46175", "severity": "HIGH"},
                    "semver": {"before": "7.5.2", "cve": "CVE-2022-25883", "severity": "MEDIUM"},
                    "word-wrap": {"before": "1.2.4", "cve": "CVE-2023-26115", "severity": "MEDIUM"},
                }

                deps = data.get("dependencies", data.get("packages", {}))
                for pkg_name, pkg_info in deps.items():
                    clean_name = pkg_name.replace("node_modules/", "").split("/")[-1]
                    if clean_name in vulnerable_patterns:
                        version = pkg_info.get("version", "0.0.0")
                        vuln = vulnerable_patterns[clean_name]
                        results.append({
                            "source": lock_path,
                            "package": clean_name,
                            "version": version,
                            "cve": vuln["cve"],
                            "severity": vuln["severity"],
                            "fix": f"Update to >= {vuln['before']}",
                        })
            except Exception as e:
                results.append({"source": lock_path, "error": str(e)})

    if not results:
        return {"tool": "npm-scan", "results": [], "note": "No vulnerable npm packages detected (basic check)"}
    return {"tool": "npm-scan", "results": results}


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "/workspace"

    report = {
        "target": target,
        "python": scan_python_deps(target),
        "npm": scan_npm_deps(target),
    }

    total = len(report["python"].get("results", [])) + len(report["npm"].get("results", []))
    report["summary"] = {"total_vulnerable_dependencies": total}

    print(json.dumps(report, indent=2))
