// =============================================================================
// sandbox.mjs — โหลดไฟล์ Js/*.js ของระบบเข้า VM sandbox (ไม่มี network 100%)
//
// หลักการ Dry Run:
//   - จำลอง window / localStorage / document ขั้นต่ำ
//   - fetch / XMLHttpRequest / WebSocket ถูกบล็อก — เรียกเมื่อไหร่ throw ทันที
//   - localStorage เป็น Map ในหน่วยความจำ ไม่แตะเครื่องจริง
//   - ไม่มีการเชื่อมต่อ Supabase จริงเด็ดขาด
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

function makeLocalStorageStub() {
    const store = new Map();
    return {
        getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
        setItem: (k, v) => { store.set(String(k), String(v)); },
        removeItem: (k) => { store.delete(String(k)); },
        clear: () => { store.clear(); },
        key: (i) => [...store.keys()][i] ?? null,
        get length() { return store.size; },
        _dump: () => Object.fromEntries(store),
    };
}

function makeElementStub() {
    const el = {
        style: {},
        dataset: {},
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        children: [],
        innerHTML: '',
        textContent: '',
        value: '',
        setAttribute() {},
        getAttribute: () => null,
        appendChild(c) { el.children.push(c); return c; },
        removeChild() {},
        addEventListener() {},
        removeEventListener() {},
        querySelector: () => null,
        querySelectorAll: () => [],
        focus() {},
        remove() {},
        click() {},
    };
    return el;
}

function blockedNetwork(name) {
    return function () {
        throw new Error(`[DRY-RUN GUARD] มีการพยายามเรียก ${name} — เทสต้องไม่แตะ network/DB จริง`);
    };
}

/**
 * สร้าง sandbox ใหม่ (window แยกอิสระต่อการเรียก 1 ครั้ง)
 */
export function createSandbox() {
    const localStorage = makeLocalStorageStub();
    const sessionStorage = makeLocalStorageStub();

    const documentStub = {
        addEventListener() {},
        removeEventListener() {},
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        createElement: () => makeElementStub(),
        body: makeElementStub(),
        head: makeElementStub(),
        hidden: false,
        readyState: 'complete',
        currentScript: null,
    };

    const sandbox = {
        console,
        localStorage,
        sessionStorage,
        document: documentStub,
        navigator: { userAgent: 'dry-run-test' },
        location: { pathname: '/index.html', search: '', href: 'http://localhost/index.html' },
        setTimeout, clearTimeout, setInterval, clearInterval,
        URL, URLSearchParams, TextEncoder, TextDecoder,
        atob: (s) => Buffer.from(s, 'base64').toString('binary'),
        btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
        // ===== DRY-RUN GUARD: บล็อก network ทุกช่องทาง =====
        fetch: blockedNetwork('fetch'),
        XMLHttpRequest: blockedNetwork('XMLHttpRequest'),
        WebSocket: blockedNetwork('WebSocket'),
        EventSource: blockedNetwork('EventSource'),
        Notification: undefined,
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.self = sandbox;

    vm.createContext(sandbox);
    return sandbox;
}

/**
 * โหลดไฟล์ shared JS (path เทียบจาก root โปรเจกต์ เช่น 'Js/reconcile-shared.js')
 * ลงใน sandbox — คืน sandbox เดิมเพื่อ chain ได้
 */
export function loadScript(sandbox, relPath) {
    const full = path.join(PROJECT_ROOT, relPath);
    const code = fs.readFileSync(full, 'utf8');
    vm.runInContext(code, sandbox, { filename: relPath });
    return sandbox;
}

/**
 * ทางลัด: sandbox ใหม่ + โหลดหลายไฟล์ตามลำดับ
 */
export function loadFresh(...relPaths) {
    const sb = createSandbox();
    for (const p of relPaths) loadScript(sb, p);
    return sb;
}
