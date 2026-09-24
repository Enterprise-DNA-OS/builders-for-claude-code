#!/usr/bin/env node
// builders-for-claude-code: the one CLI. Claude Code slash commands call
// this; so can you.
//
//   node scripts/builders.mjs <command> [args] [--flags] [--json]
//
// Run with no arguments (or `help`) for the command list.
//
// This system is a New Zealand residential builder's job record: the clients,
// the jobs from quote to handover, the budget lines that carry the estimate,
// the purchase orders and costs against them, the variations, the progress
// claims, the subbies with their insurance and licensing, the schedule and
// the site diary. The sharp edges are deliberate: a quote at or over $30,000
// does not become an active job without a signed written contract date; a
// progress claim cannot take total claims past the contract plus APPROVED
// variations (no force flag); a subbie with expired public liability does not
// get assigned to a job, and restricted building work needs an LBP number;
// and a job does not complete while claims are unpaid, variations undecided,
// or purchase orders open. Nothing here connects to a bank, IRD or a client,
// and nothing sends: claims and letters draft to files and a person sends.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getDb, REPO_ROOT } from './lib/db.mjs';
import { parseCsv, pick } from './lib/csv.mjs';
import { table, isoDate, short, heading } from './lib/format.mjs';

// ---------------------------------------------------------------------------
// Argument parsing

const BOOL_FLAGS = new Set(['json', 'help', 'all', 'dry-run', 'restricted', 'week']);

function parseArgv(argv) {
  const args = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      flags.help = true;
      continue;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      let name;
      let value;
      if (eq > -1) {
        name = a.slice(2, eq);
        value = a.slice(eq + 1);
      } else {
        name = a.slice(2);
        const next = argv[i + 1];
        if (BOOL_FLAGS.has(name) || next === undefined || next.startsWith('--')) value = true;
        else value = argv[++i];
      }
      flags[name] = value;
    } else {
      args.push(a);
    }
  }
  return { args, flags };
}

class CliError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

