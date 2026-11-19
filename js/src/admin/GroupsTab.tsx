import app from 'flarum/admin/app';
import Component from 'flarum/common/Component';
import Button from 'flarum/common/components/Button';
import Icon from 'flarum/common/components/Icon';
import EditGroupModal from 'flarum/admin/components/EditGroupModal';
import extractText from 'flarum/common/utils/extractText';
import isExtensionEnabled from 'flarum/admin/utils/isExtensionEnabled';
import type Mithril from 'mithril';
import { ADMIN, GUEST, MEMBER, allowed, desk, required, rowState, scoped, t } from './state';
import { AREAS, MANY_TAGS, collect, groupBadge, groupColor, groupName, groups, labelFor, restrictedTags, tagName, type Row } from './rows';
import TagPicker from './TagPicker';
import { CopyModal, PresetModal } from './modals';

export interface GroupsTabAttrs {
  ui: GroupsUi;
  presets: () => any[];
  reloadPresets: () => void;
  openTags: (group: number) => void;
}

export interface GroupsUi {
  group: number;
  scope: string;
  q: string;
  by: 'area' | 'ext';
  compare: boolean;
  a: number;
  b: number;
  onlyDiff: boolean;
  /** Compare: tags opened out (with many tags, each starts as one summary line). */
  cmpOpen: Record<string, true>;
  hint: { key: string; kind: 'deps' | 'view' | 'inherited'; missing?: string[]; count?: number } | null;
}

export function mark(text: string, q: string): Mithril.Children {
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  // One span, so the label's flex gap never splits the word around the highlight.
  if (i < 0) return <span>{text}</span>;
  return (
    <span>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </span>
  );
}

export function flagBadge(row: Row) {
  if (!row.danger) return null;
  return (
    <span className={'PermissionDesk-flag PermissionDesk-flag--' + row.danger} title={row.desc || row.text}>
      <Icon name="fas fa-triangle-exclamation" /> {t(row.danger === 'red' ? 'risky' : 'sensitive')}
    </span>
  );
}

/**
 * Group-first editing: pick a group, see everything it can do in plain words, switch things on
 * and off (staged, never saved per click), per restricted tag too.
 */
export default class GroupsTab extends Component<GroupsTabAttrs> {
  view() {
    const ui = this.attrs.ui;
    return ui.compare ? this.compareView() : this.groupView();
  }

  rail() {
    const ui = this.attrs.ui;
    const all = groups();
    const label = (id: number) => (id === GUEST ? t('guests_everyone') : groupName(id));
    return [
      <nav className="PermissionDesk-rail" aria-label={extractText(t('groups'))}>
        {all.map((g) => {
          const id = Number(g.id());
          return (
            <button
              className={'PermissionDesk-railItem' + (ui.group === id ? ' is-on' : '')}
              aria-current={ui.group === id ? 'true' : undefined}
              onclick={() => {
                ui.group = id;
                ui.hint = null;
              }}
            >
              <span className="PermissionDesk-dot" style={{ background: groupColor(id) || 'var(--pd-faint)' }} />
              <span className="PermissionDesk-railName">{label(id)}</span>
            </button>
          );
        })}
        <button className="PermissionDesk-railItem PermissionDesk-railItem--add" onclick={() => app.modal.show(EditGroupModal)}>
          <Icon name="fas fa-plus" /> {t('new_group')}
        </button>
      </nav>,
      <label className="PermissionDesk-railPick">
        <span className="visually-hidden">{t('groups')}</span>
        <select
          className="FormControl"
          value={String(ui.group)}
          onchange={(e: Event) => {
            ui.group = Number((e.target as HTMLSelectElement).value);
            ui.hint = null;
          }}
        >
          {all.map((g) => (
            <option value={String(g.id())}>{label(Number(g.id()))}</option>
          ))}
        </select>
      </label>,
    ];
  }

