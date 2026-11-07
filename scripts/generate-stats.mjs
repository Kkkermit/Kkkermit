// Generates the dashboard graphics in the README from the GitHub API:
//   assets/dash-kpis.svg    stars, commits, pull requests and forks
//   assets/dash-charts.svg  stars by repository and the language split
// Runs inside GitHub Actions using the built-in GITHUB_TOKEN — no rate limits,
// no third-party service, no broken cards.
//
// Local dry run:  node scripts/generate-stats.mjs --mock

import { writeFile, mkdir } from "node:fs/promises";

const USER = process.env.GH_USER || "Kkkermit";
const TOKEN = process.env.GITHUB_TOKEN;
const MOCK = process.argv.includes("--mock");

const T = {
  panel: "#121216",
  line: "#26262C",
  text: "#EDEDEF",
  muted: "#8A8A93",
  faint: "#5E5E68",
  red: "#F43F5E",
  purple: "#8B5CF6",
  grey: "#A1A1AA",
  other: "#3A3A44",
};

const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans',Helvetica,Arial,sans-serif";

// Chart labels for repos whose names are too long for the bar chart.
const SHORT_NAMES = { "DiscordBotV14-template": "Bot template" };

/* ---------------------------------------------------------- data ---- */

async function gql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": USER,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

const YEARS_Q = `
  query($login: String!) {
    user(login: $login) {
      contributionsCollection { contributionYears }
    }
  }`;

const YEAR_Q = `
  query($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      contributionsCollection(from: $from, to: $to) {
        totalCommitContributions
        restrictedContributionsCount
      }
    }
  }`;

const MAIN_Q = `
  query($login: String!, $cursor: String) {
    user(login: $login) {
      pullRequests { totalCount }
      repositories(
        first: 100
        after: $cursor
        ownerAffiliations: OWNER
        isFork: false
        orderBy: { field: STARGAZERS, direction: DESC }
      ) {
        totalCount
        pageInfo { hasNextPage endCursor }
        nodes {
          name
          stargazerCount
          forkCount
          languages(first: 12, orderBy: { field: SIZE, direction: DESC }) {
            edges { size node { name } }
          }
        }
      }
    }
  }`;

async function collect() {
  if (MOCK) {
    // Snapshot of real numbers, so a dry run looks like the live graphics.
    return {
      stars: 170,
      commits: 1100,
      forks: 73,
      prs: 137,
      repos: 10,
      languages: [
        { name: "TypeScript", size: 934 },
        { name: "Python", size: 35 },
        { name: "JavaScript", size: 20 },
        { name: "Java", size: 7 },
        { name: "CSS", size: 4 },
      ],
      topRepos: [
        { name: "Testify", stars: 140 },
        { name: "DiscordBotV14-template", stars: 16 },
        { name: "Discord-RPC", stars: 3 },
        { name: "Statify", stars: 2 },
        { name: "jest-ts-example", stars: 2 },
      ],
    };
  }

  // All-time commits: contributionsCollection only spans one year at a time.
  const { user: yearsUser } = await gql(YEARS_Q, { login: USER });
  const years = yearsUser.contributionsCollection.contributionYears;

  let commits = 0;
  for (const y of years) {
    const { user } = await gql(YEAR_Q, {
      login: USER,
      from: `${y}-01-01T00:00:00Z`,
      to: `${y}-12-31T23:59:59Z`,
    });
    const c = user.contributionsCollection;
    commits += c.totalCommitContributions + c.restrictedContributionsCount;
  }

  let cursor = null;
  let stars = 0;
  let forks = 0;
  let repos = 0;
  let prs = 0;
  const langMap = new Map();
  const all = [];

  do {
    const { user } = await gql(MAIN_Q, { login: USER, cursor });
    prs = user.pullRequests.totalCount;
    repos = user.repositories.totalCount;

    for (const repo of user.repositories.nodes) {
      stars += repo.stargazerCount;
      forks += repo.forkCount;
      // the profile repo itself isn't a project worth charting
      if (repo.name !== USER) all.push({ name: repo.name, stars: repo.stargazerCount });
      for (const edge of repo.languages.edges) {
        const prev = langMap.get(edge.node.name) || { name: edge.node.name, size: 0 };
        prev.size += edge.size;
        langMap.set(edge.node.name, prev);
      }
    }

    cursor = user.repositories.pageInfo.hasNextPage
      ? user.repositories.pageInfo.endCursor
      : null;
  } while (cursor);

  const languages = [...langMap.values()].sort((a, b) => b.size - a.size);
  const topRepos = all.sort((a, b) => b.stars - a.stars).slice(0, 5);

  return { stars, commits, forks, prs, repos, languages, topRepos };
}

/* --------------------------------------------------------- render ---- */