const num = (v) => Number(v ?? 0);
const str = (v) => (v === true || v === undefined || v === null ? '' : String(v));
const money = (v) => '$' + num(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const money0 = (v) => '$' + Math.round(num(v)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const pct = (v) => (v === null || v === undefined ? '' : `${num(v).toFixed(1)}%`);

// ---------------------------------------------------------------------------
// Dates

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseDate(v, what = 'date') {
  if (!v || v === true) return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const lower = s.toLowerCase();
  if (lower === 'today') return today();
  if (lower === 'yesterday') return addDays(today(), -1);
  if (lower === 'tomorrow') return addDays(today(), 1);
  // New Zealand writes DD/MM/YYYY, so the first number is the day unless the
  // second one is too big to be a month.
  const slash = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    const [day, month] = b > 12 ? [b, a] : [a, b];
    const year = slash[3].length === 2 ? `20${slash[3]}` : slash[3];
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new CliError(`"${v}" is not a ${what}. Use YYYY-MM-DD.`);
  return isoDate(d);
}

function parseMoney(v, what) {
  if (v === undefined || v === true || v === null || v === '') throw new CliError(`${what} needs a dollar amount.`);
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  if (Number.isNaN(n)) throw new CliError(`"${v}" is not a dollar amount.`);
  return n;
}

// ---------------------------------------------------------------------------
// The domain's spine

const JOB_TYPES = ['new_build', 'renovation', 'extension', 'other'];
const WRITTEN_CONTRACT_FLOOR = 30000; // Building Act 2004 s362F
const DEFAULT_CLAIM_TERMS_DAYS = 20;

// ---------------------------------------------------------------------------
// Lookups: full id, first 4+ characters of an id, exact ref or name, then
// contains. One hit wins. Several hits list the candidates and exit 1.

const RESOLVERS = {
  client: {
    from: 'clients c',
    cols: 'c.*',
    exact: "lower(c.name) = lower($1) or lower(coalesce(c.external_ref, '')) = lower($1)",
    fuzzy: 'c.name ilike $1 or c.contact_name ilike $1 or c.email ilike $1',
    label: (r) => `${r.name} (${r.contact_name || 'no contact'}, ${r.status})`,
    order: 'c.name',
    listing: 'clients --all',
  },
  job: {
    from: 'jobs c join clients cl on cl.id = c.client_id',
    cols: 'c.*, cl.name as client_name',
    exact: "lower(coalesce(c.ref, '')) = lower($1) or lower(coalesce(c.ref, '')) = lower('JOB-' || $1) or lower(c.name) = lower($1) or lower(coalesce(c.external_ref, '')) = lower($1)",
    fuzzy: 'c.ref ilike $1 or c.name ilike $1 or cl.name ilike $1 or c.site_address ilike $1',
    label: (r) => `${r.ref}  ${r.name} (${r.client_name}, ${r.status})`,
    order: 'c.created_at desc',
    listing: 'jobs --all',
  },
  subbie: {
    from: 'subbies c',
    cols: 'c.*',
    exact: "lower(c.name) = lower($1) or lower(coalesce(c.external_ref, '')) = lower($1)",
    fuzzy: 'c.name ilike $1 or c.trade ilike $1 or c.contact_name ilike $1',
    label: (r) => `${r.name} (${r.trade}, ${r.status})`,
    order: 'c.name',
    listing: 'subbies --all',
  },
  variation: {
    from: 'variations c join jobs j on j.id = c.job_id',
    cols: 'c.*, j.ref as job_ref',
    exact: "lower(coalesce(c.ref, '')) = lower($1) or lower(coalesce(c.ref, '')) = lower('VAR-' || $1) or lower(coalesce(c.external_ref, '')) = lower($1)",
    fuzzy: 'c.ref ilike $1 or c.description ilike $1',
    label: (r) => `${r.ref}  ${r.job_ref}: ${r.description} (${r.status})`,
    order: 'c.proposed_on desc',
    listing: 'variations --all',
  },
  claim: {
    from: 'progress_claims c join jobs j on j.id = c.job_id',
    cols: 'c.*, j.ref as job_ref',
    exact: "lower(coalesce(c.ref, '')) = lower($1) or lower(coalesce(c.ref, '')) = lower('PC-' || $1) or lower(coalesce(c.external_ref, '')) = lower($1)",
    fuzzy: 'c.ref ilike $1 or j.ref ilike $1',
    label: (r) => `${r.ref}  ${r.job_ref}, claimed ${isoDate(r.claimed_on)} (${r.status})`,
    order: 'c.claimed_on desc',
    listing: 'claims --all',
  },
  po: {
    from: 'purchase_orders c join jobs j on j.id = c.job_id',
    cols: 'c.*, j.ref as job_ref',
    exact: "lower(coalesce(c.ref, '')) = lower($1) or lower(coalesce(c.ref, '')) = lower('PO-' || $1) or lower(coalesce(c.external_ref, '')) = lower($1)",
    fuzzy: 'c.ref ilike $1 or c.supplier ilike $1',
    label: (r) => `${r.ref}  ${r.job_ref}, ${r.supplier} (${r.status})`,
    order: 'c.issued_on desc',
    listing: 'orders --all',
  },
};

const ID_RE = /^[0-9a-f]{4,8}(-[0-9a-f-]*)?$/i;

async function resolve(db, kind, q, { optional = false } = {}) {
  const spec = RESOLVERS[kind];
  q = String(q ?? '').trim();
  if (!q || q === 'true') {
    if (optional) return null;
    throw new CliError(`Give me a ${kind} name, reference or id.`);
  }
  const select = `select ${spec.cols} from ${spec.from}`;
  let rows = [];
  if (ID_RE.test(q)) {
    rows = await db.query(`${select} where c.id::text like $1 order by ${spec.order}`, [q.toLowerCase() + '%']);
    if (rows.length === 1) return rows[0];
  }
  if (!rows.length) rows = await db.query(`${select} where ${spec.exact} order by ${spec.order}`, [q]);
  if (rows.length === 1) return rows[0];
  if (!rows.length) rows = await db.query(`${select} where ${spec.fuzzy} order by ${spec.order}`, [`%${q}%`]);
  if (rows.length === 1) return rows[0];
  if (!rows.length) {
    if (optional) return null;
    throw new CliError(`No ${kind} matches "${q}". Run \`${spec.listing}\` to see what exists.`);
  }
  throw new CliError(
    `"${q}" matches ${rows.length} ${kind} records. Use a reference, an id, or a longer name:\n` +
      rows.map((r) => `  ${short(r.id)}  ${spec.label(r)}`).join('\n'),
  );
}

// A budget line lives inside one job: resolve by code or name within it.
async function resolveLine(db, jobId, q) {
  q = String(q ?? '').trim();
  if (!q || q === 'true') throw new CliError('Which budget line? --line=<code or name> (see `budget <job>`).');
  let rows = await db.query(
    'select * from budget_lines where job_id = $1 and (lower(cost_code) = lower($2) or lower(name) = lower($2))',
    [jobId, q],
  );
  if (rows.length === 1) return rows[0];
  if (!rows.length) rows = await db.query('select * from budget_lines where job_id = $1 and name ilike $2 order by cost_code', [jobId, `%${q}%`]);
  if (rows.length === 1) return rows[0];
  if (!rows.length) throw new CliError(`No budget line on this job matches "${q}". See them: budget <job>. Add one: budget add <job> --code= --name= --budget=`);
  throw new CliError(
    `"${q}" matches ${rows.length} budget lines. Use the code:\n` +
      rows.map((r) => `  ${r.cost_code}  ${r.name} (${money0(r.budget)})`).join('\n'),
  );
}

async function nextRef(db, prefix, tableName, column, start) {
  const [r] = await db.query(
    `select coalesce(max(substring(${column} from ${prefix.length + 2})::int), ${start}) + 1 as n from ${tableName} where ${column} ~ '^${prefix}-[0-9]+$'`,
  );
  return `${prefix}-${r.n}`;
}

// ---------------------------------------------------------------------------
// Shared column sets

const JOB_COLS = [
  { key: 'ref', label: 'ref' },
  { key: 'job', label: 'job', width: 26 },
  { key: 'client', label: 'client', width: 22 },
  { key: 'job_type', label: 'type' },
  { key: 'revised_contract', label: 'contract', align: 'right', format: (v) => money0(v) },
  { key: 'claimed', label: 'claimed', align: 'right', format: (v) => money0(v) },
  { key: 'outstanding', label: 'owed', align: 'right', format: (v) => (num(v) > 0 ? money0(v) : '') },
  { key: 'costs_actual', label: 'costs', align: 'right', format: (v) => money0(v) },
  { key: 'committed', label: 'committed', align: 'right', format: (v) => (num(v) > 0 ? money0(v) : '') },
  { key: 'proposed_variations', label: 'vars?', align: 'right', format: (v) => (num(v) > 0 ? String(v) : '') },
  { key: 'status', label: 'status' },
];

const CLAIM_COLS = [
  { key: 'ref', label: 'ref' },
  { key: 'job_ref', label: 'job' },
  { key: 'client', label: 'client', width: 22 },
  { key: 'claimed_on', label: 'claimed', format: (v) => isoDate(v) },
  { key: 'amount', label: 'amount', align: 'right', format: (v) => money0(v) },
  { key: 'retention_held', label: 'retention', align: 'right', format: (v) => (num(v) > 0 ? money0(v) : '') },
  { key: 'due_on', label: 'due', format: (v) => isoDate(v) },
  { key: 'paid_on', label: 'paid', format: (v) => isoDate(v) },
  { key: 'state', label: 'state' },
];

// ---------------------------------------------------------------------------
// Reads

async function cmdClients(db, args, flags) {
  const rows = await db.query(
    `select cl.name, coalesce(cl.contact_name, '') as contact, coalesce(cl.phone, '') as phone, cl.status,
            (select count(*) from jobs j where j.client_id = cl.id) as jobs,
            (select coalesce(sum(j.contract_value), 0) from jobs j where j.client_id = cl.id and j.status in ('active','complete')) as contracted,
            (select coalesce(sum(pc.amount - pc.amount_paid), 0) from progress_claims pc join jobs j on j.id = pc.job_id where j.client_id = cl.id and pc.status = 'served') as owing
     from clients cl where cl.status = 'active' or $1 order by cl.name`,
    [Boolean(flags.all)],
  );
  return {
    json: rows,
    text:
      heading(`Clients (${rows.length})`) +
      '\n' +
      table(rows, [
        { key: 'name', label: 'client', width: 26 },
        { key: 'contact', label: 'contact', width: 18 },
        { key: 'phone', label: 'phone' },
        { key: 'jobs', label: 'jobs', align: 'right' },
        { key: 'contracted', label: 'contracted', align: 'right', format: (v) => money0(v) },
        { key: 'owing', label: 'owing now', align: 'right', format: (v) => (num(v) > 0 ? money0(v) : '') },
        { key: 'status', label: 'status' },
      ]),
  };
}

async function cmdClient(db, args) {
  const c = await resolve(db, 'client', args.join(' '));
  const jobs = await db.query('select * from v_jobs where client_id = $1 order by ref desc', [c.id]);
  const claims = await db.query('select * from v_claims where client = $1 order by claimed_on desc', [c.name]);
  const cnotes = await db.query('select noted_on, note from notes where client_id = $1 order by noted_on desc', [c.id]);
  const json = { client: c, jobs, claims, notes: cnotes };
  let text = heading(c.name) +
    `\n  ${c.contact_name || ''}${c.phone ? ` | ${c.phone}` : ''}${c.email ? ` | ${c.email}` : ''} | ${c.status}`;
  if (c.address) text += `\n  ${c.address}`;
  text += '\n' + heading('Jobs') + '\n' + table(jobs, JOB_COLS.filter((x) => x.key !== 'client'));
  if (claims.length) text += '\n' + heading('Claims') + '\n' + table(claims, CLAIM_COLS.filter((x) => x.key !== 'client'));
  if (cnotes.length) {
    text += '\n' + heading('The log') + '\n' + table(cnotes, [
      { key: 'noted_on', label: 'date', format: (v) => isoDate(v) },
      { key: 'note', label: 'note', width: 84 },
    ]);
  }
  return { json, text };
}

async function cmdJobs(db, args, flags) {
  const where = ["(status = 'active' or $1)"];
  const params = [Boolean(flags.all)];
  if (flags.type) {
    params.push(str(flags.type));
    where.push(`job_type = $${params.length}`);
  }
  if (flags.client) {
    const c = await resolve(db, 'client', flags.client);
    params.push(c.id);
    where.push(`client_id = $${params.length}`);
  }
  const rows = await db.query(`select * from v_jobs where ${where.join(' and ')} order by case status when 'active' then 1 when 'quote' then 2 when 'complete' then 3 else 4 end, ref`, params);
  const owed = rows.reduce((s, r) => s + num(r.outstanding), 0);
  return {
    json: rows,
    text:
      heading(`Jobs (${rows.length}${flags.all ? '' : ' active'})`) +
      '\n' +
      table(rows, JOB_COLS) +
      (owed > 0 ? `\n\n  ${money0(owed)} claimed and not yet paid across these jobs. \`claims\` shows which, worst first.` : ''),
  };
}

async function cmdJob(db, args, flags) {
  const sub = args[0];
  if (sub === 'add') return cmdJobAdd(db, args.slice(1), flags);
  if (sub === 'win') return cmdJobWin(db, args.slice(1), flags);
  if (sub === 'complete') return cmdJobComplete(db, args.slice(1), flags);
  const j = await resolve(db, 'job', args.join(' '));
  const [row] = await db.query('select * from v_jobs where job_id = $1', [j.id]);
  const budget = await db.query('select * from v_budget where job_id = $1 order by cost_code', [j.id]);
  const variations = await db.query('select * from v_variations where job_ref = $1 order by proposed_on', [row.ref]);
  const claims = await db.query('select * from v_claims where job_ref = $1 order by claimed_on', [row.ref]);
  const crew = await db.query(
    `select s.name, s.trade, js.scope, js.agreed_price, js.restricted_work, vs.insurance, vs.lbp_number
     from job_subbies js join subbies s on s.id = js.subbie_id join v_subbies vs on vs.subbie_id = s.id
     where js.job_id = $1 order by s.name`, [j.id]);
  const jtasks = await db.query('select * from v_tasks where job_ref = $1 order by starts_on', [row.ref]);
  const jnotes = await db.query('select noted_on, note from notes where job_id = $1 order by noted_on desc', [j.id]);
  const json = { job: row, budget, variations, claims, crew, tasks: jtasks, notes: jnotes };
  let text = heading(`${row.ref}  ${row.job}`) +
    `\n  ${row.client} | ${row.site_address || ''} | ${row.job_type} | ${row.status.toUpperCase()}` +
    `\n  contract ${money0(row.contract_value)}${num(row.approved_variations) ? ` + ${money0(row.approved_variations)} approved variations = ${money0(row.revised_contract)}` : ''}` +
    `${row.contract_signed_on ? ` | signed ${isoDate(row.contract_signed_on)}` : num(row.contract_value) >= WRITTEN_CONTRACT_FLOOR ? ' | NO SIGNED CONTRACT DATE ON RECORD' : ''}` +
    `\n  claimed ${money0(row.claimed)}, paid ${money0(row.paid)}${num(row.outstanding) ? `, OWED ${money0(row.outstanding)}` : ''} | costs ${money0(row.costs_actual)}${num(row.committed) ? ` + ${money0(row.committed)} committed` : ''} | forecast margin ${money0(row.forecast_margin)}`;
  if (num(row.retention_held) > 0) text += `\n  retention held: ${money0(row.retention_held)}`;
  if (budget.length) {
    text += '\n' + heading('Budget vs actual') + '\n' + table(budget, [
      { key: 'cost_code', label: 'code' },
      { key: 'line', label: 'line', width: 20 },
      { key: 'budget', label: 'budget', align: 'right', format: (v) => money0(v) },
      { key: 'actual', label: 'actual', align: 'right', format: (v) => money0(v) },
      { key: 'committed', label: 'committed', align: 'right', format: (v) => (num(v) > 0 ? money0(v) : '') },
      { key: 'remaining', label: 'remaining', align: 'right', format: (v) => money0(v) },
      { key: 'state', label: 'state' },
    ]);
  }
  if (variations.length) {
    text += '\n' + heading('Variations') + '\n' + table(variations, [
      { key: 'ref', label: 'ref' },
      { key: 'description', label: 'description', width: 42 },
      { key: 'price', label: 'price', align: 'right', format: (v) => money0(v) },
      { key: 'proposed_on', label: 'proposed', format: (v) => isoDate(v) },
      { key: 'status', label: 'status' },
      { key: 'approved_by', label: 'approved by', format: (v) => v || '' },
    ]);
  }
  if (claims.length) text += '\n' + heading('Progress claims') + '\n' + table(claims, CLAIM_COLS.filter((x) => !['job_ref', 'client'].includes(x.key)));
  if (crew.length) {
    text += '\n' + heading('The crew') + '\n' + table(crew, [
      { key: 'name', label: 'subbie', width: 24 },
      { key: 'trade', label: 'trade' },
      { key: 'scope', label: 'scope', width: 28 },
      { key: 'agreed_price', label: 'price', align: 'right', format: (v) => (num(v) > 0 ? money0(v) : '') },
      { key: 'restricted_work', label: 'RBW', format: (v) => (v ? 'yes' : '') },
      { key: 'insurance', label: 'insurance' },
      { key: 'lbp_number', label: 'LBP', format: (v) => v || '' },
    ]);
  }
  if (jtasks.length) {
    text += '\n' + heading('Schedule') + '\n' + table(jtasks, [
      { key: 'task', label: 'task', width: 28 },
      { key: 'trade', label: 'trade', format: (v) => v || '' },
      { key: 'subbie', label: 'subbie', width: 22, format: (v) => v || '' },
      { key: 'starts_on', label: 'starts', format: (v) => isoDate(v) },
      { key: 'ends_on', label: 'ends', format: (v) => isoDate(v) },
      { key: 'state', label: 'state' },
    ]);
  }
  if (jnotes.length) {
    text += '\n' + heading('The site diary') + '\n' + table(jnotes, [
      { key: 'noted_on', label: 'date', format: (v) => isoDate(v) },
      { key: 'note', label: 'note', width: 84 },
    ]);
  }
  return { json, text };
}

async function cmdPipeline(db) {
  const rows = await db.query(`select * from v_jobs where status = 'quote' order by days_since_quoted desc`);
  const value = rows.reduce((s, r) => s + num(r.contract_value), 0);
  return {
    json: rows,
    text:
      heading(`The pipeline (${rows.length} quotes, ${money0(value)})`) +
      '\n' +
      table(rows, [
        { key: 'ref', label: 'ref' },
        { key: 'job', label: 'job', width: 26 },
        { key: 'client', label: 'client', width: 22 },
        { key: 'job_type', label: 'type' },
        { key: 'contract_value', label: 'quoted at', align: 'right', format: (v) => money0(v) },
        { key: 'quoted_on', label: 'quoted', format: (v) => isoDate(v) },
        { key: 'days_since_quoted', label: 'days', align: 'right' },
      ]) +
      '\n\n  A quote past 14 days without a decision is going cold: ring them or lose it.\n  Won: job win <ref> --signed=<date>. Lost: log it, then update the record honestly.',
  };
}

async function cmdBudget(db, args, flags) {
  if (args[0] === 'add') return cmdBudgetAdd(db, args.slice(1), flags);
  const j = await resolve(db, 'job', args.join(' '));
  const rows = await db.query('select * from v_budget where job_id = $1 order by cost_code', [j.id]);
  const totals = rows.reduce((t, r) => ({ budget: t.budget + num(r.budget), actual: t.actual + num(r.actual), committed: t.committed + num(r.committed) }), { budget: 0, actual: 0, committed: 0 });
  return {
    json: rows,
    text:
      heading(`${j.ref}  budget vs actual`) +
      '\n' +
      table(rows, [
        { key: 'cost_code', label: 'code' },
        { key: 'line', label: 'line', width: 22 },
        { key: 'budget', label: 'budget', align: 'right', format: (v) => money0(v) },
        { key: 'actual', label: 'actual', align: 'right', format: (v) => money0(v) },
        { key: 'committed', label: 'committed', align: 'right', format: (v) => (num(v) > 0 ? money0(v) : '') },
        { key: 'remaining', label: 'remaining', align: 'right', format: (v) => money0(v) },
        { key: 'state', label: 'state' },
      ]) +
      `\n\n  Totals: ${money0(totals.budget)} budgeted, ${money0(totals.actual)} actual, ${money0(totals.committed)} committed, ${money0(totals.budget - totals.actual - totals.committed)} remaining.` +
      '\n  Committed is open purchase orders: money already promised that no invoice has landed for yet.',
  };
}

async function cmdCosts(db, args, flags) {
  const where = ['true'];
  const params = [];
  if (flags.job) {
    const j = await resolve(db, 'job', flags.job);
    params.push(j.id);
    where.push(`co.job_id = $${params.length}`);
  }
  const rows = await db.query(
    `select j.ref as job_ref, bl.cost_code, bl.name as line, co.incurred_on, coalesce(co.supplier, '') as supplier,
            coalesce(co.invoice_ref, '') as invoice, co.amount, po.ref as po_ref
     from costs co join jobs j on j.id = co.job_id join budget_lines bl on bl.id = co.budget_line_id
     left join purchase_orders po on po.id = co.purchase_order_id
     where ${where.join(' and ')} order by co.incurred_on desc limit 100`,
    params,
  );
  return {
    json: rows,
    text:
      heading(`Costs (latest ${rows.length})`) +
      '\n' +
      table(rows, [
        { key: 'incurred_on', label: 'date', format: (v) => isoDate(v) },
        { key: 'job_ref', label: 'job' },
        { key: 'line', label: 'line', width: 18 },
        { key: 'supplier', label: 'supplier', width: 24 },
        { key: 'invoice', label: 'invoice' },
        { key: 'po_ref', label: 'PO', format: (v) => v || '' },
        { key: 'amount', label: 'amount', align: 'right', format: (v) => money0(v) },
      ]),
  };
}

async function cmdOrders(db, args, flags) {
  const where = ["(po.status = 'open' or $1)"];
  const params = [Boolean(flags.all)];
  if (flags.job) {
    const j = await resolve(db, 'job', flags.job);
    params.push(j.id);
    where.push(`po.job_id = $${params.length}`);
  }
  const rows = await db.query(
    `select po.ref, j.ref as job_ref, bl.name as line, po.supplier, po.amount, po.issued_on,
            (current_date - po.issued_on) as days_open, po.status, po.billed_on
     from purchase_orders po join jobs j on j.id = po.job_id join budget_lines bl on bl.id = po.budget_line_id
     where ${where.join(' and ')} order by po.status, po.issued_on`,
    params,
  );
  return {
    json: rows,
    text:
      heading(`Purchase orders (${rows.length}${flags.all ? '' : ' open'})`) +
      '\n' +
      table(rows, [
        { key: 'ref', label: 'ref' },
        { key: 'job_ref', label: 'job' },
        { key: 'line', label: 'line', width: 18 },
        { key: 'supplier', label: 'supplier', width: 24 },
        { key: 'amount', label: 'amount', align: 'right', format: (v) => money0(v) },
        { key: 'issued_on', label: 'issued', format: (v) => isoDate(v) },
        { key: 'days_open', label: 'days', align: 'right', format: (v, r) => (r.status === 'open' ? String(v) : '') },
        { key: 'status', label: 'status' },
      ]) +
      '\n\n  An open PO is committed money the budget report counts before the invoice lands.\n  When the invoice arrives: po bill <ref> [--amount=]. Never needed: po cancel <ref>.',
  };
}

async function cmdVariations(db, args, flags) {
  const where = ["(c.status = 'proposed' or $1)"];
  const params = [Boolean(flags.all)];
  if (flags.job) {
    const j = await resolve(db, 'job', flags.job);
    params.push(j.ref);
    where.push(`c.job_ref = $${params.length}`);
  }
  const rows = await db.query(`select * from v_variations c where ${where.join(' and ')} order by c.status, c.proposed_on`, params);
  const waiting = rows.filter((r) => r.status === 'proposed');
  const waitingValue = waiting.reduce((s, r) => s + num(r.price), 0);
  return {
    json: rows,
    text:
      heading(`Variations (${rows.length}${flags.all ? '' : ' proposed'})`) +
      '\n' +
      table(rows, [
        { key: 'ref', label: 'ref' },
        { key: 'job_ref', label: 'job' },
        { key: 'client', label: 'client', width: 20 },
        { key: 'description', label: 'description', width: 38 },
        { key: 'price', label: 'price', align: 'right', format: (v) => money0(v) },
        { key: 'proposed_on', label: 'proposed', format: (v) => isoDate(v) },
        { key: 'days_waiting', label: 'days', align: 'right', format: (v, r) => (r.status === 'proposed' ? String(v) : '') },
        { key: 'status', label: 'status' },
      ]) +
      (waiting.length
        ? `\n\n  ${money0(waitingValue)} of proposed variation work is not claimable until it is approved in writing.\n  No variation work starts on a proposal. Approved: variation approve <ref> --by="who said yes". Declined: variation decline <ref>.`
        : ''),
  };
}

async function cmdClaims(db, args, flags) {
  const where = ["(c.status = 'served' or $1)"];
  const params = [Boolean(flags.all)];
  if (flags.job) {
    const j = await resolve(db, 'job', flags.job);
    params.push(j.ref);
    where.push(`c.job_ref = $${params.length}`);
  }
  const rows = await db.query(
    `select * from v_claims c where ${where.join(' and ')} order by case c.state when 'OVERDUE' then 1 when 'served' then 2 else 3 end, c.days_overdue desc`,
    params,
  );
  const overdue = rows.filter((r) => r.state === 'OVERDUE');
  const owed = rows.filter((r) => r.status === 'served').reduce((s, r) => s + num(r.amount), 0);
  return {
    json: rows,
    text:
      heading(`Progress claims (${rows.length}${flags.all ? '' : ' unpaid'}, ${money0(owed)} owed)`) +
      '\n' +
      table(rows, CLAIM_COLS) +
      (overdue.length
        ? `\n\n  ${overdue.length} claim(s) past due. The Construction Contracts Act gives an unpaid claim real remedies;\n  the polite chase is a phone call today, and the paper trail starts in the diary (log <PC-ref> "...").`
        : ''),
  };
}

async function cmdSubbies(db, args, flags) {
  const rows = await db.query(
    `select * from v_subbies where status = 'active' or $1
     order by case insurance when 'EXPIRED' then 1 when 'NONE' then 2 when 'expiring' then 3 else 4 end, name`,
    [Boolean(flags.all)],
  );
  return {
    json: rows,
    text:
      heading(`Subbies (${rows.length})`) +
      '\n' +
      table(rows, [
        { key: 'name', label: 'subbie', width: 26 },
        { key: 'trade', label: 'trade' },
        { key: 'contact_name', label: 'contact', width: 16, format: (v) => v || '' },
        { key: 'phone', label: 'phone', format: (v) => v || '' },
        { key: 'liability_expires_on', label: 'liability expires', format: (v) => isoDate(v) },
        { key: 'insurance', label: 'insurance' },
        { key: 'lbp_number', label: 'LBP', format: (v) => v || '' },
        { key: 'active_jobs', label: 'on jobs', align: 'right', format: (v) => (num(v) > 0 ? String(v) : '') },
      ]) +
      '\n\n  A subbie with EXPIRED or no public liability does not get assigned to a job; the CLI refuses.\n  Renewal on record: insurance <subbie> --expires=. Restricted building work needs an LBP: lbp <subbie> --number=.',
  };
}

async function cmdSubbie(db, args) {
  const s = await resolve(db, 'subbie', args.join(' '));
  const [row] = await db.query('select * from v_subbies where subbie_id = $1', [s.id]);
  const assignments = await db.query(
    `select j.ref as job_ref, j.name as job, j.status as job_status, js.scope, js.agreed_price, js.restricted_work, js.assigned_on
     from job_subbies js join jobs j on j.id = js.job_id where js.subbie_id = $1 order by js.assigned_on desc`, [s.id]);
  const spend = await db.query(
    `select j.ref as job_ref, sum(co.amount) as billed from costs co join jobs j on j.id = co.job_id
     where lower(coalesce(co.supplier, '')) = lower($1) group by j.ref order by j.ref`, [s.name]);
  const snotes = await db.query('select noted_on, note from notes where subbie_id = $1 order by noted_on desc', [s.id]);
  const json = { subbie: row, assignments, billed: spend, notes: snotes };
  let text = heading(`${row.name} (${row.trade})`) +
    `\n  ${row.contact_name || ''}${row.phone ? ` | ${row.phone}` : ''} | public liability ${row.liability_expires_on ? `expires ${isoDate(row.liability_expires_on)}` : 'NOT ON RECORD'} (${row.insurance})${row.lbp_number ? ` | LBP ${row.lbp_number}` : ''}`;
  if (assignments.length) {
    text += '\n' + heading('On jobs') + '\n' + table(assignments, [
      { key: 'job_ref', label: 'job' },
      { key: 'job', label: '', width: 24 },
      { key: 'scope', label: 'scope', width: 28 },
      { key: 'agreed_price', label: 'price', align: 'right', format: (v) => (num(v) > 0 ? money0(v) : '') },
      { key: 'restricted_work', label: 'RBW', format: (v) => (v ? 'yes' : '') },
      { key: 'job_status', label: 'status' },
    ]);
  }
  if (spend.length) {
    text += '\n' + heading('Billed to date') + '\n' + table(spend, [
      { key: 'job_ref', label: 'job' },
      { key: 'billed', label: 'billed', align: 'right', format: (v) => money0(v) },
    ]);
  }
  if (snotes.length) {
    text += '\n' + heading('The log') + '\n' + table(snotes, [
      { key: 'noted_on', label: 'date', format: (v) => isoDate(v) },
      { key: 'note', label: 'note', width: 84 },
    ]);
  }
  return { json, text };
}

async function cmdSchedule(db, args, flags) {
  const where = ["t.status = 'planned'"];
  const params = [];
  if (flags.job) {
    const j = await resolve(db, 'job', flags.job);
    params.push(j.ref);
    where.push(`t.job_ref = $${params.length}`);
  } else if (!flags.all) {
    where.push('t.starts_on <= current_date + 7');
  }
  const rows = await db.query(`select * from v_tasks t where ${where.join(' and ')} order by t.ends_on, t.starts_on`, params);
  return {
    json: rows,
    text:
      heading(`The schedule (${rows.length}${flags.all || flags.job ? '' : ' in the next 7 days'})`) +
      '\n' +
      table(rows, [
        { key: 'job_ref', label: 'job' },
        { key: 'task', label: 'task', width: 30 },
        { key: 'trade', label: 'trade', format: (v) => v || '' },
        { key: 'subbie', label: 'subbie', width: 22, format: (v) => v || '' },
        { key: 'starts_on', label: 'starts', format: (v) => isoDate(v) },
        { key: 'ends_on', label: 'ends', format: (v) => isoDate(v) },
        { key: 'state', label: 'state' },
      ]) +
      '\n\n  Every late task pushes the claim behind it. Done: task done <job> "<task>". New: task add <job> "<task>" --starts= --ends=.',
  };
}

async function cmdProfit(db) {
  const rows = await db.query(
    `select * from v_jobs where status in ('active', 'complete')
     order by case status when 'active' then 1 else 2 end, forecast_margin / nullif(revised_contract, 0)`,
  );
  const withPct = rows.map((r) => ({ ...r, margin_pct: num(r.revised_contract) ? (100 * num(r.forecast_margin)) / num(r.revised_contract) : null }));
  return {
    json: withPct,
    text:
      heading('Margin by job, worst first') +
      '\n' +
      table(withPct, [
        { key: 'ref', label: 'ref' },
        { key: 'job', label: 'job', width: 26 },
        { key: 'job_type', label: 'type' },
        { key: 'revised_contract', label: 'contract', align: 'right', format: (v) => money0(v) },
        { key: 'costs_actual', label: 'costs', align: 'right', format: (v) => money0(v) },
        { key: 'committed', label: 'committed', align: 'right', format: (v) => (num(v) > 0 ? money0(v) : '') },
        { key: 'forecast_margin', label: 'margin', align: 'right', format: (v) => money0(v) },
        { key: 'margin_pct', label: 'margin %', align: 'right', format: (v) => pct(v) },
        { key: 'status', label: 'status' },
      ]) +
      '\n\n  Margin here is contract plus approved variations, less actual costs and open purchase orders.\n  It is the forecast, not the final: `budget <job>` shows which line is doing the damage.',
  };
}

async function cmdAttention(db) {
  const rows = await db.query(`
    select * from v_attention
    order by case reason
      when 'claim_overdue' then 1
      when 'variation_unapproved' then 2
      when 'insurance_expired' then 3
      when 'budget_over' then 4
      when 'retention_due' then 5
      when 'quote_stale' then 6
      when 'claim_gap' then 7
      when 'po_aged' then 8
      when 'task_late' then 9
      when 'job_quiet' then 10
      when 'insurance_expiring' then 11
      else 12 end,
      days desc nulls last
  `);
  return {
    json: rows,
    text:
      heading(`Needs a decision (${rows.length})`) +
      '\n' +
      table(rows, [
        { key: 'reason', label: 'why' },
        { key: 'label', label: 'record', width: 12 },
        { key: 'client', label: 'who', width: 22 },
        { key: 'place', label: 'where', width: 24 },
        { key: 'days', label: 'days', align: 'right', format: (v) => (v === null || v === undefined ? '' : String(v)) },
        { key: 'detail', label: 'detail', width: 80 },
      ]),
  };
}

async function cmdStats(db) {
  const [c] = await db.query(`
    select (select count(*) from jobs where status = 'active')                                                    as active_jobs,
           (select count(*) from jobs where status = 'quote')                                                     as quotes,
           (select coalesce(sum(contract_value), 0) from jobs where status = 'quote')                             as pipeline_value,
           (select coalesce(sum(amount), 0) from progress_claims where status = 'served')                         as owed,
           (select count(*) from v_claims where state = 'OVERDUE')                                                as claims_overdue,
           (select count(*) from variations where status = 'proposed')                                            as variations_proposed,
           (select coalesce(sum(price), 0) from variations where status = 'proposed')                             as variations_value,
           (select coalesce(sum(amount), 0) from purchase_orders where status = 'open')                           as committed,
           (select count(*) from v_subbies s join job_subbies js on js.subbie_id = s.subbie_id
              join jobs j on j.id = js.job_id and j.status = 'active' where s.insurance in ('EXPIRED', 'NONE'))   as uninsured_on_site,
           (select count(*) from v_tasks where state = 'LATE')                                                    as tasks_late,
           (select count(*) from v_attention)                                                                     as attention_items
  `);
  const json = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Number(v)]));
  return {
    json,
    text:
      heading('The business') +
      `\n  ${json.active_jobs} active job(s), ${json.quotes} quote(s) out worth ${money0(json.pipeline_value)}` +
      `\n  ${money0(json.owed)} claimed and unpaid${json.claims_overdue ? ` (${json.claims_overdue} claim(s) OVERDUE)` : ''}, ${money0(json.committed)} committed on open purchase orders` +
      `\n  ${json.variations_proposed} variation(s) awaiting approval worth ${money0(json.variations_value)}` +
      `\n  ${json.uninsured_on_site ? `${json.uninsured_on_site} subbie(s) on active jobs with EXPIRED or no public liability` : 'every assigned subbie carries current public liability'}` +
      `\n  ${json.tasks_late} task(s) late, ${json.attention_items} item(s) on the attention list`,
  };
}

