import type { EndpointSummary, RecordingInfo, RecordingSummary } from '@shared/profiler'
import { FLAGS, formatCount, formatMs } from './profilerFormat'

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\s+/g, ' ')
const flags = (e: EndpointSummary) => e.flags.map((f) => FLAGS[f].label).join(', ')
const oneLine = (sql: string, max = 160) => { const s = sql.replace(/\s+/g, ' ').trim(); return s.length > max ? `${s.slice(0, max)}…` : s }

function headline(summary: RecordingSummary): string[] {
  const flagged = summary.endpoints.filter((e) => e.flags.length > 0).length
  return [
    `${summary.endpoints.length} endpoints, ${summary.requests.toLocaleString()} requests, ${summary.queries.toLocaleString()} queries.`,
    `${flagged} endpoint${flagged === 1 ? '' : 's'} flagged.`,
    ...(summary.aborted ? [`${summary.aborted} cancelled request${summary.aborted === 1 ? '' : 's'} left out.`] : []),
    ...(summary.notReached.length ? [`${summary.notReached.length} declared routes were not reached.`] : []),
  ]
}

/** A report to paste into a pull request, a ticket or a chat. */
export function toMarkdownReport(project: string, recording: RecordingInfo, summary: RecordingSummary): string {
  const lines = [
    `# ${project}: ${recording.name}`, '',
    `Recorded ${new Date(recording.startedAt).toLocaleString()}. ${headline(summary).join(' ')}`, '',
    '## Endpoints, slowest first', '',
    '| Endpoint | Calls | Typical | 95th pct | In database | Queries per call | Flags |',
    '| --- | ---: | ---: | ---: | ---: | ---: | --- |',
    ...summary.endpoints.map((e) =>
      `| ${e.method} ${cell(e.route)} | ${e.calls} | ${formatMs(e.ms.median)} | ${formatMs(e.ms.p95)} | ${formatMs(e.dbMs)} (${Math.round(e.dbShare * 100)}%) | ${formatCount(e.queriesPerCall)} | ${flags(e)} |`),
  ]
  const flagged = summary.endpoints.filter((e) => e.flags.length > 0)
  if (flagged.length) lines.push('', '## What to look at')
  for (const e of flagged) {
    lines.push('', `### ${e.method} ${e.route}`, '', `${flags(e)}. Typical request ${formatMs(e.ms.median)}, of which ${formatMs(e.dbMs)} in the database.`, '')
    for (const q of e.queries.slice(0, 5)) {
      lines.push(`- ${q.nPlusOne ? `**Runs up to ${q.maxPerCall} times per request.** ` : ''}${formatCount(q.perCall)} per call, ${formatMs(q.ms.median)} each (${q.store}): \`${oneLine(q.sql).replace(/`/g, "'")}\``)
    }
  }
  return lines.join('\n')
}

/** The same report as a page that opens on its own, for sending to someone without Quarry. */
export function toHtmlReport(project: string, recording: RecordingInfo, summary: RecordingSummary): string {
  const worst = Math.max(...summary.endpoints.map((e) => e.ms.median), 1)
  const rows = summary.endpoints.map((e) => `
    <tr>
      <td><b>${e.method}</b> ${escapeHtml(e.route)}<div class="bar"><i style="width:${(e.ms.median / worst) * 100}%"></i><u style="width:${(e.dbMs / worst) * 100}%"></u></div></td>
      <td class="n">${e.calls}</td><td class="n">${formatMs(e.ms.median)}</td><td class="n">${formatMs(e.ms.p95)}</td>
      <td class="n">${formatMs(e.dbMs)} <span class="m">${Math.round(e.dbShare * 100)}%</span></td><td class="n">${formatCount(e.queriesPerCall)}</td>
      <td>${e.flags.map((f) => `<span class="f" title="${escapeHtml(FLAGS[f].meaning)}">${FLAGS[f].label}</span>`).join(' ')}</td>
    </tr>`).join('')
  const details = summary.endpoints.filter((e) => e.flags.length > 0).map((e) => `
    <h3>${e.method} ${escapeHtml(e.route)}</h3>
    <p>${escapeHtml(flags(e))}. Typical request ${formatMs(e.ms.median)}, of which ${formatMs(e.dbMs)} in the database.</p>
    <ul>${e.queries.slice(0, 5).map((q) => `<li>${q.nPlusOne ? `<b>Runs up to ${q.maxPerCall} times per request.</b> ` : ''}${formatCount(q.perCall)} per call, ${formatMs(q.ms.median)} each (${escapeHtml(q.store)})<pre>${escapeHtml(q.sql.trim())}</pre></li>`).join('')}</ul>`).join('')
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>${escapeHtml(project)}: ${escapeHtml(recording.name)}</title>
<style>
  body{font:14px/1.5 Inter,system-ui,sans-serif;color:#134e48;background:#fbfefd;max-width:1100px;margin:32px auto;padding:0 16px}
  h1{font-size:22px;color:#0e4044;margin:0 0 4px} h2{font-size:16px;margin:28px 0 8px} h3{font-size:14px;margin:20px 0 4px;font-family:ui-monospace,monospace}
  table{border-collapse:collapse;width:100%} th,td{padding:6px 10px;border-bottom:1px solid #e3f0ed;text-align:left;vertical-align:top}
  th{font-size:12px;color:#43716b;background:#f3faf8} .n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums} .m{color:#43716b}
  .bar{position:relative;height:6px;background:#e4f3f0;border-radius:3px;margin-top:4px} .bar i,.bar u{position:absolute;left:0;top:0;height:6px;border-radius:3px}
  .bar i{background:#9ef1e4} .bar u{background:#0e4044}
  .f{background:#fef3c7;color:#92400e;border-radius:4px;padding:1px 6px;font-size:12px;white-space:nowrap}
  pre{background:#f3faf8;border:1px solid #e3f0ed;border-radius:6px;padding:8px;white-space:pre-wrap;font-size:12px;margin:4px 0 10px}
  .key{color:#43716b;font-size:12px}
</style>
<h1>${escapeHtml(project)}: ${escapeHtml(recording.name)}</h1>
<p>Recorded ${escapeHtml(new Date(recording.startedAt).toLocaleString())}. ${escapeHtml(headline(summary).join(' '))}</p>
<h2>Endpoints, slowest first</h2>
<p class="key">Light bar: typical request time. Dark bar: the part of it spent in the database.</p>
<table><tr><th>Endpoint</th><th class="n">Calls</th><th class="n">Typical</th><th class="n">95th pct</th><th class="n">In database</th><th class="n">Queries per call</th><th>Flags</th></tr>${rows}</table>
${details ? `<h2>What to look at</h2>${details}` : ''}
</html>`
}
