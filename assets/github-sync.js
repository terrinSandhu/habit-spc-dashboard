/* GitHub CSV sync helpers.
   This intentionally keeps the token in localStorage on your own browser, not in source code.
*/
(function () {
  const SETTINGS_KEY = "habitSpc.githubSettings";

  function encodeBase64Unicode(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }

  function decodeBase64Unicode(str) {
    return decodeURIComponent(escape(atob(str.replace(/\n/g, ""))));
  }

  function inferGitHubPagesRepo() {
    const host = window.location.hostname;
    const pathParts = window.location.pathname.split("/").filter(Boolean);
    if (host.endsWith(".github.io")) {
      const owner = host.replace(".github.io", "");
      const repo = pathParts[0] || `${owner}.github.io`;
      return { owner, repo };
    }
    return { owner: "", repo: "" };
  }

  function getSettings() {
    const inferred = inferGitHubPagesRepo();
    const defaults = {
      owner: inferred.owner,
      repo: inferred.repo,
      branch: "main",
      dataPath: "data",
      token: ""
    };

    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
      return { ...defaults, ...saved };
    } catch {
      return defaults;
    }
  }

  function saveSettings(settings) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  function ensureCleanPath(path) {
    return path.replace(/^\/+|\/+$/g, "");
  }

  class GitHubCsvSync {
    constructor(settings) {
      this.settings = settings;
      this.apiBase = `https://api.github.com/repos/${settings.owner}/${settings.repo}/contents`;
    }

    headers() {
      const h = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"
      };
      if (this.settings.token) {
        h.Authorization = `Bearer ${this.settings.token}`;
      }
      return h;
    }

    filePath(filename) {
      const prefix = ensureCleanPath(this.settings.dataPath || "data");
      return `${prefix}/${filename}`;
    }

    async getFile(filename) {
      const path = this.filePath(filename);
      const url = `${this.apiBase}/${encodeURIComponent(path).replace(/%2F/g, "/")}?ref=${encodeURIComponent(this.settings.branch || "main")}`;
      const res = await fetch(url, { headers: this.headers() });
      if (!res.ok) {
        throw new Error(`GitHub read failed for ${path}: ${res.status} ${res.statusText}`);
      }
      const json = await res.json();
      return {
        path,
        sha: json.sha,
        content: decodeBase64Unicode(json.content || "")
      };
    }

    async putFile(filename, content, message) {
      if (!this.settings.token) {
        throw new Error("A GitHub token is required to write files.");
      }

      const path = this.filePath(filename);
      let sha = null;
      try {
        const current = await this.getFile(filename);
        sha = current.sha;
      } catch (err) {
        // If the file does not exist yet, create it without sha.
        sha = null;
      }

      const url = `${this.apiBase}/${encodeURIComponent(path).replace(/%2F/g, "/")}`;
      const body = {
        message,
        content: encodeBase64Unicode(content),
        branch: this.settings.branch || "main"
      };
      if (sha) body.sha = sha;

      const res = await fetch(url, {
        method: "PUT",
        headers: {
          ...this.headers(),
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`GitHub write failed for ${path}: ${res.status} ${res.statusText} ${txt}`);
      }

      return res.json();
    }

    async loadAll() {
      const files = ["variables.csv", "entries.csv", "meals.csv", "daily_rollups.csv"];
      const out = {};
      for (const file of files) {
        out[file] = (await this.getFile(file)).content;
      }
      return out;
    }

    async saveAll(fileMap) {
      const stamp = new Date().toISOString();
      const results = [];
      for (const [filename, content] of Object.entries(fileMap)) {
        const res = await this.putFile(filename, content, `Update ${filename} from SPC dashboard ${stamp}`);
        results.push(res);
      }
      return results;
    }
  }

  window.GitHubSync = {
    GitHubCsvSync,
    getSettings,
    saveSettings,
    inferGitHubPagesRepo
  };
})();