// ---------------------------------------------------------------------------
// The pipeline: quote in, contract signed, job won, with the s362F gate.

async function cmdJobAdd(db, args, flags) {
  const name = args.join(' ');
  if (!name) throw new CliError('job add "<job name>" --client="<client>" --value=<quoted price> [--type= --site= --quoted=]');
  const c = await resolve(db, 'client', str(flags.client));
  const value = parseMoney(flags.value, 'The quoted price (--value=)');
  const type = str(flags.type) || 'new_build';
  if (!JOB_TYPES.includes(type)) throw new CliError(`--type= is one of: ${JOB_TYPES.join(', ')}`);
  const ref = await nextRef(db, 'JOB', 'jobs', 'ref', 100);
  const [row] = await db.query(
    `insert into jobs (ref, client_id, name, site_address, job_type, status, quoted_on, contract_value, retention_pct)
     values ($1, $2, $3, $4, $5, 'quote', $6, $7, $8) returning *`,
    [ref, c.id, name, str(flags.site) || null, type, parseDate(flags.quoted) || today(), value, Number(flags['retention-pct'] || 0)],
  );
  let text = `${ref} quoted: ${name} for ${c.name} at ${money0(value)}.`;
  text += `\nWhen they say yes: job win ${ref}${value >= WRITTEN_CONTRACT_FLOOR ? ' --signed=<date the contract was signed>' : ''}. Build the budget: budget add ${ref} --code= --name= --budget=`;
  return { json: row, text };
}

