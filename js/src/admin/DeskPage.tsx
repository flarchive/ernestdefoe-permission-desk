import app from 'flarum/admin/app';
import AdminPage from 'flarum/admin/components/AdminPage';
import Button from 'flarum/common/components/Button';
import LoadingIndicator from 'flarum/common/components/LoadingIndicator';
import type Mithril from 'mithril';
import { GUEST, MEMBER, api, desk, presetsApi, t } from './state';
import { tagsOn } from './rows';
import GroupsTab, { type GroupsUi } from './GroupsTab';
import PermissionsTab, { type PermissionsUi } from './PermissionsTab';
import MemberTab, { type MemberUi } from './MemberTab';
import HistoryTab, { type HistoryUi } from './HistoryTab';
import TagsTab, { tagsUi } from './TagsTab';
import { ReviewModal } from './modals';

const TABS = ['groups', 'permissions', 'tags', 'member', 'history'] as const;
type Tab = (typeof TABS)[number];

// Kept for the life of the admin page, so switching tabs or pages loses nothing.
const ui = {
  groups: { group: 4, scope: 'global', q: '', by: 'area', compare: false, a: 4, b: MEMBER, onlyDiff: true, cmpOpen: {}, hint: null } as GroupsUi,
  permissions: { q: '', filter: 'all', open: null, extra: [] } as PermissionsUi,
  tags: tagsUi(MEMBER),
  member: { id: null, q: '', results: null, scope: 'global', data: null, loading: false } as MemberUi,
  history: { items: null, hasMore: false, loading: false, version: -1, q: '' } as HistoryUi,
  presets: [] as any[],
  presetsLoaded: false,
};

let tagsReady = false;

/**
 * Permission Desk: takes over the admin Permissions page. Routes: #/permissions (groups),
 * #/permissions/desk/:tab, #/permissions/desk/member/:id; core's grid at #/permissions/classic.
 */
export default class DeskPage extends AdminPage {
  oninit(vnode: Mithril.Vnode<any, this>) {
    super.oninit(vnode);
    if (!app.store.getById('groups', '4')) ui.groups.group = GUEST;
    const memberId = Number(m.route.param('id'));
    if (memberId) ui.member.id = memberId;
    if (tagsOn() && !tagsReady) {
      (app as any).tagList.load(['parent']).then(() => {
        tagsReady = true;
        m.redraw();
      });
    }
    if (!ui.presetsLoaded) this.reloadPresets();
    window.addEventListener('beforeunload', this.beforeUnload);
  }

  onremove(vnode: Mithril.VnodeDOM<any, this>) {
    super.onremove(vnode);
    window.removeEventListener('beforeunload', this.beforeUnload);
  }

  beforeUnload = (e: BeforeUnloadEvent) => {
    if (Object.keys(desk.staged).length) {
      e.preventDefault();
      e.returnValue = '';
    }
  };

  reloadPresets = () => {
    presetsApi.list().then((list) => {
      ui.presets = list;
      ui.presetsLoaded = true;
      m.redraw();
    });
  };

  tab(): Tab {
    if (m.route.param('id')) return 'member';
    const tab = m.route.param('tab') as Tab;
    return TABS.includes(tab) && (tab !== 'tags' || tagsOn()) ? tab : 'groups';
  }

  headerInfo() {
    return {
      className: 'PermissionDeskPage',
      icon: 'fas fa-key',
      title: t('page.title'),
      description: t('page.description'),
    };
  }

  tabs(tab: Tab) {
    const go = (to: Tab) => (to === 'groups' ? '#' + app.route('permissions') : '#' + app.route('permissionDesk.tab', { tab: to }));
    return (
      <div className="PermissionDesk-top">
        <nav className="PermissionDesk-tabs" role="tablist" aria-label={String(t('page.title'))}>
          {TABS.filter((to) => to !== 'tags' || tagsOn()).map((to) => (
            <a role="tab" aria-selected={tab === to ? 'true' : 'false'} className={'PermissionDesk-tab' + (tab === to ? ' is-on' : '')} href={go(to)}>
              {t('tab.' + to)}
            </a>
          ))}
        </nav>
        <a className="Button Button--small PermissionDesk-classic" href={'#' + app.route('permissionDesk.classic')} title={String(t('classic_help'))}>
          {t('classic')}
        </a>
      </div>
    );
  }

  content(): Mithril.Children {
    if (tagsOn() && !tagsReady) return <LoadingIndicator />;
    const tab = this.tab();
    const n = desk.diff().length;
    return (
      <div className="PermissionDesk">
        {this.tabs(tab)}

        {tab === 'groups' ? (
          <GroupsTab
            ui={ui.groups}
            presets={() => ui.presets}
            reloadPresets={this.reloadPresets}
            openTags={(group: number) => this.openTags(group)}
          />
        ) : null}
        {tab === 'tags' ? <TagsTab ui={ui.tags} openTag={(id: string, group: number) => this.openTag(id, group)} /> : null}
        {tab === 'permissions' ? <PermissionsTab ui={ui.permissions} /> : null}
        {tab === 'member' ? <MemberTab ui={ui.member} /> : null}
        {tab === 'history' ? <HistoryTab ui={ui.history} onSaved={() => this.saved()} /> : null}

        {n ? (
          <div className="PermissionDesk-savebar" role="status">
            <b>{t('savebar.count', { count: n })}</b>
            <Button
              className="Button"
              onclick={() => {
                desk.discard();
                ui.groups.hint = null;
              }}
            >
              {t('savebar.discard')}
            </Button>
            <Button
              className="Button Button--primary"
              onclick={() => {
                app.alerts.clear();
                app.modal.show(ReviewModal, { onSaved: () => this.saved() });
              }}
            >
              {t('savebar.review')}
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  /** From the Tags tab: one tag's full list of permissions for that group, on the Groups tab. */
  openTag(id: string, group: number) {
    Object.assign(ui.groups, { group, scope: id, q: '', compare: false, hint: null });
    m.route.set(app.route('permissions'));
    window.scrollTo(0, 0);
  }

  openTags(group: number) {
    ui.tags.group = group;
    m.route.set(app.route('permissionDesk.tab', { tab: 'tags' }));
    window.scrollTo(0, 0);
  }

  saved() {
    ui.groups.hint = null;
    if (ui.member.id) {
      const id = ui.member.id;
      api('GET', '/members/' + id).then((data) => {
        ui.member.data = data;
        m.redraw();
      });
    }
    if (this.tab() === 'history') {
      ui.history.version = -1;
      api('GET', '/history?offset=0').then((res: any) => {
        ui.history.items = res.changesets;
        ui.history.hasMore = res.hasMore;
        ui.history.version = desk.historyVersion;
        m.redraw();
      });
    }
  }
}
