import { Client } from '@elastic/elasticsearch';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const INTEL_INDEX = 'tarpit-intel';
const SESSION_INDEX = 'tarpit-sessions';
const UTTERANCE_INDEX = 'tarpit-utterances';

const DATA_DIR = path.resolve(process.cwd(), 'data');

/**
 * Elastic store with a local fallback.
 *
 * The fallback is not decoration: a demo that dies because a cloud cluster is
 * slow is a demo that dies. Everything written here also lands in memory and
 * on disk as JSONL, so the UI is served from the same shape either way.
 */
class Store {
  constructor() {
    this.client = null;
    this.connected = false;
    this.mode = 'memory';
    this.mem = { intel: [], sessions: new Map(), utterances: [] };
    this.error = null;
  }

  async init() {
    fs.mkdirSync(DATA_DIR, { recursive: true });

    const { cloudId, apiKey, node, username, password } = config.elastic;
    let opts = null;
    if (cloudId && apiKey) {
      opts = { cloud: { id: cloudId }, auth: { apiKey } };
    } else if (node && apiKey) {
      opts = { node, auth: { apiKey } };
    } else if (node && username && password) {
      opts = { node, auth: { username, password } };
    } else if (node) {
      opts = { node };
    }

    if (!opts) {
      this.mode = 'memory';
      this.error = 'no Elastic credentials configured';
      return this;
    }

    try {
      this.client = new Client({ ...opts, requestTimeout: 5000, maxRetries: 2 });
      await this.client.ping();
      await this.#ensureIndices();
      this.connected = true;
      this.mode = 'elastic';
      console.log('[elastic] connected — indices ready');
    } catch (err) {
      this.client = null;
      this.connected = false;
      this.mode = 'memory';
      this.error = err.message;
      console.warn(`[elastic] unavailable (${err.message}) — using local store`);
    }
    return this;
  }

  async #ensureIndices() {
    const defs = [
      [
        INTEL_INDEX,
        {
          '@timestamp': { type: 'date' },
          session_id: { type: 'keyword' },
          type: { type: 'keyword' },
          label: { type: 'keyword' },
          value: { type: 'keyword' },
          severity: { type: 'keyword' },
          score: { type: 'integer' },
          speaker: { type: 'keyword' },
          source_utterance: { type: 'text' },
          meta: { type: 'object', enabled: true },
        },
      ],
      [
        SESSION_INDEX,
        {
          '@timestamp': { type: 'date' },
          session_id: { type: 'keyword' },
          persona: { type: 'keyword' },
          status: { type: 'keyword' },
          seconds_wasted: { type: 'float' },
          cost_destroyed_usd: { type: 'float' },
          turns: { type: 'integer' },
          intel_count: { type: 'integer' },
          scam_type: { type: 'keyword' },
          claimed_org: { type: 'keyword' },
          payment_rail: { type: 'keyword' },
        },
      ],
      [
        UTTERANCE_INDEX,
        {
          '@timestamp': { type: 'date' },
          session_id: { type: 'keyword' },
          speaker: { type: 'keyword' },
          text: { type: 'text' },
          persona: { type: 'keyword' },
        },
      ],
    ];

