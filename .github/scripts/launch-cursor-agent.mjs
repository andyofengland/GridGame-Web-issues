#!/usr/bin/env node
/**
 * Launch Cursor cloud agents for a public GridGame-Web-issues ticket.
 * Keys off labels, not GitHub issue-form YAML (in-game feedback bypasses forms).
 *
 * On pickup, creates one issue in each tagged code repo with a rewritten scope
 * and a link back to this ticket. iOS gets an issue only; no agent is launched.
 */
import { Agent, CursorAgentError } from '@cursor/sdk';

const REPOS = {
  frontend: 'https://github.com/andyofengland/GridGame-Web-frontend',
  backend: 'https://github.com/andyofengland/GridGame-Web-backend',
  ios: 'https://github.com/andyofengland/GridGame-Web-iOS',
};

const TARGET_REPOS = {
  frontend: 'andyofengland/GridGame-Web-frontend',
  backend: 'andyofengland/GridGame-Web-backend',
  ios: 'andyofengland/GridGame-Web-iOS',
};

const OWNER_REPO = process.env.GITHUB_REPOSITORY || 'andyofengland/GridGame-Web-issues';
const TOKEN = process.env.GITHUB_TOKEN;
const CODE_REPOS_TOKEN = process.env.CODE_REPOS_TOKEN;
const API_KEY = process.env.CURSOR_API_KEY;
const ISSUE_NUMBER = process.env.ISSUE_NUMBER;
const ISSUE_TITLE = process.env.ISSUE_TITLE || '';
const ISSUE_BODY = process.env.ISSUE_BODY || '';
const ISSUE_URL = process.env.ISSUE_URL || '';
const LABELS = (process.env.ISSUE_LABELS || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

function hasLabel(name) {
  return LABELS.includes(name.toLowerCase());
}

function trackerLine() {
  return `Tracker: andyofengland/GridGame-Web-issues#${ISSUE_NUMBER}`;
}

async function github(token, method, path, body) {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'gridlocked-cursor-launcher',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`GitHub ${method} ${path} failed: ${response.status} ${data.message || ''}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function comment(body) {
  return github(TOKEN, 'POST', `/repos/${OWNER_REPO}/issues/${ISSUE_NUMBER}/comments`, { body });
}

async function addLabels(labels) {
  return github(TOKEN, 'POST', `/repos/${OWNER_REPO}/issues/${ISSUE_NUMBER}/labels`, { labels });
}

function fallbackScope(area, areas) {
  const others = areas.filter((name) => name !== area);
  const leave = others.length
    ? ` Leave ${others.join(' and ')} work to those repositories.`
    : '';
  return [
    `## Scope`,
    `Do this work only in \`${TARGET_REPOS[area]}\`.${leave}`,
    '',
    `## Ticket`,
    ISSUE_TITLE,
    '',
    ISSUE_BODY || '(no body)',
    '',
    trackerLine(),
  ].join('\n');
}

function parseScopes(text, areas) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('rewrite did not return JSON');
  const data = JSON.parse(raw.slice(start, end + 1));
  const scopes = {};
  for (const area of areas) {
    const body = typeof data[area] === 'string' ? data[area].trim() : '';
    if (!body) throw new Error(`rewrite omitted ${area}`);
    scopes[area] = body.includes('Tracker:') ? body : `${body}\n\n${trackerLine()}`;
  }
  return scopes;
}

async function rewriteScopes(areas) {
  const prompt = [
    'Split one product ticket into repository-specific GitHub issue bodies.',
    'Do not edit files, commit, or open a pull request. Reply with JSON only.',
    '',
    `Public issue: ${ISSUE_URL}`,
    `Title: ${ISSUE_TITLE}`,
    '',
    ISSUE_BODY || '(no body)',
    '',
    `Areas: ${areas.join(', ')}`,
    'Return a JSON object whose keys are exactly those area names.',
    'Each value is a markdown issue body that describes only that repository\'s work.',
    'Mention the other areas only to say they are out of scope.',
    `End every body with this exact line: ${trackerLine()}`,
  ].join('\n');

  const result = await Agent.prompt(prompt, {
    apiKey: API_KEY,
    model: { id: 'composer-2.5' },
    cloud: {
      repos: [{ url: `https://github.com/${OWNER_REPO}`, startingRef: 'main' }],
      autoCreatePR: false,
      skipReviewerRequest: true,
    },
  });
  if (result.status === 'error') {
    throw new Error(`scope rewrite failed (${result.id || 'no run id'})`);
  }
  const text = [result.result, result.text].find((value) => typeof value === 'string' && value.trim()) || '';
  return parseScopes(text, areas);
}

