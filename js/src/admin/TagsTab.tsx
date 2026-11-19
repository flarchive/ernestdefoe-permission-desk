import app from 'flarum/admin/app';
import Component from 'flarum/common/Component';
import Button from 'flarum/common/components/Button';
import Icon from 'flarum/common/components/Icon';
import extractText from 'flarum/common/utils/extractText';
import type Mithril from 'mithril';
import { ADMIN, GUEST, MEMBER, allowed, api, desk, required, rowState, scoped, t } from './state';
import { collect, groupName, groups, tagItems, tagMatches, type Row, type TagItem } from './rows';
import TagPicker from './TagPicker';

export type TagFilter = 'all' | 'restricted' | 'open' | 'hidden' | 'custom' | 'selected';
type What = 'viewForum' | 'startDiscussion' | 'discussion.reply' | 'post' | 'moderate' | 'all';

export interface TagsUi {
  group: number;
  q: string;
  filter: TagFilter;
  selected: Record<string, true>;
  collapsed: Record<string, true>;
  limit: number;
  action: 'allow' | 'remove';
  what: What;
  copyFrom: string;
  busy: boolean;
}

export const tagsUi = (group: number): TagsUi => ({
  group,
  q: '',
  filter: 'all',
  selected: {},
  collapsed: {},
  limit: PAGE,
  action: 'allow',
  what: 'post',
  copyFrom: 'global',
  busy: false,
});

const PAGE = 100;
const FILTERS: TagFilter[] = ['all', 'restricted', 'open', 'hidden', 'custom', 'selected'];
const CELLS = ['viewForum', 'startDiscussion', 'discussion.reply'];

const tagRows = () => collect().rows.filter((r) => r.tagScoped);
const modRows = () => tagRows().filter((r) => r.area === 'moderate');

/** Any of the tag's own permissions differs from the forum-wide one, for any group. */
function custom(id: string): boolean {
  return tagRows().some((r) => desk.cur(scoped(r.key, id)).join() !== desk.cur(r.key).join());
}

/**
 * Every tag on one screen, built for forums with hundreds of them: find a tag, see what one group
 * can do in each, switch it in place, or select many tags and change them all at once.
 */
export default class TagsTab extends Component<{ ui: TagsUi; openTag: (id: string, group: number) => void }> {
  byId = new Map<string, TagItem>();

  visible(): TagItem[] {
    const ui = this.attrs.ui;
    const q = ui.q.trim().toLowerCase();
    const items = tagItems();
    const g = ui.group;
    const keep = (i: TagItem) => {
      if (q && !tagMatches(i.path, q)) return false;
      if (ui.filter === 'restricted') return i.restricted;
      if (ui.filter === 'open') return !i.restricted;
      if (ui.filter === 'hidden') return i.restricted && !allowed(g, scoped('viewForum', i.id));
      if (ui.filter === 'custom') return i.restricted && custom(i.id);
      if (ui.filter === 'selected') return !!ui.selected[i.id];
      return true;
    };
    // Collapsing a parent hides its children, unless a search or filter is narrowing the list.
    const tree = !q && ui.filter === 'all';
    const hidden = new Set<string>();
    return items.filter((i) => {
      if (tree && i.parentId && (ui.collapsed[i.parentId] || hidden.has(i.parentId))) {
        hidden.add(i.id);
        return false;
      }
      return keep(i);
    });
  }

  view() {
    const ui = this.attrs.ui;
    const items = tagItems();
    this.byId = new Map(items.map((i) => [i.id, i]));
    if (ui.group === ADMIN) ui.group = MEMBER;
    const restricted = items.filter((i) => i.restricted);
    const list = this.visible();
    const shown = list.slice(0, ui.limit);
    const selected = Object.keys(ui.selected);
    const g = ui.group;
    const canSee = restricted.filter((i) => allowed(g, scoped('viewForum', i.id))).length;
    const hasKids = new Set(items.filter((i) => i.parentId).map((i) => i.parentId!));

    return (
      <div className="PermissionDesk-tagsTab">
        {this.toolbar(hasKids)}
        {this.filters(selected)}
        <p className="PermissionDesk-note PermissionDesk-note--info">
          {t('tags.summary', { total: items.length, restricted: restricted.length, group: <b>{groupName(g)}</b>, see: canSee })}
        </p>

        {selected.length ? this.bulk(selected) : null}

        {this.table(shown, hasKids)}
        {list.length > shown.length ? (
          <Button className="Button" onclick={() => (ui.limit += PAGE)}>
            {t('tags.more', { count: list.length - shown.length })}
          </Button>
        ) : null}
      </div>
    );
  }

