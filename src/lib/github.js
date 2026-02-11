import { mustEnv } from "./config.js";
import { base64ToText, textToBase64 } from "./base64.js";

export async function listApps(env) {
  const res = await githubRequest(env, `/repos/${ownerRepo(env)}/contents/apps`, {
    method: "GET"
  }, { allow404: true });

  if (res.status === 404) {
    return [];
  }

  const items = await res.json();
  return items.filter((item) => item.type === "dir").map((item) => item.name).sort();
}

export async function readGitHubTextFile(env, path) {
  const res = await githubRequest(env, `/repos/${ownerRepo(env)}/contents/${path}`, {
    method: "GET"
  }, { allow404: true });

  if (res.status === 404) {
    return null;
  }

  const file = await res.json();
  if (!file.content) {
    return null;
  }

  return base64ToText(file.content);
}

export async function readGitHubJsonFile(env, path) {
  const text = await readGitHubTextFile(env, path);
  if (!text) {
    return null;
  }
  return JSON.parse(text);
}

export async function writeGitHubTextFile(env, { path, content, message }) {
  let sha;
  const existing = await githubRequest(env, `/repos/${ownerRepo(env)}/contents/${path}`, {
    method: "GET"
  }, { allow404: true });

  if (existing.status !== 404) {
    const json = await existing.json();
    sha = json.sha;
  }

  const payload = {
    message,
    content: textToBase64(content),
    branch: env.GITHUB_BRANCH || "main"
  };

  if (sha) {
    payload.sha = sha;
  }

  await githubRequest(env, `/repos/${ownerRepo(env)}/contents/${path}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export async function deleteGitHubFile(env, { path, message }) {
  const existing = await githubRequest(env, `/repos/${ownerRepo(env)}/contents/${path}`, {
    method: "GET"
  }, { allow404: true });

  if (existing.status === 404) {
    return false;
  }

  const json = await existing.json();
  const sha = json?.sha;
  if (!sha) {
    throw new Error(`Missing sha for ${path}`);
  }

  await githubRequest(env, `/repos/${ownerRepo(env)}/contents/${path}`, {
    method: "DELETE",
    body: JSON.stringify({
      message,
      sha,
      branch: env.GITHUB_BRANCH || "main"
    })
  });

  return true;
}

function ownerRepo(env) {
  const owner = env.GITHUB_DATA_OWNER;
  const repo = env.GITHUB_DATA_REPO;
  if (!owner || !repo) {
    throw new Error("Missing storage repo config: set GITHUB_DATA_OWNER and GITHUB_DATA_REPO");
  }
  return `${owner}/${repo}`;
}

async function githubRequest(env, path, init, options = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${mustEnv(env, "GITHUB_PAT")}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "vibespace",
      ...(init?.headers || {})
    }
  });

  if (!res.ok && !(options.allow404 && res.status === 404)) {
    const detail = await res.text();
    throw new Error(`GitHub API ${res.status}: ${detail}`);
  }

  return res;
}

export function appHtmlPath(appId) {
  return `apps/${appId}/index.html`;
}

export function appKvPath(appId) {
  return `apps/${appId}/kv.json`;
}