    for (const [index, properties] of defs) {
      const exists = await this.client.indices.exists({ index });
      if (!exists) {
        await this.client.indices.create({ index, mappings: { properties } });
      }
    }
  }

  #appendFile(name, doc) {
    try {
      fs.appendFileSync(path.join(DATA_DIR, `${name}.jsonl`), `${JSON.stringify(doc)}\n`);
    } catch {}
  }

  async indexIntel(docs) {
    if (!docs?.length) return;
    this.mem.intel.push(...docs);
    for (const d of docs) this.#appendFile('intel', d);
    if (!this.connected) return;
    try {
      await this.client.bulk({
        refresh: false,
        operations: docs.flatMap((d) => [{ index: { _index: INTEL_INDEX, _id: d.id } }, d]),
      });
    } catch (err) {
      console.warn('[elastic] intel bulk failed:', err.message);
    }
  }

  async indexUtterance(doc) {
    this.mem.utterances.push(doc);
    this.#appendFile('utterances', doc);
    if (!this.connected) return;
    try {
      await this.client.index({ index: UTTERANCE_INDEX, document: doc });
    } catch {}
  }

  async upsertSession(doc) {
    this.mem.sessions.set(doc.session_id, { ...this.mem.sessions.get(doc.session_id), ...doc });
    this.#appendFile('sessions', doc);
    if (!this.connected) return;
    try {
      await this.client.index({ index: SESSION_INDEX, id: doc.session_id, document: doc });
    } catch {}
  }

  /** Aggregate view powering the "campaign intelligence" panel. */
  async summary() {
    const sessions = [...this.mem.sessions.values()];
    const local = {
      mode: this.mode,
      connected: this.connected,
      error: this.error,
      total_sessions: sessions.length,
      total_seconds_wasted: sessions.reduce((a, s) => a + (s.seconds_wasted || 0), 0),
      total_cost_destroyed: sessions.reduce((a, s) => a + (s.cost_destroyed_usd || 0), 0),
      total_intel: this.mem.intel.length,
      by_type: tally(this.mem.intel, 'type'),
      by_severity: tally(this.mem.intel, 'severity'),
      top_artifacts: this.mem.intel
        .slice()
        .sort((a, b) => b.score - a.score)
        .slice(0, 25),
    };

    if (!this.connected) return local;

    try {
      const res = await this.client.search({
        index: INTEL_INDEX,
        size: 0,
        aggs: {
          by_type: { terms: { field: 'type', size: 20 } },
          by_severity: { terms: { field: 'severity', size: 5 } },
        },
      });
      const sess = await this.client.search({
        index: SESSION_INDEX,
        size: 0,
        aggs: {
          seconds: { sum: { field: 'seconds_wasted' } },
          cost: { sum: { field: 'cost_destroyed_usd' } },
          scam_types: { terms: { field: 'scam_type', size: 10 } },
        },
      });
      return {
        ...local,
        mode: 'elastic',
        total_sessions: sess.hits?.total?.value ?? local.total_sessions,
        total_seconds_wasted: sess.aggregations?.seconds?.value ?? local.total_seconds_wasted,
        total_cost_destroyed: sess.aggregations?.cost?.value ?? local.total_cost_destroyed,
        total_intel: res.hits?.total?.value ?? local.total_intel,
        by_type: Object.fromEntries((res.aggregations?.by_type?.buckets || []).map((b) => [b.key, b.doc_count])),
        by_severity: Object.fromEntries((res.aggregations?.by_severity?.buckets || []).map((b) => [b.key, b.doc_count])),
        scam_types: Object.fromEntries((sess.aggregations?.scam_types?.buckets || []).map((b) => [b.key, b.doc_count])),
      };
    } catch (err) {
      return { ...local, error: err.message };
    }
  }

  /** Everything recorded for one engagement, for report generation. */
  async sessionBundle(sessionId) {
    const local = {
      session: this.mem.sessions.get(sessionId) || null,
      intel: this.mem.intel.filter((d) => d.session_id === sessionId),
      utterances: this.mem.utterances.filter((d) => d.session_id === sessionId),
    };
    if (local.session && local.intel.length) return local;
    if (!this.connected) return local;

    // Memory is per-process; after a restart Elastic is the only record.
    try {
      const [sess, intel, utts] = await Promise.all([
        this.client.get({ index: SESSION_INDEX, id: sessionId }).catch(() => null),
        this.client.search({
          index: INTEL_INDEX,
          size: 500,
          query: { term: { session_id: sessionId } },
          sort: [{ '@timestamp': 'asc' }],
        }),
        this.client.search({
          index: UTTERANCE_INDEX,
          size: 1000,
          query: { term: { session_id: sessionId } },
          sort: [{ '@timestamp': 'asc' }],
        }),
      ]);
      return {
        session: sess?._source || local.session,
        intel: intel.hits.hits.map((h) => h._source),
        utterances: utts.hits.hits.map((h) => h._source),
      };
    } catch {
      return local;
    }
  }

  /** Every artifact value seen across all engagements, for cross-call correlation. */
  async correlate(value) {
    if (!this.connected) {
      return this.mem.intel.filter((d) => String(d.value) === String(value));
    }
    try {
      const res = await this.client.search({
        index: INTEL_INDEX,
        size: 100,
        query: { term: { value } },
        sort: [{ '@timestamp': 'desc' }],
      });
      return res.hits.hits.map((h) => h._source);
    } catch {
      return [];
    }
  }

  /** Full-text search across captured intel — the Elastic "find the signal" query path. */
  async search(q) {
    if (!this.connected) {
      const needle = (q || '').toLowerCase();
      return this.mem.intel
        .filter(
          (d) =>
            String(d.value).toLowerCase().includes(needle) ||
            d.type.includes(needle) ||
            (d.source_utterance || '').toLowerCase().includes(needle)
        )
        .slice(-50)
        .reverse();
    }
    try {
      const res = await this.client.search({
        index: INTEL_INDEX,
        size: 50,
        query: q
          ? { multi_match: { query: q, fields: ['value^3', 'type^2', 'label^2', 'source_utterance'] } }
          : { match_all: {} },
        sort: [{ '@timestamp': 'desc' }],
      });
      return res.hits.hits.map((h) => h._source);
    } catch {
      return [];
    }
  }
}

function tally(rows, field) {
  const out = {};
  for (const r of rows) out[r[field]] = (out[r[field]] || 0) + 1;
  return out;
}

export const store = new Store();
export { INTEL_INDEX, SESSION_INDEX, UTTERANCE_INDEX };
