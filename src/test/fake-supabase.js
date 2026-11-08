// In-memory fake of the supabase-js query builder, for cloud-mode service
// tests. Supports exactly the calls toteService makes: select / insert /
// update / delete with eq / is / in / order / limit / maybeSingle / single,
// plus rpc(). Records every write so tests can assert on the wire shape.
//
//   const { client, state } = makeFakeSupabase(rows, options)
//   state.rows      live table
//   state.updates   [{ payload, filters }]
//   state.inserts   [payload]
//   state.deletes   [filters]
//   state.rpcCalls  [{ fn, args }]
//
// options:
//   beforeUpdate(state, q)  play the other phone between read and write
//   beforeInsert(state, q)  same, before an insert lands
//   uniquePosition          enforce UNIQUE(position) → error code 23505
//   rpc(fn, args, state)    handler; return { data, error }
//   failReads               every select fails like a network error

function matches(row, filters) {
  return filters.every(([kind, col, val]) => {
    if (kind === "is") return val === null ? row[col] == null : row[col] === val;
    if (kind === "in") return val.includes(row[col]);
    // .not(col, "match", regex) → PostgREST `not.match.` (SQL `!~`)
    if (kind === "not_match") return !new RegExp(val).test(String(row[col] ?? ""));
    return row[col] === val;
  });
}

function pick(row, cols) {
  if (!cols || cols.trim() === "*") return { ...row };
  const out = {};
  cols.split(",").forEach((c) => {
    out[c.trim()] = row[c.trim()];
  });
  return out;
}

const uniqueViolation = () => ({
  code: "23505",
  message: 'duplicate key value violates unique constraint "totes_position_key"',
});

export function makeFakeSupabase(rows, options = {}) {
  const state = {
    rows: rows.map((r) => ({ ...r })),
    updates: [],
    inserts: [],
    deletes: [],
    rpcCalls: [],
    failReads: Boolean(options.failReads),
    nextId: 1000,
  };

  function builder() {
    const q = {
      action: "select",
      cols: "*",
      payload: null,
      filters: [],
      single: null,
      limit: null,
      selectAfter: false,
    };
    // .single() with no row is an error in PostgREST (PGRST116)
    const finish = (list) => {
      if (q.single === true && list.length === 0) {
        return { data: null, error: { code: "PGRST116", message: "0 rows" } };
      }
      return { data: q.single ? (list[0] ?? null) : list, error: null };
    };
    const exec = async () => {
      if (q.action === "select") {
        if (state.failReads) return { data: null, error: new Error("Failed to fetch") };
        let data = state.rows.filter((r) => matches(r, q.filters)).map((r) => pick(r, q.cols));
        if (q.limit !== null) data = data.slice(0, q.limit);
        return finish(data);
      }
      if (q.action === "insert") {
        if (options.beforeInsert) await options.beforeInsert(state, q);
        const list = Array.isArray(q.payload) ? q.payload : [q.payload];
        const created = [];
        for (const payload of list) {
          state.inserts.push(payload);
          if (
            options.uniquePosition &&
            state.rows.some((r) => r.position === payload.position)
          ) {
            return { data: null, error: uniqueViolation() };
          }
          const row = { id: state.nextId++, ...payload };
          state.rows.push(row);
          created.push({ ...row });
        }
        return q.selectAfter ? finish(created) : { data: null, error: null };
      }
      if (q.action === "update") {
        if (options.beforeUpdate) await options.beforeUpdate(state, q);
        state.updates.push({ payload: q.payload, filters: q.filters });
        const hit = state.rows.filter((r) => matches(r, q.filters));
        if (
          options.uniquePosition &&
          q.payload.position !== undefined &&
          hit.length > 0 &&
          state.rows.some((r) => !hit.includes(r) && r.position === q.payload.position)
        ) {
          return { data: null, error: uniqueViolation() };
        }
        hit.forEach((r) => Object.assign(r, q.payload));
        return finish(hit.map((r) => ({ ...r })));
      }
      if (q.action === "delete") {
        state.deletes.push(q.filters);
        const hit = state.rows.filter((r) => matches(r, q.filters));
        state.rows = state.rows.filter((r) => !hit.includes(r));
        return q.selectAfter ? finish(hit) : { data: null, error: null };
      }
      throw new Error(`fake supabase: unsupported action ${q.action}`);
    };
    const api = {
      select(cols) {
        if (q.action === "select") q.cols = cols ?? "*";
        else q.selectAfter = true;
        return api;
      },
      insert(payload) {
        q.action = "insert";
        q.payload = payload;
        return api;
      },
      update(payload) {
        q.action = "update";
        q.payload = payload;
        return api;
      },
      delete() {
        q.action = "delete";
        return api;
      },
      eq(col, val) {
        q.filters.push(["eq", col, val]);
        return api;
      },
      is(col, val) {
        q.filters.push(["is", col, val]);
        return api;
      },
      in(col, vals) {
        q.filters.push(["in", col, vals]);
        return api;
      },
      not(col, op, val) {
        if (op !== "match") throw new Error(`fake supabase: unsupported not.${op}`);
        q.filters.push(["not_match", col, val]);
        return api;
      },
      maybeSingle() {
        q.single = "maybe";
        return api;
      },
      single() {
        q.single = true;
        return api;
      },
      order() {
        return api;
      },
      limit(n) {
        q.limit = n;
        return api;
      },
      then(resolve, reject) {
        return exec().then(resolve, reject);
      },
    };
    return api;
  }

  const client = {
    from: () => builder(),
    async rpc(fn, args) {
      state.rpcCalls.push({ fn, args });
      if (options.rpc) return options.rpc(fn, args, state);
      return {
        data: null,
        error: {
          code: "PGRST202",
          message: `Could not find the function public.${fn} in the schema cache`,
        },
      };
    },
  };
  return { client, state };
}

/** Reference implementation of swap_tote_positions() for the fake. */
export function fakeSwapRpc(fn, { a_id, b_id }, state) {
  const a = state.rows.find((r) => r.id === a_id);
  const b = state.rows.find((r) => r.id === b_id);
  if (!a || !b) return { data: null, error: { code: "P0002", message: "not found" } };
  if (a.position.startsWith("__") || b.position.startsWith("__")) {
    return { data: null, error: { code: "22023", message: "reserved" } };
  }
  const stamp = new Date().toISOString();
  [a.position, b.position] = [b.position, a.position];
  a.updated_at = stamp;
  b.updated_at = stamp;
  return { data: [a, b].sort((x, y) => x.id - y.id).map((r) => ({ ...r })), error: null };
}
