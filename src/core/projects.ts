import fs from 'node:fs/promises';
import path from 'node:path';
import { loadWorkspace } from './config.js';

/** projects 目录下的构建特征文件：命中其一即视为一个项目 */
const PROJECT_MARKERS = ['package.json', 'go.mod', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'tsconfig.json', 'Cargo.toml', 'pyproject.toml', 'Makefile'];

export interface Project {
  /** 项目名（projects/ 下的目录名） */
  name: string;
  /** 相对 workspace 根的路径（projects/<name>） */
  path: string;
}

/**
 * 扫描 workspace 的 projects 抽屉，列出全部项目目录。
 * 判定标准：目录下存在任一构建特征文件（package.json / go.mod / pom.xml 等）。
 */
export async function listProjects(root: string): Promise<Project[]> {
  const workspace = await loadWorkspace(root);
  const projectsDir = path.join(root, workspace.paths.projects);
  const entries = await fs.readdir(projectsDir, { withFileTypes: true }).catch(() => []);
  const projects: Project[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(projectsDir, entry.name);
    let isProject = false;
    for (const marker of PROJECT_MARKERS) {
      if (await fs.stat(path.join(dir, marker)).then(() => true).catch(() => false)) {
        isProject = true;
        break;
      }
    }
    if (isProject) {
      projects.push({ name: entry.name, path: `${workspace.paths.projects}/${entry.name}` });
    }
  }
  return projects.sort((a, b) => a.name.localeCompare(b.name));
}
