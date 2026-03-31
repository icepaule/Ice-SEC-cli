#!/usr/bin/env python3
"""Full security scan - runs all analysis tools and produces a combined report."""

import json
import subprocess
import sys
import os


def run_script(script_name, target):
    """Run an analysis script and return its JSON output."""
    script_path = os.path.join("/opt/scripts", script_name)
    try:
        result = subprocess.run(
            ["python3", script_path, target],
            capture_output=True, text=True, timeout=300
        )
        if result.stdout:
            return json.loads(result.stdout)
        return {"error": f"No output from {script_name}", "stderr": result.stderr[:500]}
    except subprocess.TimeoutExpired:
        return {"error": f"{script_name} timed out after 300s"}
    except Exception as e:
        return {"error": str(e)}


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "/workspace"

    print(json.dumps({"status": "starting", "target": target}), flush=True)

    report = {
        "target": target,
        "scan_type": "full",
        "code_analysis": run_script("analyze_code.py", target),
        "dependency_scan": run_script("scan_deps.py", target),
        "secret_detection": run_script("detect_secrets.py", target),
    }

    # Aggregate summary
    total_findings = 0
    total_critical = 0
    total_high = 0

    for section in ["code_analysis", "dependency_scan", "secret_detection"]:
        data = report[section]
        if "summary" in data:
            total_findings += data["summary"].get("total_findings",
                             data["summary"].get("total_vulnerable_dependencies",
                             data["summary"].get("total", 0)))
        # Count critical/high from nested results
        for key in data:
            if isinstance(data[key], dict) and "results" in data[key]:
                for r in data[key]["results"]:
                    sev = r.get("severity", "").upper()
                    if sev == "CRITICAL":
                        total_critical += 1
                    elif sev == "HIGH":
                        total_high += 1

    report["summary"] = {
        "total_findings": total_findings,
        "critical": total_critical,
        "high": total_high,
        "verdict": "CRITICAL" if total_critical > 0 else "HIGH" if total_high > 0 else "OK" if total_findings == 0 else "REVIEW",
    }

    print(json.dumps(report, indent=2))
