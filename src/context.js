import { readdirSync, statSync, existsSync, readFileSync } from 'fs';
import { join, basename } from 'path';
import { hostname, userInfo } from 'os';

/**
 * Detects project type and gathers context from the current working directory.
 */
export function detectProject(cwd) {
  const info = {
    cwd,
    hostname: hostname(),
    user: userInfo().username,
    type: 'unknown',
    languages: [],
    files: { total: 0, byExtension: {} },
    projectFiles: [],
  };

  // Project file indicators
  const indicators = {
    'package.json': 'node',
    'requirements.txt': 'python',
    'setup.py': 'python',
    'pyproject.toml': 'python',
    'Pipfile': 'python',
    'pom.xml': 'java-maven',
    'build.gradle': 'java-gradle',
    'build.gradle.kts': 'kotlin-gradle',
    'Cargo.toml': 'rust',
    'go.mod': 'go',
    'Gemfile': 'ruby',
    'composer.json': 'php',
    'Makefile': 'make',
    'CMakeLists.txt': 'cmake',
    'Dockerfile': 'docker',
    'docker-compose.yml': 'docker-compose',
    'docker-compose.yaml': 'docker-compose',
    '.terraform': 'terraform',
    'main.tf': 'terraform',
    'Vagrantfile': 'vagrant',
    'ansible.cfg': 'ansible',
  };

  const langByExt = {
    '.py': 'Python', '.js': 'JavaScript', '.ts': 'TypeScript', '.jsx': 'React',
    '.tsx': 'React/TS', '.java': 'Java', '.go': 'Go', '.rs': 'Rust',
    '.rb': 'Ruby', '.php': 'PHP', '.c': 'C', '.cpp': 'C++', '.cs': 'C#',
    '.swift': 'Swift', '.kt': 'Kotlin', '.scala': 'Scala', '.sh': 'Shell',
    '.yaml': 'YAML', '.yml': 'YAML', '.json': 'JSON', '.xml': 'XML',
    '.sql': 'SQL', '.html': 'HTML', '.css': 'CSS', '.scss': 'SCSS',
  };

  const skipDirs = new Set([
    'node_modules', '.git', '__pycache__', '.venv', 'venv', 'dist', 'build',
    'target', '.idea', '.vscode', '.tox', 'vendor', '.next', 'coverage',
  ]);

  try {
    const entries = readdirSync(cwd, { withFileTypes: true });
    const detectedTypes = [];

    for (const entry of entries) {
      if (indicators[entry.name]) {
        detectedTypes.push(indicators[entry.name]);
        info.projectFiles.push(entry.name);
      }
    }

    // Count files recursively (max 3 levels deep)
    function countFiles(dir, depth = 0) {
      if (depth > 3) return;
      try {
        const items = readdirSync(dir, { withFileTypes: true });
        for (const item of items) {
          if (item.isDirectory()) {
            if (!skipDirs.has(item.name) && !item.name.startsWith('.')) {
              countFiles(join(dir, item.name), depth + 1);
            }
          } else if (item.isFile()) {
            info.files.total++;
            const ext = item.name.includes('.') ? '.' + item.name.split('.').pop() : '';
            info.files.byExtension[ext] = (info.files.byExtension[ext] || 0) + 1;
          }
        }
      } catch { /* permission denied etc */ }
    }

    countFiles(cwd);

    // Determine languages
    const langs = new Set();
    for (const [ext, count] of Object.entries(info.files.byExtension)) {
      if (langByExt[ext] && count > 0) {
        langs.add(langByExt[ext]);
      }
    }
    info.languages = Array.from(langs);

    // Set project type
    if (detectedTypes.length > 0) {
      info.type = [...new Set(detectedTypes)].join(' + ');
    } else if (info.languages.length > 0) {
      info.type = info.languages[0].toLowerCase();
    }

    // Read project name from common config files
    for (const configFile of ['package.json', 'pyproject.toml', 'Cargo.toml']) {
      const configPath = join(cwd, configFile);
      if (existsSync(configPath)) {
        try {
          const content = readFileSync(configPath, 'utf-8');
          if (configFile === 'package.json') {
            const pkg = JSON.parse(content);
            info.projectName = pkg.name;
            info.projectVersion = pkg.version;
          }
        } catch { /* ignore */ }
        break;
      }
    }
  } catch { /* ignore */ }

  return info;
}

/**
 * Builds a context summary string for the LLM system prompt.
 */
export function buildContextSummary(projectInfo) {
  const lines = [];
  lines.push(`Arbeitsverzeichnis: ${projectInfo.cwd}`);
  lines.push(`Host: ${projectInfo.hostname} (User: ${projectInfo.user})`);

  if (projectInfo.projectName) {
    lines.push(`Projekt: ${projectInfo.projectName}${projectInfo.projectVersion ? ' v' + projectInfo.projectVersion : ''}`);
  }
  if (projectInfo.type !== 'unknown') {
    lines.push(`Projekttyp: ${projectInfo.type}`);
  }
  if (projectInfo.languages.length > 0) {
    lines.push(`Sprachen: ${projectInfo.languages.join(', ')}`);
  }
  if (projectInfo.files.total > 0) {
    const top = Object.entries(projectInfo.files.byExtension)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([ext, count]) => `${ext || '(keine Ext.)'}:${count}`)
      .join(', ');
    lines.push(`Dateien: ${projectInfo.files.total} (${top})`);
  }
  if (projectInfo.projectFiles.length > 0) {
    lines.push(`Konfiguration: ${projectInfo.projectFiles.join(', ')}`);
  }

  return lines.join('\n');
}
