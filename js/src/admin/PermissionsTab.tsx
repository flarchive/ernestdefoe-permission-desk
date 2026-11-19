import Component from 'flarum/common/Component';
import Button from 'flarum/common/components/Button';
import Icon from 'flarum/common/components/Icon';
import extractText from 'flarum/common/utils/extractText';
import type Mithril from 'mithril';
import { ADMIN, GUEST, MEMBER, desk, scoped, t } from './state';
import { AREAS, MANY_TAGS, collect, groupBadge, groupName, groups, orphans, restrictedTags, tagName, type Row } from './rows';
import TagPicker from './TagPicker';
import { flagBadge, mark } from './GroupsTab';

export interface PermissionsUi {
  q: string;
  filter: 'all' | 'guests' | 'one' | 'none' | 'danger' | 'other';
  open: string | null;
  /** Tags the admin picked to change this permission in, besides the ones that already differ. */
  extra: string[];
}

const FILTERS: PermissionsUi['filter'][] = ['all', 'guests', 'one', 'none', 'danger', 'other'];

/** Permission-first: every permission and who has it; open a row to change it per group and tag. */
export default class PermissionsTab extends Component<{ ui: PermissionsUi }> {
  view() {
    const ui = this.attrs.ui;
    const q = ui.q.trim().toLowerCase();
    return (
      <div className="PermissionDesk-perms">
        <div className="PermissionDesk-toolbar">
          <input
            className="FormControl PermissionDesk-search"
            type="search"
            value={ui.q}
            placeholder={extractText(t('search_placeholder'))}
            aria-label={extractText(t('search_label'))}
            oninput={(e: InputEvent) => (ui.q = (e.target as HTMLInputElement).value)}
          />
        </div>
        <div className="PermissionDesk-filters" role="group" aria-label={extractText(t('filter.label'))}>
          {FILTERS.map((f) => (
            <button
              className={'PermissionDesk-filter' + (ui.filter === f ? ' is-on' : '')}
              aria-pressed={ui.filter === f ? 'true' : 'false'}
              onclick={() => {
                ui.filter = f;
                ui.open = null;
              }}
            >
              {t('filter.' + f)}
            </button>
          ))}
        </div>
        {ui.filter === 'other' ? this.other() : AREAS.map((area) => this.section(area, q))}
      </div>
    );
  }

  section(area: string, q: string) {
    const ui = this.attrs.ui;
    const list = collect().rows.filter((r) => {
      if (r.area !== area) return false;
      if (q && !`${r.text} ${r.desc || ''} ${r.key} ${r.extTitle}`.toLowerCase().includes(q)) return false;
      const set = desk.cur(r.key);
      if (ui.filter === 'guests') return set.includes(GUEST);
      if (ui.filter === 'one') return set.length === 1 && !set.includes(GUEST) && !set.includes(MEMBER);
      if (ui.filter === 'none') return set.length === 0;
      if (ui.filter === 'danger') return !!r.danger;
      return true;
    });
    if (!list.length) return null;
    return (
      <section className="PermissionDesk-section">
        <h3>
          <span>{t('area.' + area)}</span>
          <span className="PermissionDesk-sectionCount">{list.length}</span>
        </h3>
        {list.map((r) => this.row(r))}
      </section>
    );
  }

  who(set: number[]) {
    if (set.includes(GUEST)) return groupBadge(GUEST);
    if (set.includes(MEMBER)) return groupBadge(MEMBER);
    return [groupBadge(ADMIN), ...set.map((g) => groupBadge(g))];
  }

  row(r: Row) {
    const ui = this.attrs.ui;
    const set = desk.cur(r.key);
    const tags = r.tagScoped ? restrictedTags() : [];
    const differ = tags.filter((tag) => desk.cur(scoped(r.key, tag.id())).join() !== set.join()).length;
    const open = ui.open === r.key;
    const changed = Object.keys(desk.staged).some((k) => k === r.key || k.endsWith('.' + r.key));
    const toggle = () => {
      ui.open = open ? null : r.key;
      ui.extra = [];
    };

    return (
      <div className={'PermissionDesk-prow' + (open ? ' is-open' : '')}>
        <button
          className={'PermissionDesk-row PermissionDesk-row--button' + (changed ? ' is-changed' : '')}
          aria-expanded={open ? 'true' : 'false'}
          onclick={toggle}
        >
          <span className="PermissionDesk-rowIcon" aria-hidden="true">
            <Icon name={r.icon} />
          </span>
          <span className="PermissionDesk-rowText">
            <span className="PermissionDesk-rowLabel">
              {mark(r.text, ui.q.trim())}
              {flagBadge(r)}
              {r.ext !== 'core-permissions' ? <span className="PermissionDesk-chip PermissionDesk-chip--ext">{r.extTitle}</span> : null}
            </span>
            <span className="PermissionDesk-rowDesc">
              {r.desc}
              {differ ? <b> {t('differs_in', { count: differ })}</b> : null}
            </span>
          </span>
          <span className="PermissionDesk-who">{this.who(set)}</span>
        </button>
        {open ? this.editor(r, tags) : null}
      </div>
    );
  }