  groupView() {
    const ui = this.attrs.ui;
    const g = ui.group;
    const group = app.store.getById<any>('groups', String(g));
    const tags = restrictedTags();
    if (ui.scope !== 'global' && !tags.find((tag) => tag.id() === ui.scope)) ui.scope = 'global';
    const q = ui.q.trim().toLowerCase();
    let rows = collect().rows.filter((r) => ui.scope === 'global' || r.tagScoped);
    if (q) rows = rows.filter((r) => `${r.text} ${r.desc || ''} ${r.key} ${r.extTitle}`.toLowerCase().includes(q));

    const sections: [Mithril.Children, Row[]][] =
      ui.by === 'area'
        ? AREAS.map((area) => [t('area.' + area), rows.filter((r) => r.area === area)])
        : [...new Set(rows.map((r) => r.ext))].map((ext) => [rows.find((r) => r.ext === ext)!.extTitle, rows.filter((r) => r.ext === ext)]);

    return (
      <div className="PermissionDesk-groups">
        <div className="PermissionDesk-railWrap">{this.rail()}</div>
        <div className="PermissionDesk-main">
          {this.groupHead(g, group)}

          {g === ADMIN ? <p className="PermissionDesk-note PermissionDesk-note--info">{t('admins_note')}</p> : null}

          {this.groupToolbar(tags)}

          {ui.scope !== 'global' ? (
            <p className="PermissionDesk-note PermissionDesk-note--info">{t('scope.note', { tag: <b>{tagName(ui.scope)}</b> })}</p>
          ) : null}

          {sections.map(([title, list]) => (list.length ? this.section(title, list) : null))}
          {!rows.length ? <p className="PermissionDesk-note PermissionDesk-note--info">{t('no_match', { q: ui.q })}</p> : null}

          {ui.scope === 'global' && !q && isExtensionEnabled('flarum-tags') ? this.tagSummary(tags) : null}
          {ui.scope === 'global' && !q ? this.settings() : null}
        </div>
      </div>
    );
  }

  groupHead(g: number, group: any) {
    return (
      <div className="PermissionDesk-ghead">
        <span className="PermissionDesk-gicon" style={{ background: groupColor(g) || 'var(--pd-faint)' }}>
          {group?.icon() ? <Icon name={group.icon()} /> : groupName(g).charAt(0)}
        </span>
        <div className="PermissionDesk-gtitle">
          <h2>{g === GUEST ? t('guests_everyone') : groupName(g)}</h2>
          <div className="PermissionDesk-muted">
            {g === GUEST ? t('guests_help') : g === MEMBER ? t('members_help') : g === ADMIN ? t('admins_help') : t('group_help')}
          </div>
        </div>
        {this.groupActions(g, group)}
      </div>
    );
  }

  groupActions(g: number, group: any) {
    const ui = this.attrs.ui;
    return (
      <div className="PermissionDesk-gactions">
        <Button
          className="Button"
          icon="fas fa-code-compare"
          onclick={() => {
            ui.compare = true;
            ui.a = g;
            ui.b = g === MEMBER ? 4 : MEMBER;
          }}
        >
          {t('compare')}
        </Button>
        <Button
          className="Button"
          icon="far fa-copy"
          disabled={g === ADMIN}
          onclick={() => app.modal.show(CopyModal, { to: g, groupIds: groups().map((x) => Number(x.id())) })}
        >
          {t('copy.button')}
        </Button>
        <Button
          className="Button"
          icon="fas fa-wand-magic-sparkles"
          disabled={g === ADMIN}
          onclick={() => app.modal.show(PresetModal, { group: g, saved: this.attrs.presets(), onChange: this.attrs.reloadPresets })}
        >
          {t('preset.button')}
        </Button>
        {group && g > MEMBER && g !== ADMIN ? (
          <Button
            className="Button Button--icon"
            icon="fas fa-pencil"
            aria-label={extractText(t('edit_group'))}
            onclick={() => app.modal.show(EditGroupModal, { group })}
          />
        ) : null}
      </div>
    );
  }

  groupToolbar(tags: any[]) {
    const ui = this.attrs.ui;
    return (
      <div className="PermissionDesk-toolbar">
        <input
          className="FormControl PermissionDesk-search"
          type="search"
          value={ui.q}
          placeholder={extractText(t('search_placeholder'))}
          aria-label={extractText(t('search_label'))}
          oninput={(e: InputEvent) => (ui.q = (e.target as HTMLInputElement).value)}
        />
        {tags.length ? (
          <TagPicker value={ui.scope} global restricted label={extractText(t('scope.label'))} onchange={(id: string) => (ui.scope = id)} />
        ) : null}
        <select
          className="FormControl"
          aria-label={extractText(t('by.label'))}
          value={ui.by}
          onchange={(e: Event) => (ui.by = (e.target as HTMLSelectElement).value as any)}
        >
          <option value="area">{t('by.area')}</option>
          <option value="ext">{t('by.ext')}</option>
        </select>
      </div>
    );
  }