  toolbar(hasKids: Set<string>) {
    const ui = this.attrs.ui;
    const g = ui.group;
    const anyOpen = [...hasKids].some((id) => !ui.collapsed[id]);
    return (
      <div className="PermissionDesk-toolbar">
        <label className="PermissionDesk-inline">
          <span>{t('tags.for')}</span>
          <select className="FormControl" value={String(g)} onchange={(e: Event) => (ui.group = Number((e.target as HTMLSelectElement).value))}>
            {groups()
              .filter((x) => Number(x.id()) !== ADMIN)
              .map((x) => (
                <option value={String(x.id())}>{Number(x.id()) === GUEST ? t('guests_everyone') : groupName(Number(x.id()))}</option>
              ))}
          </select>
        </label>
        <input
          className="FormControl PermissionDesk-search"
          type="search"
          value={ui.q}
          placeholder={extractText(t('tags.search'))}
          aria-label={extractText(t('tags.search'))}
          oninput={(e: InputEvent) => {
            ui.q = (e.target as HTMLInputElement).value;
            ui.limit = PAGE;
          }}
        />
        {hasKids.size ? (
          <Button
            className="Button"
            icon={anyOpen ? 'fas fa-compress' : 'fas fa-expand'}
            onclick={() => {
              ui.collapsed = {};
              if (anyOpen) hasKids.forEach((id) => (ui.collapsed[id] = true));
            }}
          >
            {t(anyOpen ? 'tags.collapse_all' : 'tags.expand_all')}
          </Button>
        ) : null}
      </div>
    );
  }

  filters(selected: string[]) {
    const ui = this.attrs.ui;
    const g = ui.group;
    return (
      <div className="PermissionDesk-filters" role="group" aria-label={extractText(t('filter.label'))}>
        {FILTERS.map((f) =>
          f === 'selected' && !selected.length ? null : (
            <button
              className={'PermissionDesk-filter' + (ui.filter === f ? ' is-on' : '')}
              aria-pressed={ui.filter === f ? 'true' : 'false'}
              onclick={() => {
                ui.filter = f;
                ui.limit = PAGE;
              }}
            >
              {t('tags.filter.' + f, { group: groupName(g), count: selected.length })}
            </button>
          )
        )}
      </div>
    );
  }

