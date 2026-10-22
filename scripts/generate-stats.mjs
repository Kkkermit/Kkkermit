// Generates assets/stats-card.svg, assets/languages-card.svg and the assets/repo-*.svg
// project cards from the GitHub API, styled to match the CRT header.
// Runs inside GitHub Actions using the built-in GITHUB_TOKEN — no rate limits,
// no third-party service, no broken cards.
//
// Local dry run:  node scripts/generate-stats.mjs --mock

import { writeFile, mkdir } from "node:fs/promises";

const USER = process.env.GH_USER || "Kkkermit";
const TOKEN = process.env.GITHUB_TOKEN;
const MOCK = process.argv.includes("--mock");

const T = {
  panel: "#0B0609",
  border: "#3A1220",
  text: "#FFE9EE",
  muted: "#B58C98",
  red: "#FF2D55",
  purple: "#A855F7",
  // language bar, most used first
  ramp: ["#FF2D55", "#FF5C7A", "#D63384", "#A855F7", "#7E3FD0", "#4B2A3A"],
};

const MONO = "ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,'Liberation Mono',monospace";
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans',Helvetica,Arial,sans-serif";

// Repos shown as cards in the README. Stars, forks and language come from the
// API; the blurb and tag are written here.
const FEATURED = [
  {
    name: "Testify",
    file: "repo-testify.svg",
    tag: "testify.lol",
    blurb:
      "All-in-one Discord bot. Moderation, economy, music, tickets and games, with a web dashboard. Every command works as slash and prefix.",
  },
  {
    name: "DiscordBotV14-template",
    file: "repo-template.svg",
    tag: "template",
    blurb:
      "A Discord.js v14 starter with slash and prefix command handlers and MongoDB already hooked up. Clone it and start adding commands.",
  },
  {
    name: "Statify",
    file: "repo-statify.svg",
    tag: "JDA",
    blurb:
      "A Discord bot written in Java that links to your Spotify account and shows your listening stats in Discord.",
  },
  {
    name: "jest-ts-example",
    file: "repo-jest.svg",
    tag: "starter",
    blurb:
      "React and TypeScript starter on Vite, set up for Jest, React Testing Library, Vitest and Tailwind from the start.",
  },
];

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
          primaryLanguage { name }
          languages(first: 12, orderBy: { field: SIZE, direction: DESC }) {
            edges { size node { name } }
          }
        }
      }
    }
  }`;

async function collect() {
  if (MOCK) {
    // Snapshot of real numbers, so a dry run looks like the live cards.
    return {
      stars: 170,
      commits: 953,
      forks: 66,
      prs: 58,
      repos: 10,
      followers: 20,
      languages: [
        { name: "TypeScript", size: 905 },
        { name: "Python", size: 51 },
        { name: "JavaScript", size: 27 },
        { name: "Java", size: 10 },
        { name: "CSS", size: 5 },
        { name: "Dockerfile", size: 1 },
      ],
      repoInfo: {
        Testify: { stars: 138, forks: 53, lang: "TypeScript" },
        "DiscordBotV14-template": { stars: 16, forks: 11, lang: "JavaScript" },
        Statify: { stars: 2, forks: 0, lang: "Java" },
        "jest-ts-example": { stars: 2, forks: 0, lang: "TypeScript" },
      },
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
  let followers = 0;
  let prs = 0;
  const langMap = new Map();
  const repoInfo = {};

  do {
    const { user } = await gql(MAIN_Q, { login: USER, cursor });
    followers = user.followers.totalCount;
    prs = user.pullRequests.totalCount;
    repos = user.repositories.totalCount;

    for (const repo of user.repositories.nodes) {
      stars += repo.stargazerCount;
      forks += repo.forkCount;
      repoInfo[repo.name] = {
        stars: repo.stargazerCount,
        forks: repo.forkCount,
        lang: repo.primaryLanguage?.name || "",
      };
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

  return { stars, commits, forks, prs, repos, followers, languages, repoInfo };
}

/* --------------------------------------------------------- render ---- */

const fmt = (n) =>
  n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "") + "k" : String(n);

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function wrap(text, max) {
  const out = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if ((line + " " + word).trim().length > max) {
      out.push(line.trim());
      line = word;
    } else line += " " + word;
  }
  if (line.trim()) out.push(line.trim());
  return out;
}

const star = (x, y, s, fill) => {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? s : s * 0.45;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${(x + r * Math.cos(a)).toFixed(2)},${(y + r * Math.sin(a)).toFixed(2)}`);
  }
  return `<polygon points="${pts.join(" ")}" fill="${fill}"/>`;
};

