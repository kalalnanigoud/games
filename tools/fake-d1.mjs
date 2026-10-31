// Cloudflare D1's statement API (prepare → bind → first / run / all), backed by node:sqlite, for testing
// the Workers in server/ without a Cloudflare account. Every statement waits a turn before running, as a
// real database call does, so requests that arrive together interleave between statements: a
// read-then-write race shows up here just as it would on Cloudflare.
//   broken(): return true to make every statement fail (a used-up daily limit, say).
export function fakeD1(db, broken = () => false) {
  const turn = () => new Promise((resolve) => setImmediate(resolve));
  const fail = () => { if (broken()) throw new Error('D1_ERROR: daily limit exceeded'); };
  return {
    prepare(sql) {
      let params = [];
      const st = {
        bind(...a) { params = a; return st; },
        async first() { await turn(); fail(); return db.prepare(sql).get(...params) ?? null; },
        async run() { await turn(); fail(); const r = db.prepare(sql).run(...params); return { success: true, meta: { changes: Number(r.changes) } }; },
        async all() { await turn(); fail(); return { success: true, results: db.prepare(sql).all(...params) }; },
      };
      return st;
    },
  };
}