  section(title: Mithril.Children, list: Row[]) {
    const ui = this.attrs.ui;
    const g = ui.group;
    const on = list.filter((r) => allowed(g, scoped(r.key, ui.scope))).length;
    return (
      <section className="PermissionDesk-section">
        <h3>
          <span>{title}</span>
          <span className="PermissionDesk-sectionCount">{t('allowed_of', { on, total: list.length })}</span>
        </h3>
        {list.map((r) => this.row(r))}
      </section>
    );
  }

  row(r: Row) {
    const ui = this.attrs.ui;
    const g = ui.group;
    const key = scoped(r.key, ui.scope);
    const rs = rowState(g, key);
    const changed = desk.staged[key] !== undefined && desk.staged[key].includes(g) !== desk.base(key).includes(g);
    const differs = ui.scope !== 'global' && allowed(g, r.key) !== allowed(g, key);
    const guestBlocked = g === GUEST && !r.allowGuest;
    const name = extractText(r.label);
    const viaText = rs.via ? t(rs.st === 'on' ? 'also_via' : 'via', { group: groupName(rs.via) }) : rs.st === 'lock' ? t('admins_always') : null;

    return [
      <div className={'PermissionDesk-row' + (changed ? ' is-changed' : '')}>
        <span className="PermissionDesk-rowIcon" aria-hidden="true">
          <Icon name={r.icon} />
        </span>
        <div className="PermissionDesk-rowText">
          <div className="PermissionDesk-rowLabel">
            {mark(name, ui.q.trim())}
            {flagBadge(r)}
            {differs ? <span className="PermissionDesk-chip">{t('differs')}</span> : null}
            {ui.by === 'area' && r.ext !== 'core-permissions' ? (
              <span className="PermissionDesk-chip PermissionDesk-chip--ext">{r.extTitle}</span>
            ) : null}
            {changed ? <span className="PermissionDesk-chip PermissionDesk-chip--unsaved">{t('unsaved')}</span> : null}
          </div>
          {r.desc ? <div className="PermissionDesk-rowDesc">{mark(r.desc, ui.q.trim())}</div> : null}
        </div>
        <div className="PermissionDesk-rowSide">
          {viaText ? <span className="PermissionDesk-via">{viaText}</span> : null}
          {guestBlocked ? (
            <span className="PermissionDesk-via">{t('members_only')}</span>
          ) : (
            <button
              type="button"
              role="switch"
              className={'PermissionDesk-switch is-' + rs.st}
              aria-checked={rs.st === 'on' || rs.st === 'lock' ? 'true' : 'false'}
              aria-label={name}
              disabled={rs.st === 'lock'}
              onclick={() => this.toggle(key)}
            />
          )}
        </div>
      </div>,
      ui.hint && ui.hint.key === key ? this.hint() : null,
    ];
  }

  hint() {
    const ui = this.attrs.ui;
    const h = ui.hint!;
    if (h.kind === 'deps') {
      return (
        <div className="PermissionDesk-hint">
          <span>{t('hint.needs', { what: <b>{h.missing!.map((k) => labelFor(k)).join(', ')}</b> })}</span>
          <Button
            className="Button Button--small"
            onclick={() => {
              h.missing!.forEach((k) => desk.stage(k, [...desk.cur(k), ui.group]));
              ui.hint = null;
            }}
          >
            {t('hint.turn_on', { count: h.missing!.length })}
          </Button>
        </div>
      );
    }
    if (h.kind === 'view') return <div className="PermissionDesk-hint">{t('hint.view_off', { count: h.count })}</div>;
    return <div className="PermissionDesk-hint">{t('hint.inherited')}</div>;
  }

  toggle(key: string) {
    const ui = this.attrs.ui;
    const g = ui.group;
    const set = desk.cur(key);
    const on = !set.includes(g);
    desk.stage(key, on ? [...set, g] : set.filter((x) => x !== g));
    ui.hint = null;
    if (on) {
      const missing = required(key).filter((k) => !allowed(g, k));
      if (missing.length) ui.hint = { key, kind: 'deps', missing };
    } else if (rowState(g, key).st === 'inh') {
      ui.hint = { key, kind: 'inherited' };
    } else if (/(^|\.)viewForum$/.test(key)) {
      const prefix = key.slice(0, key.length - 'viewForum'.length);
      const count = collect().rows.filter((r) => required(prefix + r.key).includes(key) && allowed(g, prefix + r.key)).length;
      if (count) ui.hint = { key, kind: 'view', count };
    }
  }

