// =============================================================================
// mock-supabase.mjs — Supabase client จำลองแบบ Dry Run
//
//   - SELECT: คืนข้อมูลจาก fixtures (กรอง eq/in แบบง่าย) — อ่านอย่างเดียว
//   - INSERT/UPDATE/DELETE/UPSERT/RPC: **ไม่แก้ fixtures** แค่บันทึกไว้ใน ops[]
//     ว่า "ถ้ารันจริงจะทำอะไร" → เทสตรวจ ops ได้ว่าโค้ดตั้งใจเขียนอะไรลง DB
//   - ไม่มี network ใด ๆ ทั้งสิ้น
// =============================================================================

class MockQueryBuilder {
    constructor(client, table) {
        this._client = client;
        this._table = table;
        this._op = 'select';
        this._payload = null;
        this._columns = '*';
        this._opts = null;
        this._filters = [];
        this._modifiers = [];
        this._single = false;
    }

    select(columns = '*', opts = null) {
        // select() หลัง insert/update = ขอ returning — คง op เดิมไว้
        if (this._op === 'select') { this._columns = columns; this._opts = opts; }
        else this._modifiers.push({ type: 'returning', columns });
        return this;
    }
    insert(payload) { this._op = 'insert'; this._payload = payload; return this; }
    upsert(payload, opts) { this._op = 'upsert'; this._payload = payload; this._opts = opts; return this; }
    update(payload) { this._op = 'update'; this._payload = payload; return this; }
    delete() { this._op = 'delete'; return this; }

    eq(col, val) { this._filters.push({ type: 'eq', col, val }); return this; }
    neq(col, val) { this._filters.push({ type: 'neq', col, val }); return this; }
    in(col, vals) { this._filters.push({ type: 'in', col, vals: [...vals] }); return this; }
    gte(col, val) { this._filters.push({ type: 'gte', col, val }); return this; }
    lte(col, val) { this._filters.push({ type: 'lte', col, val }); return this; }
    gt(col, val) { this._filters.push({ type: 'gt', col, val }); return this; }
    lt(col, val) { this._filters.push({ type: 'lt', col, val }); return this; }
    is(col, val) { this._filters.push({ type: 'is', col, val }); return this; }
    or(expr) { this._filters.push({ type: 'or', expr }); return this; }
    ilike(col, pattern) { this._filters.push({ type: 'ilike', col, pattern }); return this; }
    not(col, op, val) { this._filters.push({ type: 'not', col, op, val }); return this; }

    order(col, opts) { this._modifiers.push({ type: 'order', col, opts }); return this; }
    limit(n) { this._modifiers.push({ type: 'limit', n }); return this; }
    range(from, to) { this._modifiers.push({ type: 'range', from, to }); return this; }
    single() { this._single = true; return this; }
    maybeSingle() { this._single = true; return this; }

    _applyFilters(rows) {
        let out = rows;
        for (const f of this._filters) {
            if (f.type === 'eq') out = out.filter(r => r[f.col] === f.val);
            else if (f.type === 'neq') out = out.filter(r => r[f.col] !== f.val);
            else if (f.type === 'in') out = out.filter(r => f.vals.includes(r[f.col]));
            else if (f.type === 'gte') out = out.filter(r => r[f.col] >= f.val);
            else if (f.type === 'lte') out = out.filter(r => r[f.col] <= f.val);
            else if (f.type === 'gt') out = out.filter(r => r[f.col] > f.val);
            else if (f.type === 'lt') out = out.filter(r => r[f.col] < f.val);
            // or / ilike / not — mock ไม่กรอง (คืนทั้งชุด) พอสำหรับ dry run
        }
        // .order() หลายครั้ง = การเรียงแบบผสม (compound) ไม่ใช่เรียงใหม่ทับกัน
        // ⚠️ ห้ามวนเรียงทีละตัวตามลำดับ — ตัวหลังจะล้างผลของตัวแรกทิ้ง ซึ่งตรงข้ามกับ
        //    PostgREST จริง และจะทำให้เทสที่พึ่ง tiebreak (invariant ข้อ 13) ผ่านแบบหลอก
        const orders = this._modifiers.filter(m => m.type === 'order');
        let sorted = false;
        for (const m of this._modifiers) {
            if (m.type === 'order') {
                if (sorted) continue;
                sorted = true;
                out = [...out].sort((a, b) => {
                    for (const o of orders) {
                        const desc = o.opts && o.opts.ascending === false;
                        const cmp = (a[o.col] < b[o.col] ? -1 : a[o.col] > b[o.col] ? 1 : 0) * (desc ? -1 : 1);
                        if (cmp !== 0) return cmp;
                    }
                    return 0;
                });
            } else if (m.type === 'limit') out = out.slice(0, m.n);
            else if (m.type === 'range') out = out.slice(m.from, m.to + 1);
        }
        return out;
    }

