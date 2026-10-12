#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const GRAPHQL_ENDPOINT = 'https://api.github.com/graphql';
const USERNAME = process.env.GITHUB_USERNAME ?? 'Miftah-Fentaw';
const OUTPUT_PATH = process.env.OUTPUT_PATH ?? 'output/contribution-graph.svg';
const TOKEN = process.env.GITHUB_TOKEN;
const BOOTSTRAP_EMPTY = process.argv.includes('--empty');

const query = `
  query ContributionCalendar($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      contributionsCollection(from: $from, to: $to) {
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays {
              date
              contributionCount
            }
          }
        }
      }
    }
  }
`;

function escapeXml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function renderSvg(days, totalContributions) {
  const background = '#0D1117';
  const accent = '#6C63FF';
  const white = '#FFFFFF';

  const width = 1100;
  const height = 280;
  const left = 60;
  const right = 36;
  const top = 56;
  const chartHeight = 165;
  const weekly = toWeeklyPoints(days);
  const chartWidth = width - left - right;
  const step = weekly.length > 1 ? chartWidth / (weekly.length - 1) : chartWidth;
  const maxCount = Math.max(...weekly.map((point) => point.count), 0);

  const mapPoint = (point, index) => {
    const x = left + step * index;
    const y =
      maxCount > 0
        ? top + chartHeight - (point.count / maxCount) * chartHeight
        : top + chartHeight / 2;
    return { x: Number(x.toFixed(2)), y: Number(y.toFixed(2)), date: point.date, count: point.count };
  };

  const points = weekly.map(mapPoint);
  const pointsAttr = points.map((point) => `${point.x},${point.y}`).join(' ');

  const startLabel = days[0]?.date ?? '';
  const endLabel = days[days.length - 1]?.date ?? '';
  const emptyState = totalContributions === 0;

  const circles = points
    .map(
      (point) =>
        `<circle cx="${point.x}" cy="${point.y}" r="2.5" fill="${white}" opacity="0.95"><title>${escapeXml(`${point.date}: ${point.count} contribution${point.count === 1 ? '' : 's'}`)}</title></circle>`
    )
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">Contribution Activity</title>
  <desc id="desc">Weekly contribution activity for the last year for ${escapeXml(USERNAME)}.</desc>
  <rect width="100%" height="100%" fill="${background}" rx="14" />
  <text x="${left}" y="34" fill="${white}" font-size="20" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-weight="700">Contribution Activity</text>
  <text x="${left}" y="50" fill="${white}" opacity="0.85" font-size="12" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif">${totalContributions} contributions in the last year</text>
  <line x1="${left}" y1="${top + chartHeight}" x2="${width - right}" y2="${top + chartHeight}" stroke="${white}" opacity="0.2" stroke-width="1"/>
  <line x1="${left}" y1="${top}" x2="${width - right}" y2="${top}" stroke="${white}" opacity="0.08" stroke-width="1"/>
  <polyline fill="none" stroke="${accent}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" points="${pointsAttr}" />
  ${circles}
  <text x="${left}" y="${height - 16}" fill="${white}" opacity="0.75" font-size="11" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif">${escapeXml(startLabel)}</text>
  <text x="${width - right}" y="${height - 16}" fill="${white}" opacity="0.75" font-size="11" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" text-anchor="end">${escapeXml(endLabel)}</text>
  <text x="${width - right}" y="50" fill="${white}" opacity="0.85" font-size="12" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" text-anchor="end">${emptyState ? 'No contributions recorded yet' : `Peak: ${maxCount}/day`}</text>
</svg>`;
}

async function fetchContributionDays() {
  const now = new Date();
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - 365);

  if (!TOKEN && BOOTSTRAP_EMPTY) {
    return {
      days: buildEmptyDays(from, now),
      totalContributions: 0,
    };
  }

  if (!TOKEN) {
    throw new Error('Missing GITHUB_TOKEN. Set GITHUB_TOKEN to call the GitHub GraphQL API.');
  }

  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: `bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'contribution-graph-generator',
    },
    body: JSON.stringify({
      query,
      variables: {
        login: USERNAME,
        from: from.toISOString(),
        to: now.toISOString(),
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`GitHub GraphQL request failed (${response.status} ${response.statusText}).`);
  }

  const payload = await response.json();

  if (payload.errors?.length) {
    throw new Error(`GitHub GraphQL returned errors: ${payload.errors.map((error) => error.message).join('; ')}`);
  }

  const calendar = payload.data?.user?.contributionsCollection?.contributionCalendar;
  if (!calendar) {
    throw new Error(`No contribution calendar returned for user "${USERNAME}".`);
  }

  const days = calendar.weeks.flatMap((week) => week.contributionDays ?? []);

  return {
    days: days.length > 0 ? days : buildEmptyDays(from, now),
    totalContributions: calendar.totalContributions ?? 0,
  };
}

function toWeeklyPoints(days) {
  const weekly = [];
  for (let index = 0; index < days.length; index += 7) {
    const week = days.slice(index, index + 7);
    const count = week.reduce((sum, day) => sum + day.contributionCount, 0);
    weekly.push({
      date: week[week.length - 1]?.date ?? week[0]?.date ?? '',
      count,
    });
  }
  return weekly;
}

function buildEmptyDays(fromDate, toDate) {
  const days = [];
  const cursor = new Date(fromDate);
  while (cursor <= toDate) {
    days.push({
      date: cursor.toISOString().slice(0, 10),
      contributionCount: 0,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

async function main() {
  const { days, totalContributions } = await fetchContributionDays();
  const svg = renderSvg(days, totalContributions);

  const absoluteOutput = path.resolve(OUTPUT_PATH);
  await mkdir(path.dirname(absoluteOutput), { recursive: true });
  await writeFile(absoluteOutput, svg, 'utf8');

  console.log(`Wrote ${days.length} data points to ${absoluteOutput}`);
}

main().catch((error) => {
  console.error(`Failed to generate contribution graph: ${error.message}`);
  process.exitCode = 1;
});