async function cmdJobWin(db, args, flags) {
  const j = await resolve(db, 'job', args.join(' '));
  if (j.status === 'active') throw new CliError(`${j.ref} is already active.`);
  if (j.status === 'complete') throw new CliError(`${j.ref} is complete. A new stage of work is a new job or a variation.`);
  const signed = parseDate(flags.signed) || (j.contract_signed_on ? isoDate(j.contract_signed_on) : null);
  if (num(j.contract_value) >= WRITTEN_CONTRACT_FLOOR && !signed) {
    throw new CliError(
      `${j.ref} is ${money0(j.contract_value)} of residential building work, and section 362F of the Building Act 2004\n` +
        `requires a written contract at ${money0(WRITTEN_CONTRACT_FLOOR)} or more. It does not become an active job on a handshake,\n` +
        `and there is no force flag: the written contract is what protects you when the money is argued about later.\n` +
        `Get it signed, then: job win ${j.ref} --signed=<date it was signed>`,
    );
  }
  const [row] = await db.query(
    `update jobs set status = 'active', contract_signed_on = coalesce($1, contract_signed_on), started_on = coalesce($2, started_on, current_date) where id = $3 returning *`,
    [signed, parseDate(flags.start), j.id],
  );
  let text = `${j.ref} won${signed ? `: contract signed ${signed}` : ''}. It is active from ${isoDate(row.started_on)}.`;
  if (num(j.contract_value) < WRITTEN_CONTRACT_FLOOR && !signed) text += `\nUnder ${money0(WRITTEN_CONTRACT_FLOOR)} a written contract is not required by s362F, but it is still the cheap insurance: paper it anyway.`;
  const lines = await db.query('select count(*) as n from budget_lines where job_id = $1', [j.id]);
  if (!num(lines[0].n)) text += `\nNo budget lines yet: the estimate becomes the budget, line by line. budget add ${j.ref} --code=01 --name=Preliminaries --budget=`;
  return { json: row, text };
}

async function cmdJobComplete(db, args, flags) {
  const j = await resolve(db, 'job', args.join(' '));
  if (j.status === 'complete') throw new CliError(`${j.ref} is already complete.`);
  if (j.status !== 'active') throw new CliError(`${j.ref} is ${j.status}; only an active job completes.`);
  const unpaid = await db.query(`select ref, amount from progress_claims where job_id = $1 and status = 'served'`, [j.id]);
  const proposed = await db.query(`select ref, price from variations where job_id = $1 and status = 'proposed'`, [j.id]);
  const open = await db.query(`select ref, supplier, amount from purchase_orders where job_id = $1 and status = 'open'`, [j.id]);
  if (unpaid.length || proposed.length || open.length) {
    const bits = [];
    for (const u of unpaid) bits.push(`  ${u.ref}: ${money0(u.amount)} claimed and not paid (paid ${u.ref} when it lands, or chase it)`);
    for (const p of proposed) bits.push(`  ${p.ref}: ${money0(p.price)} variation still proposed (approve it and claim it, or decline it)`);
    for (const o of open) bits.push(`  ${o.ref}: ${money0(o.amount)} open with ${o.supplier} (po bill or po cancel)`);
    throw new CliError(
      `${j.ref} does not hand over with loose ends, because every one of these is money:\n${bits.join('\n')}\n` +
        `Close each one, then: job complete ${j.ref}`,
    );
  }
  const [row] = await db.query(`update jobs set status = 'complete', completed_on = $1 where id = $2 returning *`, [parseDate(flags.on) || today(), j.id]);
  const [v] = await db.query('select * from v_jobs where job_id = $1', [j.id]);
  let text = `${j.ref} complete: ${money0(v.claimed)} claimed against a ${money0(v.revised_contract)} contract, ${money0(v.costs_actual)} of costs, margin ${money0(v.forecast_margin)}.`;
  if (num(v.retention_held) > 0) text += `\n${money0(v.retention_held)} of retention is still held. It is trust money under the Construction Contracts Act: diarise the release date now.`;
  return { json: row, text };
}