  tagSummary(tags: any[]) {
    const g = this.attrs.ui.group;
    const count = (key: string) => tags.filter((tag) => allowed(g, scoped(key, tag.id()))).length;
    return (
      <section className="PermissionDesk-section PermissionDesk-section--plain">
        <h3>
          <span>{t('tags.title', { group: groupName(g) })}</span>
        </h3>
        <div className="PermissionDesk-restrict">
          <p className="PermissionDesk-muted">
            {g === ADMIN
              ? t('tags.summary_admin', { total: tags.length })
              : tags.length
                ? t('tags.summary_group', {
                    group: groupName(g),
                    total: tags.length,
                    view: count('viewForum'),
                    start: count('startDiscussion'),
                    reply: count('discussion.reply'),
                  })
                : t('tags.summary_none')}
          </p>
          <Button className="Button" icon="fas fa-tags" onclick={() => this.attrs.openTags(g)}>
            {t('tags.open_tab')}
          </Button>
        </div>
      </section>
    );
  }

  settings() {
    const settings = collect().settings;
    if (!settings.length) return null;
    return (
      <section className="PermissionDesk-section">
        <h3>
          <span>{t('settings.title')}</span>
          <span className="PermissionDesk-sectionCount">{t('settings.help')}</span>
        </h3>
        {settings.map((s) => (
          <div className="PermissionDesk-row">
            <span className="PermissionDesk-rowIcon" aria-hidden="true">
              <Icon name={s.icon} />
            </span>
            <div className="PermissionDesk-rowText">
              <div className="PermissionDesk-rowLabel">{s.label}</div>
            </div>
            <div className="PermissionDesk-rowSide PermissionDesk-setting">{s.setting()}</div>
          </div>
        ))}
      </section>
    );
  }

  compareView() {
    const ui = this.attrs.ui;
    const { body, differences } = this.compareBody();
    return (
      <div className="PermissionDesk-compare">
        <div className="PermissionDesk-toolbar">
          <Button className="Button" icon="fas fa-arrow-left" onclick={() => (ui.compare = false)}>
            {t('compare_back', { group: groupName(ui.group) })}
          </Button>
        </div>
        <div className="PermissionDesk-toolbar">
          {this.comparePick(ui.a, (v) => (ui.a = v), extractText(t('compare_a')))}
          <span className="PermissionDesk-muted">{t('vs')}</span>
          {this.comparePick(ui.b, (v) => (ui.b = v), extractText(t('compare_b')))}
          <label className="PermissionDesk-check">
            <input type="checkbox" checked={ui.onlyDiff} onchange={(e: Event) => (ui.onlyDiff = (e.target as HTMLInputElement).checked)} />{' '}
            {t('only_diff')}
          </label>
          <Button className="Button Button--primary" disabled={ui.b === ADMIN || ui.a === ui.b || !differences} onclick={() => this.match()}>
            {t('match', { b: groupName(ui.b), a: groupName(ui.a) })}
          </Button>
        </div>
        <p className="PermissionDesk-note PermissionDesk-note--info">
          {t('differences', { count: differences, a: groupName(ui.a), b: groupName(ui.b), tags: restrictedTags().length })}
        </p>
        {this.compareTable(body)}
      </div>
    );
  }

  comparePick(value: number, set: (v: number) => void, label: string) {
    return (
      <select
        className="FormControl"
        aria-label={label}
        value={String(value)}
        onchange={(e: Event) => set(Number((e.target as HTMLSelectElement).value))}
      >
        {groups().map((g) => {
          const id = Number(g.id());
          return <option value={String(id)}>{id === GUEST ? t('guests_everyone') : groupName(id)}</option>;
        })}
      </select>
    );
  }

  compareCell(g: number, key: string) {
    const rs = rowState(g, key);
    if (rs.st === 'on' || rs.st === 'lock') return <span className="PermissionDesk-yes">✓</span>;
    if (rs.st === 'inh')
      return (
        <span className="PermissionDesk-inh" title={extractText(t('via', { group: groupName(rs.via!) }))}>
          ✓ <small>{groupName(rs.via!)}</small>
        </span>
      );
    return <span className="PermissionDesk-no">–</span>;
  }

