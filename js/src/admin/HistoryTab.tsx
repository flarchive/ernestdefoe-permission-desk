import app from 'flarum/admin/app';
import Component from 'flarum/common/Component';
import Button from 'flarum/common/components/Button';
import LoadingIndicator from 'flarum/common/components/LoadingIndicator';
import extractText from 'flarum/common/utils/extractText';
import type Mithril from 'mithril';
import { api, desk, splitKey, t } from './state';
import { groupBadge, labelFor, tagName } from './rows';
import { ReviewModal } from './modals';
import { bundle, tagsDetail, type Line } from './bundle';

export interface HistoryUi {
  items: any[] | null;
  hasMore: boolean;
  loading: boolean;
  version: number;
  q: string;
}

/**
 * Every save as one entry (and changes found made elsewhere), newest first. Undo and Restore
 * fetch a plan from the server, stage it, and open the review: nothing is written without it.
 */
export default class HistoryTab extends Component<{ ui: HistoryUi; onSaved: () => void }> {
  oninit(vnode: Mithril.Vnode<{ ui: HistoryUi; onSaved: () => void }, this>) {
    super.oninit(vnode);
    const ui = this.attrs.ui;
    if (!ui.items || ui.version !== desk.historyVersion) this.load(0);
  }

  load(offset: number) {
    const ui = this.attrs.ui;
    ui.loading = true;
    ui.version = desk.historyVersion;
    // The first page logs any changes made outside Permission Desk first (a POST: it can write).
    (offset ? Promise.resolve(null) : api('POST', '/check'))
      .then(() => api('GET', '/history?offset=' + offset))
      .then((res: any) => {
        ui.items = offset ? [...(ui.items || []), ...res.changesets] : res.changesets;
        ui.hasMore = res.hasMore;
      })
      .finally(() => {
        ui.loading = false;
        m.redraw();
      });
  }

  plan(id: number, which: 'undo' | 'restore') {
    api('POST', `/changesets/${id}/${which}`).then((plan: any) => {
      if (!plan.changes.length) {
        app.alerts.clear();
        app.alerts.show(
          { type: 'error' },
          t(which === 'undo' ? 'history.nothing_to_undo' : 'history.already', { what: (plan.skipped || []).map(labelFor).join(', ') })
        );
        return;
      }
      desk.staged = {};
      plan.changes.forEach((c: any) => {
        desk.setOne(c.permission, c.before);
        desk.stage(c.permission, c.after);
      });
      desk.context = {
        kind: which,
        undoOf: which === 'undo' ? id : undefined,
        note: extractText(t(which === 'undo' ? 'history.undo_note' : 'history.restore_note', { id })),
        skipped: plan.skipped,
      };
      app.modal.show(ReviewModal, { onSaved: this.attrs.onSaved });
    });
  }

  view() {
    const ui = this.attrs.ui;
    if (!ui.items) return <LoadingIndicator />;
    const q = ui.q.trim().toLowerCase();
    const items = q
      ? ui.items.filter(
          (c: any) =>
            c.changes.some((ch: any) => `${labelFor(ch.permission)} ${ch.permission}`.toLowerCase().includes(q)) ||
            (c.note || '').toLowerCase().includes(q)
        )
      : ui.items;

    return (
      <div className="PermissionDesk-history">
        <div className="PermissionDesk-toolbar">
          <input
            className="FormControl PermissionDesk-search"
            type="search"
            value={ui.q}
            placeholder={extractText(t('history.filter'))}
            aria-label={extractText(t('history.filter'))}
            oninput={(e: InputEvent) => (ui.q = (e.target as HTMLInputElement).value)}
          />
        </div>
        <p className="PermissionDesk-note PermissionDesk-note--info">{t('history.help')}</p>
        {items.length ? items.map((c: any, i: number) => this.entry(c, i === 0 && !q)) : <p className="PermissionDesk-empty">{t('history.empty')}</p>}
        {ui.hasMore ? (
          <Button className="Button" loading={ui.loading} onclick={() => this.load(ui.items!.length)}>
            {t('history.more')}
          </Button>
        ) : null}
      </div>
    );
  }

  entry(c: any, newest: boolean) {
    const raw: Line[] = [];
    c.changes.forEach((ch: any) => {
      ch.after.filter((g: number) => !ch.before.includes(g)).forEach((g: number) => raw.push({ key: ch.permission, group: g, op: '+' }));
      ch.before.filter((g: number) => !ch.after.includes(g)).forEach((g: number) => raw.push({ key: ch.permission, group: g, op: '-' }));
    });
    const lines = bundle(raw).map((items) => {
      const l = items[0];
      const s = splitKey(l.key);
      return (
        <li>
          <span className={'PermissionDesk-op PermissionDesk-op--' + (l.op === '+' ? 'add' : 'remove')}>{l.op === '+' ? '+' : '−'}</span>
          {groupBadge(l.group)} <span>{labelFor(l.key)}</span>{' '}
          {items.length > 1 ? (
            tagsDetail(items)
          ) : s.tag ? (
            <span className="PermissionDesk-chip">{t('history.in', { tag: tagName(s.tag) })}</span>
          ) : null}
        </li>
      );
    });

    return (
      <article className={'PermissionDesk-entry' + (c.kind === 'outside' ? ' is-outside' : '') + (c.undoneBy ? ' is-undone' : '')}>
        <header>
          <span className="PermissionDesk-entryWho">{c.actor ? c.actor.displayName : t('history.outside')}</span>
          <time className="PermissionDesk-muted" dateTime={c.createdAt} title={dayjs(c.createdAt).format('LLLL')}>
            {dayjs(c.createdAt).fromNow()}
          </time>
          <span className="PermissionDesk-muted">· {t('history.changes', { count: raw.length })}</span>
          {c.kind !== 'save' ? <span className="PermissionDesk-chip">{t('history.kind_' + c.kind, { id: c.undoOf })}</span> : null}
          {c.undoneBy ? <span className="PermissionDesk-chip">{t('history.undone')}</span> : null}
          <span className="PermissionDesk-entryActions">
            <Button className="Button Button--small" disabled={!!c.undoneBy} onclick={() => this.plan(c.id, 'undo')}>
              {t('history.undo')}
            </Button>
            {newest ? null : (
              <Button className="Button Button--small" onclick={() => this.plan(c.id, 'restore')}>
                {t('history.restore')}
              </Button>
            )}
          </span>
        </header>
        {c.note ? <p className="PermissionDesk-entryNote">“{c.note}”</p> : null}
        {c.kind === 'outside' ? <p className="PermissionDesk-entryNote PermissionDesk-muted">{t('history.outside_help')}</p> : null}
        <ul>{lines}</ul>
      </article>
    );
  }
}