// ---------------------------------------------------------------------------
// The budget and the costs

async function cmdBudgetAdd(db, args, flags) {
  const j = await resolve(db, 'job', args.join(' '));
  const name = str(flags.name);
  if (!name) throw new CliError(`budget add ${j.ref} --code=03 --name=Framing --budget=<amount>`);
  const budget = parseMoney(flags.budget ?? 0, '--budget=');
  const code = str(flags.code) || String((await db.query('select count(*) as n from budget_lines where job_id = $1', [j.id]))[0].n + 1).padStart(2, '0');
  const [row] = await db.query(
    `insert into budget_lines (job_id, cost_code, name, budget) values ($1, $2, $3, $4) returning *`,
    [j.id, code, name, budget],
  );
  return { json: row, text: `${j.ref} ${code} ${name}: ${money0(budget)} budgeted. Costs land on it with: cost ${j.ref} --line=${code} --amount= --supplier=` };
}

async function cmdCost(db, args, flags) {
  const j = await resolve(db, 'job', args.join(' ') || str(flags.job));
  if (j.status === 'quote' || j.status === 'lost') {
    throw new CliError(`${j.ref} is a ${j.status}, and costs do not land on jobs you have not won. If the work is real, win the job first: job win ${j.ref}`);
  }
  const line = await resolveLine(db, j.id, flags.line);
  const amount = parseMoney(flags.amount, '--amount=');
  const po = flags.po ? await resolve(db, 'po', flags.po) : null;
  const [row] = await db.query(
    `insert into costs (job_id, budget_line_id, purchase_order_id, incurred_on, supplier, invoice_ref, amount, note)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
    [j.id, line.id, po?.id || null, parseDate(flags.on) || today(), str(flags.supplier) || null, str(flags.invoice) || null, amount, str(flags.note) || null],
  );
  if (po && po.status === 'open') await db.query(`update purchase_orders set status = 'billed', billed_on = $1 where id = $2`, [parseDate(flags.on) || today(), po.id]);
  const [b] = await db.query('select * from v_budget where line_id = $1', [line.id]);
  let text = `${money0(amount)} on ${j.ref} ${line.cost_code} ${line.name}${str(flags.supplier) ? ` (${str(flags.supplier)}${str(flags.invoice) ? ` ${str(flags.invoice)}` : ''})` : ''}${po ? `, ${po.ref} marked billed` : ''}.`;
  text += `\nLine now ${money0(b.actual)} actual${num(b.committed) ? ` + ${money0(b.committed)} committed` : ''} against ${money0(b.budget)}: ${b.state === 'OVER' ? `OVER by ${money0(num(b.actual) + num(b.committed) - num(b.budget))}. That is a conversation this week, not a surprise at the end.` : `${money0(b.remaining)} remaining.`}`;
  return { json: row, text };
}

async function cmdPo(db, args, flags) {
  const sub = args[0];
  if (sub === 'create') {
    const j = await resolve(db, 'job', args.slice(1).join(' ') || str(flags.job));
    if (j.status !== 'active') throw new CliError(`${j.ref} is ${j.status}; purchase orders belong to active jobs.`);
    const line = await resolveLine(db, j.id, flags.line);
    const supplier = str(flags.supplier);
    if (!supplier) throw new CliError('po create <job> --line= --supplier= --amount=');
    const amount = parseMoney(flags.amount, '--amount=');
    const ref = await nextRef(db, 'PO', 'purchase_orders', 'ref', 300);
    const [row] = await db.query(
      `insert into purchase_orders (ref, job_id, budget_line_id, supplier, amount, issued_on, note) values ($1, $2, $3, $4, $5, $6, $7) returning *`,
      [ref, j.id, line.id, supplier, amount, parseDate(flags.on) || today(), str(flags.note) || null],
    );
    const [b] = await db.query('select * from v_budget where line_id = $1', [line.id]);
    let text = `${ref}: ${money0(amount)} to ${supplier} on ${j.ref} ${line.cost_code} ${line.name}.`;
    if (b.state === 'OVER') text += `\nThat commits the line OVER budget: ${money0(num(b.actual) + num(b.committed))} against ${money0(b.budget)}. Eyes open.`;
    text += `\nWhen the invoice lands: po bill ${ref} [--amount=]  (records the cost and closes the PO)`;
    return { json: row, text };
  }
  if (sub === 'bill') {
    const po = await resolve(db, 'po', args[1]);
    if (po.status !== 'open') throw new CliError(`${po.ref} is ${po.status}.`);
    const amount = flags.amount !== undefined ? parseMoney(flags.amount, '--amount=') : num(po.amount);
    const on = parseDate(flags.on) || today();
    const [cost] = await db.query(
      `insert into costs (job_id, budget_line_id, purchase_order_id, incurred_on, supplier, invoice_ref, amount)
       values ($1, $2, $3, $4, $5, $6, $7) returning *`,
      [po.job_id, po.budget_line_id, po.id, on, po.supplier, str(flags.invoice) || null, amount],
    );
    await db.query(`update purchase_orders set status = 'billed', billed_on = $1 where id = $2`, [on, po.id]);
    const [b] = await db.query('select * from v_budget where line_id = $1', [po.budget_line_id]);
    let text = `${po.ref} billed: ${money0(amount)} from ${po.supplier}${amount !== num(po.amount) ? ` (PO was ${money0(po.amount)})` : ''}.`;
    text += `\nLine now ${money0(b.actual)} actual against ${money0(b.budget)} (${b.state}).`;
    return { json: cost, text };
  }
  if (sub === 'cancel') {
    const po = await resolve(db, 'po', args[1]);
    if (po.status !== 'open') throw new CliError(`${po.ref} is ${po.status}; only an open PO cancels.`);
    const [row] = await db.query(`update purchase_orders set status = 'cancelled' where id = $1 returning *`, [po.id]);
    return { json: row, text: `${po.ref} cancelled. The ${money0(po.amount)} comes off the committed column.` };
  }
  throw new CliError('po create <job> --line= --supplier= --amount=, po bill <PO-ref> [--amount= --invoice=], or po cancel <PO-ref>');
}

// ---------------------------------------------------------------------------
// Variations: priced, put in writing, approved BEFORE the work.

async function cmdVariation(db, args, flags) {
  const sub = args[0];
  if (sub === 'add') {
    const j = await resolve(db, 'job', args.slice(1).join(' ') || str(flags.job));
    if (j.status !== 'active') throw new CliError(`${j.ref} is ${j.status}; variations belong to active jobs. A change to a quote is a requote.`);
    const description = str(flags.description);
    if (!description) throw new CliError(`variation add ${j.ref} --description="what changes" --price=<price to the client> [--cost=<what it costs you>]`);
    const price = parseMoney(flags.price, '--price=');
    const ref = await nextRef(db, 'VAR', 'variations', 'ref', 200);
    const [row] = await db.query(
      `insert into variations (ref, job_id, description, price, cost_estimate, proposed_on) values ($1, $2, $3, $4, $5, $6) returning *`,
      [ref, j.id, description, price, flags.cost !== undefined ? parseMoney(flags.cost, '--cost=') : 0, parseDate(flags.on) || today()],
    );
    return {
      json: row,
      text: `${ref} proposed on ${j.ref}: ${description}, ${money0(price)}.` +
        `\nPut it to the client in writing today (npm run docs renders the letter). No variation work, and no claiming it,` +
        `\nuntil: variation approve ${ref} --by="who said yes, and how"`,
    };
  }
  if (sub === 'approve') {
    const v = await resolve(db, 'variation', args[1]);
    if (v.status !== 'proposed') throw new CliError(`${v.ref} is ${v.status}.`);
    const by = str(flags.by);
    if (!by) throw new CliError(`Approved by whom, in writing? variation approve ${v.ref} --by="Sarah Donovan (email 14/3)". That name is your evidence when the invoice is argued about.`);
    const [row] = await db.query(
      `update variations set status = 'approved', decided_on = $1, approved_by = $2 where id = $3 returning *`,
      [parseDate(flags.on) || today(), by, v.id],
    );
    const [j] = await db.query('select * from v_jobs where job_id = $1', [v.job_id]);
    return { json: row, text: `${v.ref} approved by ${by}. ${j.ref}'s contract ceiling is now ${money0(j.revised_contract)} (${money0(j.contract_value)} + ${money0(j.approved_variations)} variations). It is claimable.` };
  }
  if (sub === 'decline') {
    const v = await resolve(db, 'variation', args[1]);
    if (v.status !== 'proposed') throw new CliError(`${v.ref} is ${v.status}.`);
    const [row] = await db.query(`update variations set status = 'declined', decided_on = $1 where id = $2 returning *`, [parseDate(flags.on) || today(), v.id]);
    return { json: row, text: `${v.ref} declined. If any of that work already happened, that is the lesson written down: no variation work on a proposal.` };
  }
  throw new CliError('variation add <job> --description= --price=, variation approve <VAR-ref> --by=, or variation decline <VAR-ref>');
}

// ---------------------------------------------------------------------------
// Progress claims: the Construction Contracts Act machine.

async function cmdClaim(db, args, flags) {
  const j = await resolve(db, 'job', args.join(' ') || str(flags.job));
  if (j.status !== 'active') throw new CliError(`${j.ref} is ${j.status}; progress claims belong to active jobs.`);
  const amount = parseMoney(flags.amount, '--amount=');
  const [v] = await db.query('select * from v_jobs where job_id = $1', [j.id]);
  const ceiling = num(v.revised_contract);
  const already = num(v.claimed);
  if (already + amount > ceiling) {
    const proposed = await db.query(`select ref, price from variations where job_id = $1 and status = 'proposed'`, [j.id]);
    const proposedValue = proposed.reduce((s, r) => s + num(r.price), 0);
    let msg =
      `That claim takes ${j.ref} to ${money0(already + amount)} against a contract ceiling of ${money0(ceiling)}\n` +
      `(${money0(v.contract_value)} contract${num(v.approved_variations) ? ` + ${money0(v.approved_variations)} approved variations` : ''}). It does not go out, and there is no force flag:\n` +
      `a claim beyond the contract is the payment schedule dispute you lose.`;
    if (proposed.length) {
      msg += `\n${money0(proposedValue)} of variations sit unapproved (${proposed.map((p) => p.ref).join(', ')}): if that work is real, the fix is the client's\n` +
        `written yes, not a bigger claim. variation approve <ref> --by=, then claim.`;
    }
    throw new CliError(msg);
  }
  const claimedOn = parseDate(flags.on) || today();
  const due = parseDate(flags.due) || addDays(claimedOn, Number(flags.terms || DEFAULT_CLAIM_TERMS_DAYS));
  const retention = flags.retention !== undefined ? parseMoney(flags.retention, '--retention=') : Math.round(amount * num(j.retention_pct)) / 100;
  const ref = await nextRef(db, 'PC', 'progress_claims', 'ref', 400);
  const [row] = await db.query(
    `insert into progress_claims (ref, job_id, claimed_on, amount, retention_held, due_on, note) values ($1, $2, $3, $4, $5, $6, $7) returning *`,
    [ref, j.id, claimedOn, amount, retention, due, str(flags.note) || null],
  );
  let text = `${ref} served on ${j.ref}: ${money0(amount)}${retention ? ` (${money0(retention)} retention held)` : ''}, due ${due}.` +
    `\nJob now ${money0(already + amount)} claimed of ${money0(ceiling)}.` +
    `\nThe claim paperwork drafts with npm run docs; a person sends it. When the money lands: paid ${ref}`;
  return { json: row, text };
}