async function findChildIssue(repo) {
  const query = `repo:${repo} is:issue in:body "Tracker: andyofengland/GridGame-Web-issues#${ISSUE_NUMBER}"`;
  const found = await github(
    CODE_REPOS_TOKEN,
    'GET',
    `/search/issues?q=${encodeURIComponent(query)}`,
  );
  return (found.items || [])[0] || null;
}

async function ensureChildIssue(area, body) {
  const repo = TARGET_REPOS[area];
  const existing = await findChildIssue(repo);
  if (existing) {
    return { area, url: existing.html_url, body: existing.body || body, created: false };
  }
  const created = await github(CODE_REPOS_TOKEN, 'POST', `/repos/${repo}/issues`, {
    title: ISSUE_TITLE,
    body,
  });
  return { area, url: created.html_url, body, created: true };
}

async function createChildIssues(areas) {
  if (!CODE_REPOS_TOKEN) {
    throw new Error('repository secret CODE_REPOS_TOKEN is missing');
  }
  let scopes;
  let rewritten = true;
  if (!API_KEY) {
    rewritten = false;
    scopes = Object.fromEntries(areas.map((area) => [area, fallbackScope(area, areas)]));
  } else {
    try {
      scopes = await rewriteScopes(areas);
    } catch (err) {
      rewritten = false;
      console.error(err);
      scopes = Object.fromEntries(areas.map((area) => [area, fallbackScope(area, areas)]));
    }
  }
  const issues = {};
  for (const area of areas) {
    issues[area] = await ensureChildIssue(area, scopes[area]);
  }
  return { issues, rewritten };
}

function buildPrompt(area, child) {
  const extra =
    area === 'frontend' && hasLabel('cross-repo')
      ? 'This is a cross-repo ticket. Match the backend API already proposed or merged on backend `dev`. If the contract is missing, stop and say so in the PR.'
      : area === 'backend' && hasLabel('cross-repo')
        ? 'This is a cross-repo ticket. Land the API contract (routes + tests) so a frontend agent can follow.'
        : '';

  return [
    `Implement this Gridlocked ticket in the ${area} repository.`,
    '',
    `Repository issue (this is your scope): ${child?.url || '(missing)'}`,
    child?.body || '',
    '',
    `Public issue: ${ISSUE_URL}`,
    `Title: ${ISSUE_TITLE}`,
    '',
    extra,
    '',
    'Requirements:',
    '- Branch from `dev` and open the pull request against `dev`, never `main`.',
    '- Do not merge the pull request. CI squash-merges it into `dev` after the checks pass.',
    `- Put this exact reference in the PR title or body so labels sync: andyofengland/GridGame-Web-issues#${ISSUE_NUMBER}`,
    '- Follow AGENTS.md in the repo.',
    '- Run the repo test/lint/build commands and fix failures you cause.',
    '- Keep the diff minimal. Do not commit secrets.',
  ]
    .filter((line) => line !== undefined)
    .join('\n');
}

async function launch(area, child) {
  const result = await Agent.prompt(buildPrompt(area, child), {
    apiKey: API_KEY,
    model: { id: 'composer-2.5' },
    cloud: {
      repos: [{ url: REPOS[area], startingRef: 'dev' }],
      autoCreatePR: true,
      skipReviewerRequest: true,
    },
  });

  const prUrl = result.git?.branches?.[0]?.prUrl || result.git?.branches?.[0]?.pr_url || '';
  const branch = result.git?.branches?.[0]?.branch || '';
  const runId = result.id || '';
  return { area, status: result.status, prUrl, branch, runId };
}