  table(shown: TagItem[], hasKids: Set<string>) {
    const ui = this.attrs.ui;
    const allShown = shown.length > 0 && shown.every((i) => ui.selected[i.id]);
    return (
      <div className="PermissionDesk-scrollX">
        <table className="PermissionDesk-matrix PermissionDesk-tagTable">
          <thead>
            <tr>
              <th className="PermissionDesk-pick">
                <input
                  type="checkbox"
                  checked={allShown}
                  aria-label={extractText(t('tags.select_shown'))}
                  onchange={() => shown.forEach((i) => (allShown ? delete ui.selected[i.id] : (ui.selected[i.id] = true)))}
                />
              </th>
              <th>{t('tags.tag')}</th>
              <th>{t('tags.view')}</th>
              <th>{t('tags.start')}</th>
              <th>{t('tags.reply')}</th>
              <th>{t('tags.moderate')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((i) => this.row(i, hasKids.has(i.id)))}
            {!shown.length ? (
              <tr>
                <td colspan={7} className="PermissionDesk-muted">
                  {t('tags.none')}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    );
  }

  row(i: TagItem, parent: boolean) {
    const ui = this.attrs.ui;
    const changed = Object.keys(desk.staged).some((k) => k.startsWith(`tag${i.id}.`));

    return (
      <tr className={(changed ? 'is-changed' : '') + (ui.selected[i.id] ? ' is-selected' : '')}>
        <td className="PermissionDesk-pick">
          <input
            type="checkbox"
            checked={!!ui.selected[i.id]}
            aria-label={extractText(t('tags.select', { tag: i.path }))}
            onchange={(e: Event) => ((e.target as HTMLInputElement).checked ? (ui.selected[i.id] = true) : delete ui.selected[i.id])}
          />
        </td>
        {this.nameCell(i, parent, changed)}
        {i.restricted ? this.restrictedCells(i) : this.openCells(i)}
      </tr>
    );
  }

  nameCell(i: TagItem, parent: boolean, changed: boolean) {
    const ui = this.attrs.ui;
    const g = ui.group;
    const tree = !ui.q.trim() && ui.filter === 'all';
    // Flarum hides a child tag from anyone who can't see its parent.
    const parentItem = i.parentId ? this.byId.get(i.parentId) : null;
    const parentHidden = !!parentItem?.restricted && allowed(g, scoped('viewForum', i.id)) && !allowed(g, scoped('viewForum', parentItem.id));
    return (
      <td>
        <span className="PermissionDesk-tagName" style={{ paddingLeft: (tree ? i.depth * 20 : 0) + 'px' }}>
          {tree && parent ? (
            <button
              className="PermissionDesk-caret"
              aria-expanded={ui.collapsed[i.id] ? 'false' : 'true'}
              aria-label={extractText(t(ui.collapsed[i.id] ? 'tags.expand' : 'tags.collapse', { tag: i.name }))}
              onclick={() => (ui.collapsed[i.id] ? delete ui.collapsed[i.id] : (ui.collapsed[i.id] = true))}
            >
              <Icon name={ui.collapsed[i.id] ? 'fas fa-caret-right' : 'fas fa-caret-down'} />
            </button>
          ) : (
            <span className="PermissionDesk-caretSpace" />
          )}
          <span className="PermissionDesk-tagDot" style={{ background: i.tag.attribute('color') || 'var(--pd-faint)' }} />
          <span className="PermissionDesk-tagLabel">{tree ? i.name : i.path}</span>
          {i.restricted ? <Icon name="fas fa-lock" className="PermissionDesk-lock" title={extractText(t('tags.restricted'))} /> : null}
          {parentHidden ? (
            <span
              className="PermissionDesk-flag PermissionDesk-flag--amber"
              title={extractText(t('tags.parent_hidden_help', { parent: parentItem!.name }))}
            >
              {t('tags.parent_hidden')}
            </span>
          ) : null}
          {changed ? <span className="PermissionDesk-chip PermissionDesk-chip--unsaved">{t('unsaved')}</span> : null}
        </span>
      </td>
    );
  }

  restrictedCells(i: TagItem) {
    const g = this.attrs.ui.group;
    const mods = modRows();
    const modOn = mods.filter((r) => allowed(g, scoped(r.key, i.id))).length;
    return [
      ...CELLS.map((key) => <td>{this.cell(i, key)}</td>),
      <td>
        <button className="Button Button--link PermissionDesk-modCount" onclick={() => this.attrs.openTag(i.id, g)}>
          {modOn ? t('tags.of', { on: modOn, total: mods.length }) : <span className="PermissionDesk-no">–</span>}
        </button>
      </td>,
      <td className="PermissionDesk-tagActions">
        <Button className="Button Button--link" onclick={() => this.attrs.openTag(i.id, g)}>
          {t('tags.edit')}
        </Button>
      </td>,
    ];
  }

  openCells(i: TagItem) {
    const ui = this.attrs.ui;
    return [
      <td colspan={4} className="PermissionDesk-muted PermissionDesk-openNote">
        <span className="PermissionDesk-wide">{t('tags.open_note')}</span>
        <span className="PermissionDesk-narrow">{t('tags.open_short')}</span>
      </td>,
      <td className="PermissionDesk-tagActions">
        <Button className="Button Button--link" disabled={ui.busy} onclick={() => this.restrict([i.id])}>
          {t('tags.restrict_one')}
        </Button>
      </td>,
    ];
  }

  cell(i: TagItem, base: string) {
    const ui = this.attrs.ui;
    const g = ui.group;
    const key = scoped(base, i.id);
    const rs = rowState(g, key);
    const row = collect().rows.find((r) => r.key === base);
    if (g === GUEST && row && !row.allowGuest) return <span className="PermissionDesk-no">–</span>;
    const on = rs.st === 'on' || rs.st === 'inh';
    const name = extractText(t('tags.cell', { what: row?.text ?? base, tag: i.path }));
    return (
      <button
        type="button"
        className={'PermissionDesk-cell is-' + rs.st}
        aria-pressed={on ? 'true' : 'false'}
        aria-label={name}
        title={rs.st === 'inh' ? extractText(t('via', { group: groupName(rs.via!) })) : name}
        onclick={() => {
          const set = desk.cur(key);
          if (set.includes(g))
            desk.stage(
              key,
              set.filter((x) => x !== g)
            );
          else if (rs.st !== 'inh') {
            // Turning on Start or Reply turns on what it needs in this tag (View).
            desk.stage(key, [...set, g]);
            required(key).forEach((k) => allowed(g, k) || desk.stage(k, [...desk.cur(k), g]));
          } else {
            app.alerts.clear();
            app.alerts.show({ type: 'info' }, t('hint.inherited'));
          }
        }}
      >
        {rs.st === 'off' ? '–' : '✓'}
      </button>
    );
  }

  bulk(selected: string[]) {
    const ui = this.attrs.ui;
    const items = tagItems().filter((i) => ui.selected[i.id]);
    const restricted = items.filter((i) => i.restricted);
    const open = items.filter((i) => !i.restricted);

    return (
      <div className="PermissionDesk-bulk" role="region" aria-label={extractText(t('tags.bulk_label'))}>
        <div className="PermissionDesk-bulkHead">
          <b>{t('tags.selected', { count: selected.length })}</b>
          <Button className="Button Button--link" onclick={() => (ui.selected = {})}>
            {t('tags.clear_selection')}
          </Button>
        </div>
        {restricted.length ? this.bulkAction(restricted) : null}
        {restricted.length ? (
          <div className="PermissionDesk-bulkRow">
            <span>{t('tags.copy_from')}</span>
            <TagPicker value={ui.copyFrom} global restricted label={extractText(t('tags.copy_from'))} onchange={(id: string) => (ui.copyFrom = id)} />
            <Button className="Button" onclick={() => this.copy(restricted)}>
              {t('tags.copy_to', { count: restricted.filter((i) => i.id !== ui.copyFrom).length })}
            </Button>
          </div>
        ) : null}
        <div className="PermissionDesk-bulkRow">
          {open.length ? (
            <Button className="Button" icon="fas fa-lock" loading={ui.busy} onclick={() => this.restrict(open.map((i) => i.id))}>
              {t('tags.restrict_many', { count: open.length })}
            </Button>
          ) : null}
          {restricted.length ? (
            <Button className="Button" icon="fas fa-lock-open" loading={ui.busy} onclick={() => this.unrestrict(restricted)}>
              {t('tags.unrestrict_many', { count: restricted.length })}
            </Button>
          ) : null}
        </div>
        {ui.action === 'remove' && ui.group !== GUEST ? <p className="PermissionDesk-muted">{t('tags.remove_note')}</p> : null}
      </div>
    );
  }

  bulkAction(restricted: TagItem[]) {
    const ui = this.attrs.ui;
    const whats: What[] = ['viewForum', 'startDiscussion', 'discussion.reply', 'post', 'moderate', 'all'];
    return (
      <div className="PermissionDesk-bulkRow">
        <select
          className="FormControl"
          aria-label={extractText(t('tags.action'))}
          value={ui.action}
          onchange={(e: Event) => (ui.action = (e.target as HTMLSelectElement).value as any)}
        >
          <option value="allow">{t('tags.allow', { group: groupName(ui.group) })}</option>
          <option value="remove">{t('tags.remove', { group: groupName(ui.group) })}</option>
        </select>
        <select
          className="FormControl"
          aria-label={extractText(t('tags.what'))}
          value={ui.what}
          onchange={(e: Event) => (ui.what = (e.target as HTMLSelectElement).value as What)}
        >
          {whats.map((w) => (
            <option value={w}>{t('tags.what_' + w.replace('.', '_'))}</option>
          ))}
        </select>
        <Button className="Button Button--primary" onclick={() => this.apply(restricted)}>
          {t('tags.apply', { count: restricted.length })}
        </Button>
      </div>
    );
  }

  keysFor(what: What, allow: boolean): Row[] {
    const rows = tagRows();
    if (what === 'post') return rows.filter((r) => CELLS.includes(r.key));
    if (what === 'moderate') return rows.filter((r) => r.area === 'moderate' && (!allow || !r.danger));
    if (what === 'all') return rows.filter((r) => !allow || r.danger !== 'red');
    return rows.filter((r) => r.key === what);
  }

  apply(tags: TagItem[]) {
    const ui = this.attrs.ui;
    const g = ui.group;
    const allow = ui.action === 'allow';
    const n = desk.diff().length;
    tags.forEach((i) =>
      this.keysFor(ui.what, allow).forEach((r) => {
        if (g === GUEST && !r.allowGuest) return;
        const key = scoped(r.key, i.id);
        const set = desk.cur(key);
        if (allow) {
          if (!set.includes(g)) desk.stage(key, [...set, g]);
          required(key).forEach((k) => allowed(g, k) || desk.stage(k, [...desk.cur(k), g]));
        } else if (set.includes(g))
          desk.stage(
            key,
            set.filter((x) => x !== g)
          );
      })
    );
    this.staged(desk.diff().length - n);
  }

  copy(tags: TagItem[]) {
    const from = this.attrs.ui.copyFrom;
    const n = desk.diff().length;
    tags.forEach((i) => {
      if (i.id === from) return;
      tagRows().forEach((r) => desk.stage(scoped(r.key, i.id), desk.cur(scoped(r.key, from))));
    });
    this.staged(desk.diff().length - n);
  }

  staged(n: number) {
    app.alerts.clear();
    app.alerts.show({ type: n ? 'success' : 'info' }, n ? t('staged', { count: n }) : t('tags.nothing'));
  }

  /**
   * Restrict tags without changing what anyone can do: first save a copy of the forum-wide
   * permissions as each tag's own (ignored while the tag is open, logged in History), then switch
   * the tag to restricted. Edit them afterwards like any other.
   */
  async restrict(ids: string[]) {
    const ui = this.attrs.ui;
    if (!confirm(extractText(t('tags.restrict_confirm', { count: ids.length })))) return;
    ui.busy = true;
    m.redraw();
    try {
      const changes: { permission: string; before: number[]; after: number[] }[] = [];
      ids.forEach((id) =>
        tagRows().forEach((r) => {
          const key = scoped(r.key, id);
          const before = desk.base(key);
          const after = desk.base(r.key);
          if (before.join() !== after.join()) changes.push({ permission: key, before, after });
        })
      );
      if (changes.length) {
        const names = ids.map((id) => tagItems().find((i) => i.id === id)?.name ?? id);
        const note = extractText(t('tags.restrict_note', { tags: names.slice(0, 3).join(', '), count: names.length }));
        const res: any = await api('POST', '/changesets', { changes, note });
        desk.setMap(res.map);
        desk.historyVersion++;
      }
      for (const id of ids) await app.store.getById<any>('tags', id)?.save({ isRestricted: true });
      ids.forEach((id) => delete ui.selected[id]);
      app.alerts.clear();
      app.alerts.show({ type: 'success' }, t('tags.restricted_done', { count: ids.length }));
    } finally {
      ui.busy = false;
      m.redraw();
    }
  }

  async unrestrict(tags: TagItem[]) {
    const ui = this.attrs.ui;
    if (!confirm(extractText(t('tags.unrestrict_confirm', { count: tags.length })))) return;
    ui.busy = true;
    m.redraw();
    try {
      for (const i of tags) await i.tag.save({ isRestricted: false });
      tags.forEach((i) => delete ui.selected[i.id]);
      app.alerts.clear();
      app.alerts.show({ type: 'success' }, t('tags.unrestricted_done', { count: tags.length }));
    } finally {
      ui.busy = false;
      m.redraw();
    }
  }
}