const fork = (x, y, stroke) =>
  `<g transform="translate(${x - 6},${y - 7})" fill="none" stroke="${stroke}" stroke-width="1.5" stroke-linecap="round">
      <circle cx="3" cy="2.5" r="1.8"/><circle cx="11" cy="2.5" r="1.8"/><circle cx="7" cy="12.5" r="1.8"/>
      <path d="M3 4.3v1.4c0 1.4 1 2.3 2.3 2.3h3.4c1.3 0 2.3-0.9 2.3-2.3V4.3M7 8v2.7"/>
    </g>`;

// Shared panel: dark screen, red glow from the top, scanlines over everything.
const shell = (w, h, title, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(title || "card")}">
  <defs>
    <pattern id="scan" width="4" height="4" patternUnits="userSpaceOnUse"><rect y="2" width="4" height="1" fill="#000" opacity="0.35"/></pattern>
    <radialGradient id="glow" cx="50%" cy="0%" r="90%"><stop offset="0%" stop-color="${T.red}" stop-opacity="0.16"/><stop offset="100%" stop-color="${T.red}" stop-opacity="0"/></radialGradient>
    <style>
      .m { font-family:${MONO} }
      .s { font-family:${SANS} }
      .hd  { font-size:12px; font-weight:700; letter-spacing:2.4px; fill:${T.red} }
      .lbl { font-size:12px; fill:${T.muted}; letter-spacing:0.6px }
      .num { font-size:24px; font-weight:700; fill:${T.text} }
      .ttl { font-size:17px; font-weight:700; fill:${T.text} }
      .dsc { font-size:13.5px; fill:${T.muted} }
      /* base state is visible; the animation only plays if the renderer
         supports it, so nothing disappears in strict SVG viewers */
      .in  { animation: in .6s ease-out backwards }
      @keyframes in { from { opacity:0; transform:translateY(6px) } to { opacity:1; transform:none } }
      @media (prefers-reduced-motion: reduce) { .in { animation: none } }
    </style>
  </defs>
  <rect x="0.75" y="0.75" width="${w - 1.5}" height="${h - 1.5}" rx="12" fill="${T.panel}" stroke="${T.border}" stroke-width="1.5"/>
  <rect x="0.75" y="0.75" width="${w - 1.5}" height="${h - 1.5}" rx="12" fill="url(#glow)"/>
  ${title ? `<text class="m hd" x="24" y="36">${esc(title)}</text>` : ""}
  ${body}
  <rect x="0.75" y="0.75" width="${w - 1.5}" height="${h - 1.5}" rx="12" fill="url(#scan)"/>