  editor(r: Row, tags: any[]) {
    const ui = this.attrs.ui;
    const global = desk.cur(r.key).join();
    const differs = (id: string) => desk.cur(scoped(r.key, id)).join() !== global;
    const many = tags.length > MANY_TAGS;
    // With many tags, only the ones that differ from Everywhere (or that the admin picked) are listed.
    const shown = many ? tags.filter((tag) => differs(tag.id()) || ui.extra.includes(tag.id())) : tags;
    const differing = tags.filter((tag) => differs(tag.id()));
    const scopes: [string, Mithril.Children][] = [
      ['global', t('scope.global')],
      ...shown.map((tag) => [tag.id(), t('scope.in_tag', { tag: tagName(tag.id()) })] as [string, Mithril.Children]),
    ];
    return (
      <div className="PermissionDesk-editor">
        {scopes.map(([scope, title]) => this.scopeToggles(r, scope, title))}
        {many ? this.editorFoot(r, shown, differing, tags.length - differing.length) : null}
      </div>
    );
  }

  scopeToggles(r: Row, scope: string, title: Mithril.Children) {
    const key = scoped(r.key, scope);
    const set = desk.cur(key);
    return (
      <div className="PermissionDesk-scope">
        <b>{title}</b>
        {groups().map((group) => {
          const g = Number(group.id());
          if (g === GUEST && !r.allowGuest) return null;
          const on = g === ADMIN || set.includes(g);
          return (
            <button
              className={'PermissionDesk-gtoggle' + (on ? ' is-on' : '')}
              aria-pressed={on ? 'true' : 'false'}
              disabled={g === ADMIN}
              title={g === ADMIN ? extractText(t('admins_always')) : undefined}
              onclick={() => desk.stage(key, on ? set.filter((x) => x !== g) : [...set, g])}
            >
              {g === GUEST ? t('guests_everyone') : groupName(g)}
            </button>
          );
        })}
      </div>
    );
  }

  editorFoot(r: Row, shown: any[], differing: any[], same: number) {
    const ui = this.attrs.ui;
    return (
      <div className="PermissionDesk-editorFoot">
        <span className="PermissionDesk-muted">{t('tags.same_in', { count: same })}</span>
        <TagPicker
          value=""
          restricted
          exclude={shown.map((tag) => tag.id())}
          placeholder={extractText(t('tags.change_in'))}
          label={extractText(t('tags.change_in'))}
          onchange={(id: string) => ui.extra.push(id)}
        />
        {differing.length ? (
          <Button className="Button Button--small" onclick={() => differing.forEach((tag) => desk.stage(scoped(r.key, tag.id()), desk.cur(r.key)))}>
            {t('tags.match_all', { count: differing.length })}
          </Button>
        ) : null}
      </div>
    );
  }

  other() {
    const keys = orphans();
    return (
      <section className="PermissionDesk-section">
        <h3>
          <span>{t('other.title')}</span>
        </h3>
        {keys.length ? (
          keys.map((key) => (
            <div className="PermissionDesk-row">
              <span className="PermissionDesk-rowIcon" aria-hidden="true">
                ?
              </span>
              <div className="PermissionDesk-rowText">
                <div className="PermissionDesk-rowLabel">
                  <code>{key}</code>
                </div>
                <div className="PermissionDesk-rowDesc">{t('other.help')}</div>
              </div>
              <div className="PermissionDesk-rowSide">
                <span className="PermissionDesk-who">{desk.cur(key).map((g) => groupBadge(g))}</span>
                <Button className="Button Button--small" disabled={!desk.cur(key).length} onclick={() => desk.stage(key, [])}>
                  {t('other.clear')}
                </Button>
              </div>
            </div>
          ))
        ) : (
          <p className="PermissionDesk-empty">{t('other.none')}</p>
        )}
      </section>
    );
  }
}