async function cmdPaid(db, args, flags) {
  const pc = await resolve(db, 'claim', args[0]);
  if (pc.status === 'paid') throw new CliError(`${pc.ref} was paid ${isoDate(pc.paid_on)}.`);
  const expected = num(pc.amount) - num(pc.retention_held);
  const amount = flags.amount !== undefined ? parseMoney(flags.amount, '--amount=') : expected;
  const [row] = await db.query(
    `update progress_claims set status = 'paid', paid_on = $1, amount_paid = $2 where id = $3 returning *`,
    [parseDate(flags.on) || today(), amount, pc.id],
  );
  let text = `${pc.ref} paid: ${money0(amount)}.`;
  if (amount < expected) text += `\nThat is ${money0(expected - amount)} short of the ${money0(expected)} due${num(pc.retention_held) ? ' (after retention)' : ''}. Short payment without a payment schedule is exactly what the Act exists for: log it and chase it.`;
  return { json: row, text };
}

// ---------------------------------------------------------------------------
// Subbies: insurance at the gate, LBP for restricted work.

async function cmdAssign(db, args, flags) {
  const s = await resolve(db, 'subbie', args.join(' '));
  const j = await resolve(db, 'job', str(flags.job));
  if (j.status !== 'active') throw new CliError(`${j.ref} is ${j.status}; crews go on active jobs.`);
  const [vs] = await db.query('select * from v_subbies where subbie_id = $1', [s.id]);
  if (vs.insurance === 'EXPIRED' || vs.insurance === 'NONE') {
    throw new CliError(
      `${s.name}'s public liability insurance is ${vs.insurance === 'NONE' ? 'not on record' : `expired (${isoDate(s.liability_expires_on)})`}, and an uninsured\n` +
        `subbie on your site is your uncapped risk: an incident lands on you, not their broker. They do not go on the job,\n` +
        `and there is no force flag. Get the current certificate, record it, then assign:\n` +
        `  insurance "${s.name}" --expires=<date on the certificate>`,
    );
  }
  const restricted = Boolean(flags.restricted);
  if (restricted && !s.lbp_number) {
    throw new CliError(
      `That scope is restricted building work, and the Building Act 2004 (ss 84 to 87) requires it to be carried out or\n` +
        `supervised by a Licensed Building Practitioner. ${s.name} has no LBP number on record. Record it, then assign:\n` +
        `  lbp "${s.name}" --number=<their LBP number>   (check it at lbp.govt.nz)`,
    );
  }
  const scope = str(flags.scope);
  if (!scope) throw new CliError(`assign "${s.name}" --job=${j.ref} --scope="what they are doing" [--price= --restricted]`);
  const [row] = await db.query(
    `insert into job_subbies (job_id, subbie_id, scope, agreed_price, restricted_work) values ($1, $2, $3, $4, $5) returning *`,
    [j.id, s.id, scope, flags.price !== undefined ? parseMoney(flags.price, '--price=') : 0, restricted],
  );
  let text = `${s.name} on ${j.ref}: ${scope}${flags.price !== undefined ? ` at ${money0(row.agreed_price)}` : ''}${restricted ? ` (restricted building work, LBP ${s.lbp_number})` : ''}.`;
  if (vs.insurance === 'expiring') text += `\nTheir public liability expires ${isoDate(s.liability_expires_on)} (${vs.days_to_expiry} days): chase the renewal certificate now, not the week it lapses.`;
  return { json: row, text };
}

async function cmdInsurance(db, args, flags) {
  const s = await resolve(db, 'subbie', args.join(' '));
  const expires = parseDate(flags.expires);
  if (!expires) throw new CliError(`insurance "${s.name}" --expires=<expiry date on the public liability certificate>`);
  const [row] = await db.query(`update subbies set liability_expires_on = $1 where id = $2 returning *`, [expires, s.id]);
  return { json: row, text: `${s.name}: public liability on record to ${expires}. Keep the certificate itself in the job file; this is the register that makes it loud.` };
}

async function cmdLbp(db, args, flags) {
  const s = await resolve(db, 'subbie', args.join(' '));
  const number = str(flags.number);
  if (!number) throw new CliError(`lbp "${s.name}" --number=<their Licensed Building Practitioner number>`);
  const [row] = await db.query(`update subbies set lbp_number = $1 where id = $2 returning *`, [number, s.id]);
  return { json: row, text: `${s.name}: LBP ${number} on record. They can take restricted building work.` };
}

// ---------------------------------------------------------------------------
// The schedule

async function cmdTask(db, args, flags) {
  const sub = args[0];
  if (sub === 'add') {
    const j = await resolve(db, 'job', args[1]);
    const name = args.slice(2).join(' ');
    if (!name) throw new CliError(`task add ${j.ref} "<task>" --starts= --ends= [--trade= --subbie=]`);
    const starts = parseDate(flags.starts) || today();
    const ends = parseDate(flags.ends) || starts;
    const s = flags.subbie ? await resolve(db, 'subbie', flags.subbie) : null;
    const [row] = await db.query(
      `insert into tasks (job_id, name, trade, subbie_id, starts_on, ends_on) values ($1, $2, $3, $4, $5, $6) returning *`,
      [j.id, name, str(flags.trade) || s?.trade || null, s?.id || null, starts, ends],
    );
    return { json: row, text: `${j.ref}: "${name}" on the schedule, ${starts} to ${ends}${s ? ` (${s.name})` : ''}.` };
  }
  if (sub === 'done') {
    const j = await resolve(db, 'job', args[1]);
    const q = args.slice(2).join(' ');
    const rows = await db.query(`select * from tasks where job_id = $1 and status = 'planned' and name ilike $2 order by starts_on`, [j.id, `%${q}%`]);
    if (!rows.length) throw new CliError(`No planned task on ${j.ref} matches "${q}". schedule --job=${j.ref} shows them.`);
    if (rows.length > 1) throw new CliError(`"${q}" matches ${rows.length} tasks on ${j.ref}:\n` + rows.map((r) => `  ${r.name} (${isoDate(r.starts_on)} to ${isoDate(r.ends_on)})`).join('\n'));
    const [row] = await db.query(`update tasks set status = 'done', done_on = $1 where id = $2 returning *`, [parseDate(flags.on) || today(), rows[0].id]);
    return { json: row, text: `${j.ref}: "${rows[0].name}" done.` };
  }
  throw new CliError('task add <job> "<task>" --starts= --ends=, or task done <job> "<task>"');
}

// ---------------------------------------------------------------------------
// The site diary, add

async function cmdLog(db, args, flags) {
  const first = str(args[0]);
  let job = null;
  let claim = null;
  let subbie = null;
  let client = null;
  if (/^job/i.test(first)) job = await resolve(db, 'job', first, { optional: true });
  if (!job && /^pc/i.test(first)) claim = await resolve(db, 'claim', first, { optional: true });
  if (!job && !claim) {
    job = await resolve(db, 'job', first, { optional: true });
    if (!job) subbie = await resolve(db, 'subbie', first, { optional: true });
    if (!job && !subbie) client = await resolve(db, 'client', first, { optional: true });
  }
  if (!job && !claim && !subbie && !client) {
    throw new CliError(`"${first}" matches no job, claim, subbie or client. log <JOB-ref | PC-ref | subbie | client> "what happened"`);
  }
  const note = args.slice(1).join(' ');
  if (!note) throw new CliError('What happened? log <target> "what was said, decided, delivered or delayed"');
  const jobId = job?.id || (claim ? claim.job_id : null);
  const [row] = await db.query(
    `insert into notes (client_id, job_id, subbie_id, noted_on, note) values ($1, $2, $3, $4, $5) returning *`,
    [client?.id || null, jobId, subbie?.id || null, parseDate(flags.on) || today(), claim ? `${claim.ref}: ${note}` : note],
  );
  const target = job?.ref || claim?.ref || subbie?.name || client?.name;
  return { json: row, text: `On the diary against ${target}. In a dispute, this entry is the defence.` };
}

async function cmdAdd(db, args, flags) {
  const kind = args[0];
  const name = args.slice(1).join(' ');
  if (!name) throw new CliError(`add ${kind || 'client|subbie'} "<name>" [--flags]`);
  if (kind === 'client') {
    const [row] = await db.query(
      `insert into clients (name, contact_name, email, phone, address) values ($1, $2, $3, $4, $5) returning *`,
      [name, str(flags.contact) || null, str(flags.email) || null, str(flags.phone) || null, str(flags.address) || null],
    );
    return { json: row, text: `${name} on the books.\nQuote them something: job add "<job name>" --client="${name}" --value=` };
  }
  if (kind === 'subbie') {
    const trade = str(flags.trade);
    if (!trade) throw new CliError('add subbie "<name>" --trade=electrical [--contact= --phone= --insurance-expires= --lbp=]');
    const [row] = await db.query(
      `insert into subbies (name, trade, contact_name, email, phone, liability_expires_on, lbp_number) values ($1, $2, $3, $4, $5, $6, $7) returning *`,
      [name, trade, str(flags.contact) || null, str(flags.email) || null, str(flags.phone) || null, parseDate(flags['insurance-expires']), str(flags.lbp) || null],
    );
    let text = `${name} (${trade}) on the books.`;
    if (!row.liability_expires_on) text += `\nNo public liability on record: they cannot be assigned to a job until it is (insurance "${name}" --expires=).`;
    return { json: row, text };
  }
  throw new CliError('add client "<name>" [--contact= --phone=], or add subbie "<name>" --trade=');
}

// ---------------------------------------------------------------------------
// Compliance: the rule book, run against the records. docs/compliance.md
// carries each rule's source; this is the executable half.

