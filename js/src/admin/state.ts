import app from 'flarum/admin/app';

export const EXT = 'ernestdefoe-permission-desk';
export const ADMIN = 1;
export const GUEST = 2;
export const MEMBER = 3;

export const t = (key: string, params: Record<string, any> = {}) => app.translator.trans(`${EXT}.admin.${key}`, params);

export function api<T = any>(method: string, path: string, body?: any, quiet = false): Promise<T> {
  return app.request<T>({
    method,
    url: `${app.forum.attribute('apiUrl')}/permission-desk${path}`,
    body,
    ...(quiet
      ? {
          errorHandler: (e: any) => {
            throw e;
          },
        }
      : {}),
  } as any);
}

/** A saved preset, from the `permission-desk-presets` JSON:API resource. */
export interface SavedPreset {
  id: number;
  name: string;
  permissions: string[];
}

const presetsUrl = () => `${app.forum.attribute('apiUrl')}/permission-desk-presets`;
const toPreset = (d: any): SavedPreset => ({ id: Number(d.id), name: d.attributes.name, permissions: d.attributes.permissions });

export const presetsApi = {
  list: () => app.request<any>({ method: 'GET', url: presetsUrl() }).then((r) => (r.data as any[]).map(toPreset)),
  create: (name: string, permissions: string[]) =>
    app
      .request<any>({ method: 'POST', url: presetsUrl(), body: { data: { type: 'permission-desk-presets', attributes: { name, permissions } } } })
      .then((r) => toPreset(r.data)),
  remove: (id: number) => app.request({ method: 'DELETE', url: `${presetsUrl()}/${id}` }),
};

export type Ids = number[];

const norm = (ids: any[]): Ids =>
  Array.from(new Set(ids.map(Number)))
    .filter((id) => id !== ADMIN)
    .sort((a, b) => a - b);

const same = (a: Ids, b: Ids) => a.length === b.length && a.every((x, i) => x === b[i]);

export interface ReviewContext {
  kind: 'save' | 'undo' | 'restore';
  undoOf?: number;
  note?: string;
  skipped?: string[];
}

/**
 * Lives as long as the admin page: staged changes survive switching tabs and pages, and are only
 * written when the admin saves them from the review.
 */
export const desk = {
  staged: {} as Record<string, Ids>,
  context: { kind: 'save' } as ReviewContext,
  historyVersion: 0,

  /** What is saved now (core's own app.data.permissions, kept current after every save). */
  base(key: string): Ids {
    return norm(app.data.permissions[key] || []);
  },

  cur(key: string): Ids {
    return this.staged[key] ?? this.base(key);
  },

  stage(key: string, ids: any[]) {
    const next = norm(ids);
    if (same(next, this.base(key))) delete this.staged[key];
    else this.staged[key] = next;
  },

  discard() {
    this.staged = {};
    this.context = { kind: 'save' };
  },

  diff(): { key: string; group: number; op: '+' | '-' }[] {
    const out: { key: string; group: number; op: '+' | '-' }[] = [];
    Object.keys(this.staged)
      .sort()
      .forEach((key) => {
        const before = this.base(key);
        const after = this.staged[key];
        after.filter((g) => !before.includes(g)).forEach((group) => out.push({ key, group, op: '+' }));
        before.filter((g) => !after.includes(g)).forEach((group) => out.push({ key, group, op: '-' }));
      });
    return out;
  },

  /** Replace core's permission map with the server's (after a save or a conflict). */
  setMap(map: Record<string, number[]>) {
    const next: Record<string, string[]> = {};
    Object.keys(map).forEach((key) => (next[key] = map[key].map(String)));
    app.data.permissions = next;
    Object.keys(this.staged).forEach((key) => this.stage(key, this.staged[key]));
  },

  setOne(key: string, ids: number[]) {
    if (ids.length) app.data.permissions[key] = ids.map(String);
    else delete app.data.permissions[key];
  },
};

export type RowState = 'lock' | 'on' | 'inh' | 'off';

/**
 * How a group stands on a permission: Admins always (locked); its own grant; inherited because
 * Everyone or Members have it (switching it off for this group would change nothing); or off.
 */
export function rowState(group: number, key: string): { st: RowState; via: number | null } {
  const set = desk.cur(key);
  if (group === ADMIN) return { st: 'lock', via: null };
  if (set.includes(group))
    return { st: 'on', via: group !== GUEST && set.includes(GUEST) ? GUEST : group > MEMBER && set.includes(MEMBER) ? MEMBER : null };
  if (group !== GUEST && set.includes(GUEST)) return { st: 'inh', via: GUEST };
  if (group > MEMBER && set.includes(MEMBER)) return { st: 'inh', via: MEMBER };
  return { st: 'off', via: null };
}

export const allowed = (group: number, key: string) => rowState(group, key).st !== 'off';

export const scoped = (key: string, scope: string) => (scope === 'global' ? key : `tag${scope}.${key}`);

export function splitKey(key: string): { tag: string | null; key: string } {
  const m = key.match(/^tag(\d+)\.(.+)$/);
  return m ? { tag: m[1], key: m[2] } : { tag: null, key };
}

export function required(key: string): string[] {
  return (app as any).getRequiredPermissions(key) as string[];
}