const fmt = (n) =>
  n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "") + "k" : String(n);

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const label = (name) => {
  const s = SHORT_NAMES[name] || name;
  return s.length > 16 ? s.slice(0, 15) + "…" : s;
};

const shell = (w, h, title, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(title)}">
  <defs><style> .s { font-family:${SANS} } </style></defs>
  ${body}
</svg>
`;

const panel = (x, y, w, h) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="${T.panel}" stroke="${T.line}" stroke-width="2"/>`;

function kpis(d) {
  const W = 1000, H = 176, w = 232, gap = (W - 4 * w) / 3;
  const cells = [
    ["Stars", d.stars, `across ${d.repos} repos`],
    ["Commits", d.commits, "all time"],
    ["Pull requests", d.prs, "opened"],
    ["Forks", d.forks, "of my repos"],
  ];
  const body = cells
    .map(([name, value, sub], i) => {
      const x = i * (w + gap) + 1;
      return `${panel(x, 1, w - 2, H - 2)}
  <text class="s" x="${x + 24}" y="46" font-size="21" fill="${T.muted}">${name}</text>
  <text class="s" x="${x + 22}" y="112" font-size="56" font-weight="700" letter-spacing="-1.5" fill="${T.text}">${fmt(value)}</text>
  <text class="s" x="${x + 24}" y="148" font-size="18" fill="${T.faint}">${sub}</text>`;
    })
    .join("\n  ");
  return shell(W, H, "GitHub stats", body);
}

function charts(d) {
  const W = 1000, H = 380;

  const max = Math.max(1, ...d.topRepos.map((r) => r.stars));
  const bars = d.topRepos
    .map((r, i) => {
      const y = 104 + i * 50;
      const bw = Math.max(6, (r.stars / max) * 300);
      return `<text class="s" x="40" y="${y + 20}" font-size="21" fill="${T.grey}">${esc(label(r.name))}</text>
  <rect x="236" y="${y + 2}" width="${bw.toFixed(1)}" height="24" rx="5" fill="${i === 0 ? T.red : T.purple}"/>
  <text class="s" x="${(236 + bw + 12).toFixed(1)}" y="${y + 21}" font-size="20" fill="${T.muted}">${r.stars}</text>`;
    })
    .join("\n  ");

  // language donut: top three, the rest grouped as "Other"
  const total = d.languages.reduce((s, l) => s + l.size, 0) || 1;
  const top = d.languages.slice(0, 3).map((l) => [l.name, (l.size / total) * 100]);
  const other = Math.max(0, 100 - top.reduce((s, [, v]) => s + v, 0));
  const segs = [...top, ["Other", other]];
  const fills = [T.red, T.purple, T.grey, T.other];
  const cx = 734, cy = 214, R = 92, C = 2 * Math.PI * R;
  let acc = 0;
  const ring = segs
    .map(([, v], i) => {
      const len = (v / 100) * C;
      const s = `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${fills[i]}" stroke-width="30" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-acc).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"/>`;
      acc += len;
      return s;
    })
    .join("");
  const legend = segs
    .map(([name, v], i) => `<rect x="856" y="${142 + i * 40}" width="14" height="14" rx="3" fill="${fills[i]}"/>
  <text class="s" x="878" y="${155 + i * 40}" font-size="19" fill="${T.muted}">${esc(name)}</text>
  <text class="s" x="878" y="${175 + i * 40}" font-size="15" fill="${T.faint}">${v.toFixed(1)}%</text>`)
    .join("\n  ");

  const body = `${panel(1, 1, W - 2, H - 2)}
  <text class="s" x="40" y="62" font-size="24" font-weight="600" fill="${T.text}">Stars by repository</text>
  <path d="M620 32V348" stroke="${T.line}" stroke-width="2"/>
  <text class="s" x="654" y="62" font-size="24" font-weight="600" fill="${T.text}">Languages</text>
  ${bars}
  ${ring}
  <text class="s" x="${cx}" y="${cy + 6}" font-size="30" font-weight="700" fill="${T.text}" text-anchor="middle">${top[0] ? top[0][1].toFixed(0) : 0}%</text>
  <text class="s" x="${cx}" y="${cy + 32}" font-size="16" fill="${T.faint}" text-anchor="middle">${esc(top[0] ? top[0][0] : "")}</text>
  ${legend}`;
  return shell(W, H, "Stars by repository and language split", body);
}

/* ----------------------------------------------------------- main ---- */

const data = await collect();
await mkdir("assets", { recursive: true });
await writeFile("assets/dash-kpis.svg", kpis(data));
await writeFile("assets/dash-charts.svg", charts(data));
console.log("Wrote assets/dash-kpis.svg and assets/dash-charts.svg");
console.log(data.languages.slice(0, 4).map((l) => l.name).join(", "));