const RULES = [
  {
    key: 'costs_allocated',
    title: 'Every dollar of cost sits on a won job and a budget line',
    source: 'The discipline job costing exists for. Your accountant needs it at year end, and in any dispute the first question is what the job actually cost. The schema requires a budget line on every cost; this check catches costs booked to jobs never won',
    sql: `select j.ref || ' ' || coalesce(co.supplier, '') as label, to_char(co.amount, 'FM999,999,990') || ' of cost on a job whose status is ' || j.status as detail
          from costs co join jobs j on j.id = co.job_id where j.status in ('quote', 'lost')`,
    fix: 'If the work is real the job is won: job win <ref>. If it is not, the cost belongs somewhere else.',
  },
  {
    key: 'written_contract',
    title: 'Every job at $30,000 or more has a signed written contract on record',
    source: 'Building Act 2004 s362F: residential building work of $30,000 (including GST) or more requires a written contract, and the prescribed checklist and disclosure information must be given. The contract is what protects the builder when the money is argued about',
    sql: `select ref || ' ' || client as label, to_char(contract_value, 'FM999,999,990') || ' of work, status ' || status || ', and no contract signed date on record' as detail
          from v_jobs where status in ('active', 'complete') and contract_value >= 30000 and contract_signed_on is null`,
    fix: 'Paper it now, record the date on the job. The gate at job win refuses new jobs without it; this catches the history.',
  },
  {
    key: 'variations_written',
    title: 'No variation work without written approval',
    source: 'Every standard-form residential contract (Master Builders, Certified Builders, NZS 3902) requires variations agreed in writing before the work, and the Building Act 2004 consumer protection regime assumes it. Unwritten variations are the industry\'s margin killer and its commonest dispute',
    sql: `select ref || ' ' || client as label, 'proposed ' || to_char(proposed_on, 'YYYY-MM-DD') || ' at ' || to_char(price, 'FM999,999,990') || ', ' || days_waiting || ' days without a written yes' as detail
          from v_variations where status = 'proposed'`,
    fix: 'Chase the written approval today (variation approve <ref> --by=), or decline it and do not do the work. Claims already refuse unapproved variation value.',
  },
  {
    key: 'claims_within_contract',
    title: 'Total claims never pass the contract plus approved variations',
    source: 'Construction Contracts Act 2002: a payment claim is for work under the construction contract. Claiming past the contract ceiling invites a payment schedule dispute, and loses it',
    sql: `select ref || ' ' || client as label, to_char(claimed, 'FM999,999,990') || ' claimed against a ceiling of ' || to_char(revised_contract, 'FM999,999,990') as detail
          from v_jobs where status in ('active', 'complete') and claimed > revised_contract`,
    fix: 'The gate at claim refuses this, with no force flag; a breach here means imported history needs correcting.',
  },
  {
    key: 'claims_chased',
    title: 'No served claim sitting past its due date unchased',
    source: 'Construction Contracts Act 2002: an unpaid payment claim past its due date carries statutory remedies (suspension of work, adjudication, recovery as a debt). Not chasing it is a gift of working capital to the client',
    sql: `select ref || ' ' || client as label, to_char(amount, 'FM999,999,990') || ' due ' || to_char(due_on, 'YYYY-MM-DD') || ', ' || days_overdue || ' days overdue' as detail
          from v_claims where state = 'OVERDUE'`,
    fix: 'Ring them today, log the call, and draft the follow-up (npm run docs renders the claim; the chaser drafts to drafts/).',
  },
  {
    key: 'insurance_current',
    title: 'Every subbie on an active job carries current public liability insurance',
    source: 'Your own subcontract terms and every principal contract: trades on site carry current public liability. An uninsured subbie\'s incident lands on the builder',
    sql: `select s.name as label, s.trade || ' on ' || j.ref || ', public liability ' || case when s.liability_expires_on is null then 'not on record' else 'expired ' || to_char(s.liability_expires_on, 'YYYY-MM-DD') end as detail
          from v_subbies s join job_subbies js on js.subbie_id = s.subbie_id join v_jobs j on j.job_id = js.job_id and j.status = 'active'
          where s.insurance in ('EXPIRED', 'NONE')`,
    fix: 'Get the current certificate today or stand them down: insurance <subbie> --expires=. The gate at assign refuses new assignments.',
  },
  {
    key: 'lbp_restricted',
    title: 'Restricted building work is done or supervised by a Licensed Building Practitioner',
    source: 'Building Act 2004 ss 84 to 87: restricted building work (primary structure, weathertightness, certain fire safety design) must be carried out or supervised by an LBP, and records of building work kept. Check numbers at lbp.govt.nz',
    sql: `select s.name as label, 'restricted work "' || js.scope || '" on ' || j.ref || ' with no LBP number on record' as detail
          from job_subbies js join subbies s on s.id = js.subbie_id join jobs j on j.id = js.job_id
          where js.restricted_work and s.lbp_number is null and j.status = 'active'`,
    fix: 'Record their number (lbp <subbie> --number=) or put an LBP over the work. The gate at assign refuses new restricted assignments without one.',
  },
  {
    key: 'retentions',
    title: 'Retention money is released or accounted for after handover',
    source: 'Construction Contracts Act 2002 retention money regime (strengthened 2023): retentions are held on trust, with records, and released when the contract says. Retention quietly kept past the defects period is trust money misused',
    sql: `select ref || ' ' || client as label, to_char(retention_held, 'FM999,999,990') || ' retention held, complete ' || to_char(completed_on, 'YYYY-MM-DD') || ' (' || (current_date - completed_on) || ' days ago)' as detail
          from v_jobs where status = 'complete' and retention_held > 0 and completed_on < current_date - 60`,
    fix: 'Check the defects period in the contract, then release it and record the payment, or diarise the exact release date.',
  },
  {
    key: 'budget_watch',
    title: 'No budget line spent past its budget without a decision',
    source: 'This business\'s own standard: a line over budget is a conversation this week, with the client (variation), the estimator (price list) or the supplier, never a surprise in the final account',
    sql: `select job_ref || ' ' || line as label, to_char(actual + committed, 'FM999,999,990') || ' actual + committed against ' || to_char(budget, 'FM999,999,990') || ' budgeted' as detail
          from v_budget where state = 'OVER' and job_status = 'active'`,
    fix: 'Name the cause: scope creep is a variation to price, a rate rise is the estimator\'s next quote, waste is the site\'s problem. budget <job> shows the line.',
  },
];

async function cmdCompliance(db, args) {
  const only = args[0];
  const rules = only ? RULES.filter((r) => r.key === only) : RULES;
  if (!rules.length) throw new CliError(`No rule "${only}". Rules: ${RULES.map((r) => r.key).join(', ')}`);
  const results = [];
  for (const rule of rules) {
    const breaches = await db.query(rule.sql);
    results.push({ key: rule.key, title: rule.title, source: rule.source, fix: rule.fix, breaches });
  }
  let text = heading('The rule book, run against the records');
  for (const r of results) {
    text += `\n\n${r.breaches.length ? 'FAIL' : ' ok '} ${r.key}: ${r.title}`;
    text += `\n      ${r.source}`;
    for (const b of r.breaches) text += `\n      - ${b.label}: ${b.detail}`;
    if (r.breaches.length) text += `\n      fix: ${r.fix}`;
  }
  const failed = results.filter((r) => r.breaches.length).length;
  text += `\n\n${results.length - failed} of ${results.length} rules pass. Sources and the fuller reading: docs/compliance.md. None of this is legal advice.`;
  return { json: results, text };
}

// ---------------------------------------------------------------------------
// Import and export