</svg>
`;

function statsCard(d) {
  const cells = [
    ["STARS", fmt(d.stars)],
    ["COMMITS", fmt(d.commits)],
    ["FORKS", fmt(d.forks)],
    ["PULL REQUESTS", fmt(d.prs)],
    ["PUBLIC REPOS", fmt(d.repos)],
    ["FOLLOWERS", fmt(d.followers)],
  ];

  const body = cells
    .map(([label, value], i) => {
      const x = 24 + (i % 2) * 222;
      const y = 78 + Math.floor(i / 2) * 58;
      return `<g class="in" style="animation-delay:${(0.07 * i).toFixed(2)}s">
    <rect x="${x}" y="${y - 9}" width="6" height="6" rx="1" fill="${i % 2 ? T.purple : T.red}"/>
    <text class="m lbl" x="${x + 14}" y="${y - 2}">${label}</text>
    <text class="m num" x="${x}" y="${y + 26}">${value}</text>
  </g>`;
    })
    .join("\n  ");

  return shell(480, 250, "> GITHUB STATS_", body);
}

function languagesCard(d) {
  const top = d.languages.slice(0, 6);
  const total = top.reduce((s, l) => s + l.size, 0) || 1;

  const barW = 432;
  let x = 24;
  const bar = top
    .map((l, i) => {
      const w = Math.max(4, (l.size / total) * barW);
      const seg = `<rect x="${x.toFixed(1)}" y="56" width="${w.toFixed(1)}" height="10" fill="${T.ramp[i]}"/>`;
      x += w;
      return seg;
    })
    .join("\n    ");

  const rows = top
    .map((l, i) => {
      const cx = 24 + (i % 2) * 222;
      const cy = 104 + Math.floor(i / 2) * 34;
      const pct = ((l.size / total) * 100).toFixed(1);
      return `<g class="in" style="animation-delay:${(0.08 * i).toFixed(2)}s">
    <rect x="${cx}" y="${cy - 10}" width="10" height="10" rx="2" fill="${T.ramp[i]}"/>
    <text class="m lbl" x="${cx + 18}" y="${cy}" style="fill:${T.text}">${esc(l.name)}</text>
    <text class="m lbl" x="${cx + 196}" y="${cy}" text-anchor="end">${pct}%</text>
  </g>`;
    })
    .join("\n  ");

  const footer = `<line x1="24" y1="200" x2="456" y2="200" stroke="${T.border}"/>
  <text class="m lbl" x="24" y="224" font-size="11">across ${d.repos} public repos</text>
  <text class="m lbl" x="456" y="224" font-size="11" text-anchor="end">updated daily</text>`;

  const body = `<clipPath id="bar"><rect x="24" y="56" width="${barW}" height="10" rx="5"/></clipPath>
  <g clip-path="url(#bar)">
    <rect x="24" y="56" width="${barW}" height="10" fill="${T.border}"/>
    ${bar}
  </g>
  ${rows}
  ${footer}`;

  return shell(480, 250, "> LANGUAGES_", body);
}

function repoCard(r, info) {
  const desc = wrap(r.blurb, 58)
    .slice(0, 3)
    .map((l, i) => `<text class="s dsc" x="24" y="${76 + i * 20}">${esc(l)}</text>`)
    .join("\n  ");

  // star/fork counters laid out from the right edge
  const cw = 7.4;
  const fx = 456 - fmt(info.forks).length * cw - 10;
  const sx = fx - 22 - fmt(info.stars).length * cw - 10;
  const size = r.name.length > 22 ? 15.5 : 17;
  const dot = info.lang === "TypeScript" ? T.red : T.purple;

  const body = `<text class="m ttl" x="24" y="42" style="font-size:${size}px">${esc(r.name)}</text>
  <g class="in">
    ${star(sx, 37, 6.5, T.red)}
    <text class="m lbl" x="${sx + 10}" y="42" style="fill:${T.text}">${fmt(info.stars)}</text>
    ${fork(fx, 37, T.purple)}
    <text class="m lbl" x="${fx + 10}" y="42" style="fill:${T.text}">${fmt(info.forks)}</text>
  </g>
  ${desc}
  <circle cx="29" cy="152" r="5" fill="${dot}"/>
  <text class="m lbl" x="40" y="156">${esc(info.lang)}</text>
  <text class="m lbl" x="456" y="156" text-anchor="end" style="fill:${T.red}">${esc(r.tag)}</text>`;

  return shell(480, 180, "", body).replace(`aria-label="card"`, `aria-label="${esc(r.name)}"`);
}

/* ----------------------------------------------------------- main ---- */

const data = await collect();
await mkdir("assets", { recursive: true });
await writeFile("assets/stats-card.svg", statsCard(data));
await writeFile("assets/languages-card.svg", languagesCard(data));
for (const r of FEATURED) {
  const info = data.repoInfo[r.name] || { stars: 0, forks: 0, lang: "" };
  await writeFile(`assets/${r.file}`, repoCard(r, info));
}
console.log("Wrote assets/stats-card.svg, assets/languages-card.svg and", FEATURED.length, "repo cards");
console.log(data.languages.slice(0, 6).map((l) => l.name).join(", "));