  /** Every scope's rows (Everywhere, then each restricted tag), and how many differ in all. */
  compareBody(): { body: Mithril.Children[]; differences: number } {
    const scopes: [string, Mithril.Children][] = [
      ['global', t('scope.global')],
      ...restrictedTags().map((tag) => [tag.id(), t('scope.in_tag', { tag: tagName(tag.id()) })] as [string, Mithril.Children]),
    ];
    const many = scopes.length - 1 > MANY_TAGS;
    let differences = 0;
    const body: Mithril.Children[] = [];
    scopes.forEach(([scope, title]) => {
      const { part, here } = this.compareRows(scope);
      differences += here;
      if (!part.length) return;
      // With many tags each one is a single line until opened, so the page stays short.
      if (many && scope !== 'global') body.push(this.compareToggle(scope, title, here), ...(this.attrs.ui.cmpOpen[scope] ? part : []));
      else
        body.push(
          <tr className="PermissionDesk-subhead">
            <td colspan={3}>{title}</td>
          </tr>,
          ...part
        );
    });
    return { body, differences };
  }

  compareRows(scope: string): { part: Mithril.Children[]; here: number } {
    const ui = this.attrs.ui;
    const part: Mithril.Children[] = [];
    let here = 0;
    collect()
      .rows.filter((r) => scope === 'global' || r.tagScoped)
      .forEach((r) => {
        const key = scoped(r.key, scope);
        const d = allowed(ui.a, key) !== allowed(ui.b, key);
        if (d) here++;
        if (ui.onlyDiff && !d) return;
        part.push(
          <tr className={d ? 'is-diff' : ''}>
            <td>
              {r.text} {flagBadge(r)}
            </td>
            <td className="PermissionDesk-c">{this.compareCell(ui.a, key)}</td>
            <td className="PermissionDesk-c">{this.compareCell(ui.b, key)}</td>
          </tr>
        );
      });
    return { part, here };
  }

  compareToggle(scope: string, title: Mithril.Children, here: number) {
    const ui = this.attrs.ui;
    const open = !!ui.cmpOpen[scope];
    return (
      <tr className="PermissionDesk-subhead">
        <td colspan={3}>
          <button
            className="PermissionDesk-subheadBtn"
            aria-expanded={open ? 'true' : 'false'}
            onclick={() => (open ? delete ui.cmpOpen[scope] : (ui.cmpOpen[scope] = true))}
          >
            <Icon name={open ? 'fas fa-caret-down' : 'fas fa-caret-right'} /> {title}
            <span className="PermissionDesk-muted"> · {t('differences_short', { count: here })}</span>
          </button>
        </td>
      </tr>
    );
  }

  compareTable(body: Mithril.Children[]) {
    const ui = this.attrs.ui;
    return (
      <div className="PermissionDesk-tableWrap">
        <table className="PermissionDesk-cmp">
          <thead>
            <tr>
              <th>{t('permission')}</th>
              <th className="PermissionDesk-c">{groupBadge(ui.a)}</th>
              <th className="PermissionDesk-c">{groupBadge(ui.b)}</th>
            </tr>
          </thead>
          <tbody>
            {body.length ? (
              body
            ) : (
              <tr>
                <td colspan={3} className="PermissionDesk-muted">
                  {t('no_differences')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    );
  }

  match() {
    const ui = this.attrs.ui;
    let n = 0;
    ['global', ...restrictedTags().map((tag) => tag.id())].forEach((scope) =>
      collect()
        .rows.filter((r) => scope === 'global' || r.tagScoped)
        .forEach((r) => {
          if (ui.b === GUEST && !r.allowGuest) return;
          const key = scoped(r.key, scope);
          const set = desk.cur(key);
          const aHas = allowed(ui.a, key);
          const bOwn = set.includes(ui.b);
          if (aHas && !allowed(ui.b, key)) {
            desk.stage(key, [...set, ui.b]);
            n++;
          } else if (!aHas && bOwn) {
            desk.stage(
              key,
              set.filter((x) => x !== ui.b)
            );
            n++;
          }
        })
    );
    app.alerts.clear();
    app.alerts.show({ type: 'success' }, t('staged', { count: n }));
  }
}