    _execute() {
        const fixtures = this._client.fixtures[this._table] || [];
        const record = {
            table: this._table,
            op: this._op,
            payload: this._payload,
            filters: this._filters,
            modifiers: this._modifiers,
            opts: this._opts,
        };
        this._client.ops.push(record);

        if (this._op === 'select') {
            const rows = this._applyFilters(fixtures.map(r => ({ ...r })));
            const head = this._opts && this._opts.head;
            const count = (this._opts && this._opts.count) ? rows.length : null;
            let data = head ? null : rows;
            if (this._single) data = rows[0] ?? null;
            return { data, error: null, count };
        }

        // mutation: DRY RUN — ไม่แตะ fixtures เลย
        if (this._op === 'delete' || this._op === 'update') {
            const wouldAffect = this._applyFilters(fixtures.map(r => ({ ...r })));
            record.wouldAffect = wouldAffect;
            return { data: this._single ? (wouldAffect[0] ?? null) : wouldAffect, error: null, count: null };
        }
        // insert / upsert
        const payloadArr = Array.isArray(this._payload) ? this._payload : [this._payload];
        record.wouldAffect = payloadArr;
        return { data: this._single ? (payloadArr[0] ?? null) : payloadArr, error: null, count: null };
    }

    then(resolve, reject) {
        try { return Promise.resolve(this._execute()).then(resolve, reject); }
        catch (err) { return Promise.reject(err).catch(reject); }
    }
    catch(fn) { return this.then(undefined, fn); }
    finally(fn) { return this.then().finally(fn); }
}

export function createMockClient(fixtures = {}, rpcResults = {}) {
    const client = {
        fixtures,          // { tableName: [rows...] } — ไม่ถูกแก้โดย mutation ใด ๆ
        rpcResults,        // { fnName: value | (args)=>value }
        ops: [],           // บันทึกทุก operation ที่โค้ดพยายามทำ
        from(table) { return new MockQueryBuilder(client, table); },
        async rpc(fnName, args) {
            client.ops.push({ table: null, op: 'rpc', fn: fnName, args });
            const r = rpcResults[fnName];
            const data = typeof r === 'function' ? r(args) : (r ?? null);
            return { data, error: null };
        },
        channel() {
            return { on() { return this; }, subscribe() { return this; }, unsubscribe() {} };
        },
        removeChannel() {},
        storage: {
            from() {
                return {
                    upload: async () => { throw new Error('[DRY-RUN GUARD] storage.upload ถูกบล็อก'); },
                    remove: async () => { throw new Error('[DRY-RUN GUARD] storage.remove ถูกบล็อก'); },
                    list: async () => ({ data: [], error: null }),
                    getPublicUrl: () => ({ data: { publicUrl: 'mock://url' } }),
                };
            },
        },
    };
    return client;
}

/** helper: หา ops ตามเงื่อนไข */
export function findOps(client, { table, op } = {}) {
    return client.ops.filter(o => (table == null || o.table === table) && (op == null || o.op === op));
}
