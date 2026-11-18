import type { CollectedItem, Collector } from "./base.js";

type GhRepo = {
  full_name: string;
  html_url: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  default_branch?: string;
  topics?: string[];
};

const UA = {
  Accept: "application/vnd.github+json",
  "User-Agent": "pac-collector/1.0",
  "X-GitHub-Api-Version": "2022-11-28",
};

function stripMarkdownNoise(md: string): string {
  return md
    .replace(/!\[[^\]]*]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 拉取仓库 README 正文，供 AI 翻译总结 */
export async function fetchGithubReadme(fullName: string): Promise<string> {
  const api = `https://api.github.com/repos/${fullName}/readme`;
  const res = await fetch(api, {
    headers: { ...UA, Accept: "application/vnd.github.raw" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) return "";
  const text = await res.text();
  return stripMarkdownNoise(text).slice(0, 8000);
}

export async function enrichGithubContent(input: {
  title: string;
  url?: string | null;
  content?: string | null;
}): Promise<string> {
  const url = input.url || "";
  const m = url.match(/github\.com\/([^/]+)\/([^/#?]+)/i);
  if (!m) return input.content || "";

  const fullName = `${m[1]}/${m[2].replace(/\.git$/, "")}`;
  try {
    const readme = await fetchGithubReadme(fullName);
    if (!readme) return input.content || "";
    return [
      input.content || "",
      "",
      "--- README ---",
      readme,
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, 10000);
  } catch {
    return input.content || "";
  }
}

/**
 * GitHub 趋势近似：近 N 天高 star 仓库 + README 正文。
 */
export const githubTrendingCollector: Collector = {
  type: "github_trending",
  async collect(config) {
    const language = String(config.language || "");
    const sinceDays = Number(config.sinceDays || 7);
    const maxRepos = Math.min(Number(config.maxRepos || 12), 20);
    const fetchReadme = config.fetchReadme !== false;
    const since = new Date();
    since.setDate(since.getDate() - Math.max(1, sinceDays));
    const day = since.toISOString().slice(0, 10);

    const parts = [`created:>${day}`];
    if (language) parts.push(`language:${language}`);
    const q = parts.join(" ");

    const api =
      `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}` +
      `&sort=stars&order=desc&per_page=${maxRepos}`;

    const res = await fetch(api, {
      headers: UA,
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      throw new Error(`GitHub Search ${res.status}`);
    }

    const data = (await res.json()) as { items?: GhRepo[] };
    const repos = (data.items || []).slice(0, maxRepos);
    const items: CollectedItem[] = [];

    for (const repo of repos) {
      const meta = [
        repo.description || "",
        repo.language ? `Language: ${repo.language}` : "",
        `Stars: ${repo.stargazers_count}`,
        `Forks: ${repo.forks_count}`,
        repo.topics?.length ? `Topics: ${repo.topics.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      let readme = "";
      if (fetchReadme) {
        try {
          readme = await fetchGithubReadme(repo.full_name);
        } catch {
          readme = "";
        }
      }

      const content = readme
        ? `${meta}\n\n--- README ---\n${readme}`
        : `${meta}\n\n(未获取到 README，仅有仓库简介)`;

      items.push({
        externalId: repo.html_url,
        title: repo.full_name,
        url: repo.html_url,
        content,
        raw: { ...repo, kind: "github_repo", hasReadme: Boolean(readme) },
      });
    }

    return items;
  },
};