async function cmdImport(db, args, flags) {
  const source = args[0];
  if (!['buildxact', 'csv'].includes(source || '')) {
    throw new CliError('import buildxact|csv --clients=file.csv [--jobs=file.csv] [--costs=file.csv] [--dry-run]');
  }
  const dryRun = Boolean(flags['dry-run']);
  const readCsvFile = (flag) => {
    const file = str(flags[flag]);
    if (!file) return null;
    if (!existsSync(file)) throw new CliError(`No ${flag} file at ${file}.`);
    return parseCsv(readFileSync(file, 'utf8'));
  };
  const clientRows = readCsvFile('clients');
  const jobRows = readCsvFile('jobs');
  const costRows = readCsvFile('costs');
  if (!clientRows && !jobRows && !costRows) {
    throw new CliError('Nothing to import. Pass at least one of --clients= --jobs= --costs=.');
  }

  const counts = { clients: 0, clients_updated: 0, jobs: 0, costs: 0, skipped: 0, unsigned_30k: 0, unbudgeted_lines: 0 };
  const skips = [];
  const pendingClients = new Map();
  const pendingJobs = new Map();

  const findClient = async (name) => {
    if (!name) return null;
    const rows = await db.query('select * from clients where lower(name) = lower($1)', [name]);
    if (rows.length === 1) return rows[0];
    return pendingClients.get(name.toLowerCase()) || null;
  };
  const findJob = async (q) => {
    if (!q) return null;
    const rows = await db.query("select * from jobs where lower(name) = lower($1) or lower(coalesce(ref, '')) = lower($1) or lower(coalesce(external_ref, '')) = lower($1)", [q]);
    if (rows.length === 1) return rows[0];
    return pendingJobs.get(q.toLowerCase()) || null;
  };

  if (clientRows) {
    for (const row of clientRows) {
      const name = pick(row, 'Name', 'Client', 'Client Name', 'Company', 'Customer');
      if (!name) {
        counts.skipped++;
        skips.push('client row with no name column value');
        continue;
      }
      const existing = await findClient(name);
      if (existing) {
        counts.clients_updated++;
        if (!dryRun) {
          await db.query(
            `update clients set contact_name = coalesce($1, contact_name), email = coalesce($2, email), phone = coalesce($3, phone), address = coalesce($4, address) where id = $5`,
            [pick(row, 'Contact', 'Contact Name') || null, pick(row, 'Email') || null, pick(row, 'Phone', 'Mobile') || null, pick(row, 'Address') || null, existing.id],
          );
        }
      } else {
        counts.clients++;
        if (dryRun) {
          pendingClients.set(name.toLowerCase(), { id: null, name, __pending: true });
        } else {
          const [created] = await db.query(
            `insert into clients (name, contact_name, email, phone, address) values ($1, $2, $3, $4, $5) returning *`,
            [name, pick(row, 'Contact', 'Contact Name') || null, pick(row, 'Email') || null, pick(row, 'Phone', 'Mobile') || null, pick(row, 'Address') || null],
          );
          pendingClients.set(name.toLowerCase(), created);
        }
      }
    }
  }

  if (jobRows) {
    for (const row of jobRows) {
      const name = pick(row, 'Job', 'Job Name', 'Name', 'Description', 'Project');
      const clientName = pick(row, 'Client', 'Client Name', 'Customer', 'Contact');
      const client = await findClient(clientName);
      if (!name || !client) {
        counts.skipped++;
        skips.push(`job "${name || '(no name)'}" ${!client ? `for client "${clientName || '(none)'}" who matches nobody on file` : 'with no name'}`);
        continue;
      }
      const statusRaw = String(pick(row, 'Status', 'Stage') || '').toLowerCase();
      const status = /complet|finish|closed/.test(statusRaw) ? 'complete'
        : /active|progress|construc|started|wip/.test(statusRaw) ? 'active'
        : /lost|declin|dead/.test(statusRaw) ? 'lost' : 'quote';
      const typeRaw = String(pick(row, 'Type', 'Job Type') || '').toLowerCase();
      const type = JOB_TYPES.find((t) => typeRaw.replace(/[^a-z]/g, '_').includes(t)) || (typeRaw.includes('reno') ? 'renovation' : typeRaw.includes('extend') || typeRaw.includes('extension') ? 'extension' : typeRaw.includes('new') ? 'new_build' : 'other');
      const value = Number(String(pick(row, 'Contract', 'Contract Value', 'Quote Total', 'Total', 'Value', 'Price') || '0').replace(/[^\d.]/g, '') || 0);
      const signed = pick(row, 'Signed', 'Contract Date', 'Contract Signed', 'Signed Date');
      counts.jobs++;
      if (value >= WRITTEN_CONTRACT_FLOOR && status !== 'quote' && status !== 'lost' && !signed) counts.unsigned_30k++;
      if (!dryRun && !client.__pending) {
        const ref = await nextRef(db, 'JOB', 'jobs', 'ref', 100);
        const [created] = await db.query(
          `insert into jobs (ref, client_id, name, site_address, job_type, status, quoted_on, contract_value, contract_signed_on, started_on, completed_on, external_ref)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) on conflict (external_ref) do nothing returning *`,
          [ref, client.id, name, pick(row, 'Site', 'Site Address', 'Address') || null, type, status,
           pick(row, 'Quoted', 'Quote Date', 'Date') ? parseDate(pick(row, 'Quoted', 'Quote Date', 'Date')) : null,
           value, signed ? parseDate(signed) : null,
           pick(row, 'Start', 'Start Date', 'Started') ? parseDate(pick(row, 'Start', 'Start Date', 'Started')) : null,
           pick(row, 'Completed', 'Completion Date', 'End Date') ? parseDate(pick(row, 'Completed', 'Completion Date', 'End Date')) : null,
           pick(row, 'ID', 'Ref', 'Reference', 'Job ID') || null],
        );
        if (created) pendingJobs.set(name.toLowerCase(), created);
      } else if (dryRun) {
        pendingJobs.set(name.toLowerCase(), { id: null, name, __pending: true });
      }
    }
  }

  if (costRows) {
    const seenLines = new Set();
    for (const row of costRows) {
      const jobName = pick(row, 'Job', 'Job Name', 'Project');
      const job = await findJob(jobName);
      if (!job) {
        counts.skipped++;
        skips.push(`cost for job "${jobName || '(none)'}" which matches no job on file`);
        continue;
      }
      const category = pick(row, 'Category', 'Cost Code', 'Cost Category', 'Line') || 'Imported';
      const amount = Number(String(pick(row, 'Amount', 'Total', 'Cost', 'Value') || '0').replace(/[^\d.-]/g, '') || 0);
      counts.costs++;
      if (!dryRun && !job.__pending) {
        let [line] = await db.query('select * from budget_lines where job_id = $1 and lower(name) = lower($2)', [job.id, category]);
        if (!line) {
          const [n] = await db.query('select count(*) as n from budget_lines where job_id = $1', [job.id]);
          [line] = await db.query(
            `insert into budget_lines (job_id, cost_code, name, budget) values ($1, $2, $3, 0) returning *`,
            [job.id, String(Number(n.n) + 1).padStart(2, '0'), category],
          );
          seenLines.add(`${job.id}:${category.toLowerCase()}`);
        }
        await db.query(
          `insert into costs (job_id, budget_line_id, incurred_on, supplier, invoice_ref, amount, external_ref)
           values ($1, $2, $3, $4, $5, $6, $7) on conflict (external_ref) do nothing`,
          [job.id, line.id,
           pick(row, 'Date', 'Incurred', 'Invoice Date') ? parseDate(pick(row, 'Date', 'Incurred', 'Invoice Date')) : today(),
           pick(row, 'Supplier', 'Vendor', 'Payee') || null, pick(row, 'Invoice', 'Invoice Number', 'Ref', 'Reference') || null,
           amount, pick(row, 'ID', 'Cost ID') || null],
        );
      } else if (dryRun) {
        const key = `${jobName}:${category}`.toLowerCase();
        if (!seenLines.has(key)) seenLines.add(key);
      }
    }
    counts.unbudgeted_lines = seenLines.size;
  }

  const json = { ...counts, dry_run: dryRun, skips };
  let text = `${dryRun ? 'DRY RUN, nothing written. Would import' : 'Imported'}: ` +
    `${counts.clients} new clients (${counts.clients_updated} updated), ${counts.jobs} jobs, ${counts.costs} costs.`;
  if (counts.unsigned_30k) text += `\n${counts.unsigned_30k} imported job(s) at ${money0(WRITTEN_CONTRACT_FLOOR)}+ carry no contract signed date: s362F wants paper behind each of them, and compliance will keep saying so until there is.`;
  if (counts.unbudgeted_lines) text += `\n${counts.unbudgeted_lines} cost categor${counts.unbudgeted_lines === 1 ? 'y' : 'ies'} landed with no budget behind them (budget 0): the old system's costs came across, its estimates did not. Set real budgets: budget add.`;
  if (skips.length) text += `\nSkipped ${counts.skipped}:\n` + skips.map((x) => `  - ${x}`).join('\n');
  text += dryRun ? '\nRun again without --dry-run to write it.' : '\nCheck it: stats, attention, compliance.';
  return { json, text };
}

async function cmdExport(db, args, flags) {
  const tables = ['clients', 'jobs', 'budget_lines', 'purchase_orders', 'costs', 'variations', 'progress_claims', 'subbies', 'job_subbies', 'tasks', 'notes'];
  const out = {};
  for (const t of tables) out[t] = await db.query(`select * from ${t} order by created_at`);
  const counts = Object.fromEntries(tables.map((t) => [t, out[t].length]));
  const file = str(flags.out) || path.join(REPO_ROOT, 'exports', `builders-export-${today()}.json`);
  const dir = path.dirname(file);
  const { mkdirSync } = await import('node:fs');
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(out, null, 2));
  return {
    json: { file, counts },
    text: `Exported the whole database to ${file}.\n  ` + Object.entries(counts).map(([t, n]) => `${t}: ${n}`).join(', ') +
      '\nPlain JSON of plain tables. The job record is part of your ten-year liability tail; keep the exports.',
  };
}

// ---------------------------------------------------------------------------
// Help and dispatch

const HELP = `
Builders for Claude Code: the CLI behind the slash commands.

  node scripts/builders.mjs <command> [args] [--flags]     (or: npm run builders -- <command>)

The pipeline (quote in, contract signed, job won):
  job add "<name>" --client= --value= [--type= --site=]
  job win <ref> --signed=<date>       refuses $30k+ work with no written contract (Building Act s362F), no force flag
  budget add <job> --code= --name= --budget=              the estimate becomes the budget, line by line

The money in (variations and claims, with the gates):
  variation add <job> --description= --price= [--cost=]
  variation approve <VAR-ref> --by="who said yes, in writing"  |  variation decline <VAR-ref>
  claim <job> --amount= [--due= --terms=20]  refuses claims past contract + APPROVED variations, no force flag
  paid <PC-ref> [--amount= --on=]

The money out (committed, then actual):
  po create <job> --line= --supplier= --amount=  |  po bill <PO-ref> [--amount=]  |  po cancel <PO-ref>
  cost <job> --line= --amount= [--supplier= --invoice= --po=]

The crew and the schedule:
  assign <subbie> --job= --scope= [--price= --restricted]   refuses expired insurance; restricted work needs an LBP
  insurance <subbie> --expires=  |  lbp <subbie> --number=
  task add <job> "<task>" --starts= --ends=  |  task done <job> "<task>"
  job complete <ref>                  refuses while claims are unpaid, variations undecided, or POs open

Reads:
  attention                 everything that wants a decision, worst first
  stats  |  profit          the business, and margin by job worst first
  jobs [--all --type= --client=]      job <ref>          the full card
  pipeline                  quotes out, going cold first
  budget <job>              budget vs actual vs committed, per line
  claims [--all --job=]  |  variations [--all --job=]  |  costs [--job=]  |  orders [--all --job=]
  subbies [--all]  |  subbie <name>  |  clients [--all]  |  client <name>  |  schedule [--job= --all]
  compliance [rule]         nine rules from the Act and your own standards, sources cited

Housekeeping:
  add client "<name>"  |  add subbie "<name>" --trade=
  log <target> "what happened"        the site diary: in a dispute, it is the defence
  import buildxact|csv --clients= [--jobs= --costs=] [--dry-run]
  export [--out=file.json]

Any command takes --json. Names and refs match case-insensitively ("101" finds JOB-101); an ambiguous
one lists the candidates rather than guessing.
A $30,000 job does not start on a handshake. A claim never passes the contract plus approved variations.
An uninsured subbie does not go on a job, and restricted building work needs an LBP.
Nothing here connects to a bank, IRD or a client, and nothing sends: paperwork drafts to files, a person sends.
`;

const COMMANDS = {
  clients: cmdClients,
  client: cmdClient,
  jobs: cmdJobs,
  job: cmdJob,
  pipeline: cmdPipeline,
  quotes: cmdPipeline,
  budget: cmdBudget,
  costs: cmdCosts,
  cost: cmdCost,
  orders: cmdOrders,
  po: cmdPo,
  variations: cmdVariations,
  variation: cmdVariation,
  claims: cmdClaims,
  claim: cmdClaim,
  paid: cmdPaid,
  subbies: cmdSubbies,
  subbie: cmdSubbie,
  assign: cmdAssign,
  insurance: cmdInsurance,
  lbp: cmdLbp,
  schedule: cmdSchedule,
  task: cmdTask,
  profit: cmdProfit,
  attention: cmdAttention,
  stats: cmdStats,
  compliance: cmdCompliance,
  log: cmdLog,
  add: cmdAdd,
  import: cmdImport,
  export: cmdExport,
};

async function main() {
  const { args, flags } = parseArgv(process.argv.slice(2));
  const [command, ...rest] = args;
  if (!command || command === 'help' || flags.help) {
    process.stdout.write(HELP);
    return 0;
  }
  const fn = COMMANDS[command];
  if (!fn) {
    process.stderr.write(`Unknown command "${command}".\n\n${HELP}`);
    return 1;
  }
  const db = await getDb();
  try {
    const result = await fn(db, rest, flags);
    if (flags.json) process.stdout.write(JSON.stringify(result.json, null, 2) + '\n');
    else process.stdout.write(result.text.replace(/^\n/, '') + '\n');
    return 0;
  } catch (e) {
    if (e instanceof CliError) {
      process.stderr.write(`${e.message}\n`);
      return e.code;
    }
    if (/relation "?\w+"? does not exist/.test(e.message)) {
      process.stderr.write('The database has no tables yet. Run: npm run migrate\n');
      return 1;
    }
    throw e;
  } finally {
    await db.close();
  }
}

process.exitCode = await main();
