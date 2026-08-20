// Generates assets/stats.svg and assets/languages.svg from the GitHub API.
// Runs inside GitHub Actions using the built-in GITHUB_TOKEN — no rate limits,
// no third-party service, no broken cards.
//
// Local dry run:  node scripts/generate-stats.mjs --mock

import { writeFile, mkdir } from "node:fs/promises";

const USER = process.env.GH_USER || "Kkkermit";
const TOKEN = process.env.GITHUB_TOKEN;
const MOCK = process.argv.includes("--mock");

const T = {
  bg: "#0D1117",
  panel: "#0F1720",
  border: "#21332A",
  text: "#E6EDF3",
  muted: "#8B949E",
  green: "#3FB950",
  mint: "#7EE787",
};

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
      followers { totalCount }
      pullRequests { totalCount }
      issues { totalCount }
      repositoriesContributedTo(
        contributionTypes: [COMMIT, PULL_REQUEST, REPOSITORY]
      ) { totalCount }
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
          stargazerCount
          primaryLanguage { name }
          languages(first: 12, orderBy: { field: SIZE, direction: DESC }) {
            edges { size node { name color } }
          }
        }
      }
    }
  }`;

async function collect() {
  if (MOCK) {
    return {
      stars: 168,
      commits: 4127,
      prs: 96,
      issues: 41,
      contributedTo: 12,
      repos: 38,
      followers: 214,
      languages: [
        { name: "TypeScript", color: "#3178c6", size: 412000 },
        { name: "JavaScript", color: "#f1e05a", size: 388000 },
        { name: "Java", color: "#b07219", size: 96000 },
        { name: "CSS", color: "#563d7c", size: 74000 },
        { name: "HTML", color: "#e34c26", size: 51000 },
        { name: "Vue", color: "#41b883", size: 22000 },
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
  let repos = 0;
  let followers = 0;
  let prs = 0;
  let issues = 0;
  let contributedTo = 0;
  const langMap = new Map();

  do {
    const { user } = await gql(MAIN_Q, { login: USER, cursor });
    followers = user.followers.totalCount;
    prs = user.pullRequests.totalCount;
    issues = user.issues.totalCount;
    contributedTo = user.repositoriesContributedTo.totalCount;
    repos = user.repositories.totalCount;

    for (const repo of user.repositories.nodes) {
      stars += repo.stargazerCount;
      for (const edge of repo.languages.edges) {
        const prev = langMap.get(edge.node.name) || {
          name: edge.node.name,
          color: edge.node.color || T.muted,
          size: 0,
        };
        prev.size += edge.size;
        langMap.set(edge.node.name, prev);
      }
    }

    cursor = user.repositories.pageInfo.hasNextPage
      ? user.repositories.pageInfo.endCursor
      : null;
  } while (cursor);

  const languages = [...langMap.values()].sort((a, b) => b.size - a.size);

  return { stars, commits, prs, issues, contributedTo, repos, followers, languages };
}

/* --------------------------------------------------------- render ---- */

const fmt = (n) =>
  n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "") + "k" : String(n);

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const shell = (w, h, title, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(title)}">
  <defs>
    <linearGradient id="edge" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${T.green}" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="${T.mint}" stop-opacity="0.25"/>
    </linearGradient>
    <style>
      .mono { font-family:'JetBrains Mono','SFMono-Regular',Consolas,monospace }
      .hd   { font-size:12px; font-weight:700; letter-spacing:2.6px; fill:${T.mint} }
      .lbl  { font-size:12.5px; fill:${T.muted} }
      .num  { font-size:21px; font-weight:700; fill:${T.text} }
      /* base state is visible; the animation only plays if the renderer
         supports it, so nothing disappears in strict SVG viewers */
      .in   { animation: in .6s ease-out backwards }
      @keyframes in { from { opacity:0; transform:translateY(6px) } to { opacity:1; transform:none } }
    </style>
  </defs>
  <rect x="0.75" y="0.75" width="${w - 1.5}" height="${h - 1.5}" rx="12" fill="${T.panel}" stroke="${T.border}"/>
  <rect x="0.75" y="14" width="3" height="${h - 28}" rx="1.5" fill="url(#edge)"/>
  <text class="mono hd" x="22" y="32">${esc(title)}</text>
  ${body}
</svg>
`;

function statsCard(d) {
  const cells = [
    ["STARS EARNED", fmt(d.stars)],
    ["TOTAL COMMITS", fmt(d.commits)],
    ["PULL REQUESTS", fmt(d.prs)],
    ["ISSUES OPENED", fmt(d.issues)],
    ["PUBLIC REPOS", fmt(d.repos)],
    ["CONTRIBUTED TO", fmt(d.contributedTo)],
  ];

  const body = cells
    .map(([label, value], i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = 22 + col * 208;
      const y = 74 + row * 56;
      return `<g class="in" style="animation-delay:${0.08 * i}s">
    <text class="mono lbl" x="${x}" y="${y}">${label}</text>
    <text class="mono num" x="${x}" y="${y + 25}">${value}</text>
  </g>`;
    })
    .join("\n  ");

  return shell(432, 226, "GITHUB STATS", body);
}

function languagesCard(d) {
  const top = d.languages.slice(0, 6);
  const total = top.reduce((s, l) => s + l.size, 0) || 1;

  const barW = 388;
  let x = 22;
  const bar = top
    .map((l) => {
      const w = Math.max(3, (l.size / total) * barW);
      const seg = `<rect x="${x.toFixed(1)}" y="52" width="${w.toFixed(1)}" height="10" fill="${l.color}"/>`;
      x += w;
      return seg;
    })
    .join("\n  ");

  const rows = top
    .map((l, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const cx = 22 + col * 200;
      const cy = 96 + row * 34;
      const pct = ((l.size / total) * 100).toFixed(1);
      return `<g class="in" style="animation-delay:${0.09 * i}s">
    <circle cx="${cx + 5}" cy="${cy - 4}" r="5" fill="${l.color}"/>
    <text class="mono lbl" x="${cx + 18}" y="${cy}" fill="${T.text}">${esc(l.name)}</text>
    <text class="mono lbl" x="${cx + 178}" y="${cy}" text-anchor="end">${pct}%</text>
  </g>`;
    })
    .join("\n  ");

  const stamp = new Date().toISOString().slice(0, 10);
  const footer = `<line x1="22" y1="182" x2="410" y2="182" stroke="${T.border}"/>
  <text class="mono lbl" x="22" y="203" font-size="11">across ${d.repos} public repos</text>
  <text class="mono lbl" x="410" y="203" font-size="11" text-anchor="end">updated ${stamp}</text>`;

  const body = `<clipPath id="clip"><rect x="22" y="52" width="${barW}" height="10" rx="5"/></clipPath>
  <g clip-path="url(#clip)">
  <rect x="22" y="52" width="${barW}" height="10" fill="${T.bg}"/>
  ${bar}
  </g>
  ${rows}
  ${footer}`;

  return shell(432, 226, "LANGUAGES", body);
}

/* ----------------------------------------------------------- main ---- */

const data = await collect();
await mkdir("assets", { recursive: true });
await writeFile("assets/stats.svg", statsCard(data));
await writeFile("assets/languages.svg", languagesCard(data));
console.log("Wrote assets/stats.svg and assets/languages.svg");
console.log(data.languages.slice(0, 6).map((l) => l.name).join(", "));