async function main() {
  if (!ISSUE_NUMBER) throw new Error('ISSUE_NUMBER is required');
  if (!TOKEN) throw new Error('GITHUB_TOKEN is required');

  const wantsFrontend = hasLabel('area:frontend');
  const wantsBackend = hasLabel('area:backend');
  const wantsIos = hasLabel('area:ios');

  if (!wantsFrontend && !wantsBackend && !wantsIos) {
    await addLabels(['agent:blocked']);
    await comment(
      'Cannot launch an agent: add `area:frontend`, `area:backend`, and/or `area:ios` before `ready-for-dev`. (In-game tickets do not set area labels automatically.)',
    );
    return;
  }

  const areas = ['backend', 'frontend', 'ios'].filter((area) => {
    if (area === 'backend') return wantsBackend;
    if (area === 'frontend') return wantsFrontend;
    return wantsIos;
  });

  let childIssues;
  try {
    const created = await createChildIssues(areas);
    childIssues = created.issues;
    const lines = [
      created.rewritten
        ? 'Opened a repository issue for each tagged area, with a rewritten scope:'
        : 'Opened a repository issue for each tagged area. Scope rewrite failed, so each issue quotes the public ticket and limits the work to that repo:',
    ];
    for (const area of areas) {
      const child = childIssues[area];
      lines.push(`- **${area}**: ${child.url}${child.created ? '' : ' (already existed)'}`);
    }
    if (wantsIos) {
      lines.push('`area:ios` stays human-gated. No Cursor agent was started for GridGame-Web-iOS.');
    }
    await comment(lines.join('\n'));
  } catch (err) {
    await addLabels(['agent:blocked']);
    await comment(`Could not create the repository issues: ${err.message || err}`);
    process.exitCode = 1;
    return;
  }

  if (wantsIos && !wantsFrontend && !wantsBackend) return;

  const targets = [];
  const trigger = (process.env.TRIGGER_LABEL || '').toLowerCase();
  const crossRepo = hasLabel('cross-repo');
  const readyFrontend = hasLabel('ready-for-frontend');
  if (wantsBackend && trigger !== 'ready-for-frontend') targets.push('backend');
  if (wantsFrontend) {
    if (crossRepo && !readyFrontend && trigger !== 'ready-for-frontend') {
      await comment(
        'Cross-repo ticket: launching **backend** only. After the backend pull request exists, add label `ready-for-frontend` to start the frontend agent.',
      );
    } else {
      targets.push('frontend');
    }
  }

  if (targets.length === 0) return;

  if (!API_KEY) {
    await addLabels(['agent:blocked']);
    await comment(
      'Cannot launch Cursor: repository secret `CURSOR_API_KEY` is missing. Add it under Settings → Secrets on this issues repo.',
    );
    process.exitCode = 1;
    return;
  }

  const lines = ['Cursor cloud agent launch:'];
  let failed = false;
  for (const area of targets) {
    try {
      const launched = await launch(area, childIssues[area]);
      lines.push(
        `- **${area}**: status \`${launched.status}\`` +
          (launched.prUrl ? ` PR ${launched.prUrl}` : '') +
          (launched.branch ? ` branch \`${launched.branch}\`` : '') +
          (launched.runId ? ` run \`${launched.runId}\`` : ''),
      );
      if (launched.status === 'error') failed = true;
    } catch (err) {
      failed = true;
      const message = err instanceof CursorAgentError ? err.message : err.message || String(err);
      lines.push(`- **${area}**: failed — ${message}`);
    }
  }

  if (failed) await addLabels(['agent:blocked']);
  else await addLabels(['in-dev']);
  await comment(lines.join('\n'));
  if (failed) process.exitCode = 1;
}

main().catch(async (err) => {
  console.error(err);
  try {
    await addLabels(['agent:blocked']);
    await comment(`Cursor launcher crashed: \`${err.message || err}\``);
  } catch (commentErr) {
    console.error(commentErr);
  }
  process.exit(1);
});
