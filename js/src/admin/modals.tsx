import app from 'flarum/admin/app';
import FormModal, { type IFormModalAttrs } from 'flarum/common/components/FormModal';
import Button from 'flarum/common/components/Button';
import Icon from 'flarum/common/components/Icon';
import extractText from 'flarum/common/utils/extractText';
import type Mithril from 'mithril';
import { ADMIN, GUEST, MEMBER, allowed, api, desk, presetsApi, required, scoped, splitKey, t } from './state';
import { collect, groupBadge, groupName, labelFor, restrictedTags, rowFor, tagName } from './rows';
import { bundle, tagsDetail } from './bundle';

type Flag = ['red' | 'amber', Mithril.Children];

/** Why a staged grant or revoke is risky (shown on the review, red ones need a tick). */
export function flagsFor(d: { key: string; group: number; op: '+' | '-' }): Flag[] {
  const row = rowFor(d.key);
  const out: Flag[] = [];
  const { key } = splitKey(d.key);
  if (d.op === '+') {
    if (d.group === GUEST && row && row.area !== 'view') out.push(['red', t('flag.guests')]);
    if (d.group === MEMBER && row && row.area === 'moderate') out.push(['amber', t('flag.members')]);
    if (row?.danger) out.push([row.danger, t('flag.' + (row.danger === 'red' ? 'risky' : 'sensitive'), { what: row.desc || row.text })]);
  } else {
    if (d.group === GUEST && key === 'viewForum' && !splitKey(d.key).tag) out.push(['red', t('flag.members_only')]);
    if (row?.area === 'moderate' && desk.cur(d.key).length === 0 && desk.base(d.key).length) out.push(['amber', t('flag.admins_only')]);
  }
  return out;
}

export interface ReviewAttrs extends IFormModalAttrs {
  onSaved: () => void;
}

/**
 * The review before anything is written: every grant and revoke, grouped by group, with its
 * scope, what it still needs, and danger flags. Saved in one go through the server, which writes
 * each permission with core's own handler in one transaction and refuses (409) if anything
 * changed since this page loaded.
 */
export class ReviewModal extends FormModal<ReviewAttrs> {
  note = '';
  ack = false;
  error: Mithril.Children = null;

  oninit(vnode: Mithril.Vnode<ReviewAttrs, this>) {
    super.oninit(vnode);
    this.note = desk.context.note || '';
  }

  className() {
    return 'PermissionDeskModal PermissionDeskModal--review Modal--medium';
  }

  title() {
    return t('review.title', { count: desk.diff().length });
  }

  content() {
    const diff = desk.diff();
    const byGroup = new Map<number, typeof diff>();
    diff.forEach((d) => byGroup.set(d.group, [...(byGroup.get(d.group) || []), d]));
    const red = diff.some((d) => flagsFor(d).some((f) => f[0] === 'red'));
    const ctx = desk.context;
    return (
      <div className="Modal-body">
        {ctx.skipped?.length ? (
          <p className="PermissionDesk-note PermissionDesk-note--warn">{t('review.skipped', { what: ctx.skipped.map(labelFor).join(', ') })}</p>
        ) : null}
        {this.error ? <p className="PermissionDesk-note PermissionDesk-note--red">{this.error}</p> : null}
        {[...byGroup.keys()].sort((a, b) => a - b).map((group) => this.groupList(group, byGroup.get(group)!))}
        <div className="Form-group">
          <label for="pd-note">{t('review.note')}</label>
          <input
            id="pd-note"
            className="FormControl"
            maxlength={200}
            value={this.note}
            placeholder={extractText(t('review.note_placeholder'))}
            oninput={(e: InputEvent) => {
              this.note = (e.target as HTMLInputElement).value;
            }}
          />
        </div>
        {red ? this.ackBox() : null}
        <div className="PermissionDesk-modalActions">
          <span className="PermissionDesk-muted">{t('review.via_core')}</span>
          <Button className="Button" onclick={() => this.hide()}>
            {t('review.keep_editing')}
          </Button>
          <Button className="Button Button--primary" type="submit" loading={this.loading} disabled={!diff.length || (red && !this.ack)}>
            {t('review.save', { count: diff.length })}
          </Button>
        </div>
      </div>
    );
  }

  groupList(group: number, items: ReturnType<typeof desk.diff>) {
    return (
      <div className="PermissionDesk-reviewGroup">
        <div className="PermissionDesk-reviewHead">
          {groupBadge(group)} <span className="PermissionDesk-muted">{t('review.count', { count: items.length })}</span>
        </div>
        <ul>{bundle(items).map((line) => this.line(group, line))}</ul>
      </div>
    );
  }

  /** One change, or the same change across several tags ("in 6 tags"). */
  line(group: number, items: ReturnType<typeof desk.diff>) {
    const d = items[0];
    const seen = new Set<string>();
    const flags = items.flatMap(flagsFor).filter((f) => {
      const id = f[0] + extractText(f[1]);
      return seen.has(id) ? false : (seen.add(id), true);
    });
    const missing = [
      ...new Set(
        items.flatMap((x) =>
          x.op === '+'
            ? required(x.key)
                .filter((r) => !allowed(group, r))
                .map((r) => labelFor(r))
            : []
        )
      ),
    ];
    return (
      <li>
        <span className={'PermissionDesk-op PermissionDesk-op--' + (d.op === '+' ? 'add' : 'remove')}>{d.op === '+' ? '+' : '−'}</span>
        <span>{t(d.op === '+' ? 'review.can' : 'review.cannot', { what: <b>{labelFor(d.key)}</b> })}</span>
        {items.length > 1 ? tagsDetail(items) : <span className="PermissionDesk-chip">{tagName(splitKey(d.key).tag)}</span>}
        {flags.map((f) => (
          <span className={'PermissionDesk-flag PermissionDesk-flag--' + f[0]}>
            <Icon name="fas fa-triangle-exclamation" /> {f[1]}
          </span>
        ))}
        {missing.length ? <span className="PermissionDesk-why">{t('review.needs', { what: missing.join(', ') })}</span> : null}
      </li>
    );
  }

  ackBox() {
    return (
      <label className="PermissionDesk-ack">
        <input
          type="checkbox"
          checked={this.ack}
          onchange={(e: Event) => {
            this.ack = (e.target as HTMLInputElement).checked;
          }}
        />
        <span>
          <b>{t('review.ack')}</b> <span className="PermissionDesk-muted">{t('review.ack_help')}</span>
        </span>
      </label>
    );
  }

  onsubmit(e: SubmitEvent) {
    e.preventDefault();
    const keys = Object.keys(desk.staged);
    if (!keys.length) return;
    this.loading = true;
    this.error = null;
    const ctx = desk.context;
    api(
      'POST',
      '/changesets',
      {
        changes: keys.map((key) => ({ permission: key, before: desk.base(key), after: desk.staged[key] })),
        note: this.note,
        kind: ctx.kind,
        undoOf: ctx.undoOf,
      },
      true
    )
      .then((res: any) => {
        const n = desk.diff().length;
        desk.staged = {};
        desk.context = { kind: 'save' };
        desk.setMap(res.map);
        desk.historyVersion++;
        this.hide();
        this.attrs.onSaved();
        app.alerts.clear();
        app.alerts.show({ type: 'success' }, t('review.saved', { count: n }));
      })
      .catch((err: any) => {
        const conflicts = err?.response?.conflicts;
        if (err?.status === 409 && conflicts) {
          Object.keys(conflicts).forEach((key) => desk.setOne(key, conflicts[key]));
          Object.keys(desk.staged).forEach((key) => desk.stage(key, desk.staged[key]));
          this.error = t('review.conflict', { what: Object.keys(conflicts).map(labelFor).join(', ') });
        } else {
          this.error = err?.response?.errors?.[0]?.detail || extractText(t('error'));
        }
      })
      .finally(() => {
        this.loading = false;
        m.redraw();
      });
  }
}

export interface CopyAttrs extends IFormModalAttrs {
  to: number;
  groupIds: number[];
}

/** Copy one group's permissions to another: replace, or only add. Stages; the review saves. */
export class CopyModal extends FormModal<CopyAttrs> {
  from = 0;
  to = 0;
  mode: 'replace' | 'add' = 'replace';
  tags = true;

  oninit(vnode: Mithril.Vnode<CopyAttrs, this>) {
    super.oninit(vnode);
    this.to = this.attrs.to;
    this.from = this.attrs.groupIds.find((id) => id !== this.to && id !== GUEST) ?? MEMBER;
  }

  className() {
    return 'PermissionDeskModal Modal--small';
  }

  title() {
    return t('copy.title');
  }

  plan(): { key: string; ids: number[] }[] {
    const scopes = ['global', ...(this.tags ? restrictedTags().map((tag) => tag.id()) : [])];
    const out: { key: string; ids: number[] }[] = [];
    scopes.forEach((scope) =>
      collect()
        .rows.filter((r) => scope === 'global' || r.tagScoped)
        .forEach((r) => {
          if (this.to === GUEST && !r.allowGuest) return;
          const key = scoped(r.key, scope);
          const set = desk.cur(key);
          const fromHas = set.includes(this.from);
          const toHas = set.includes(this.to);
          if (fromHas && !toHas) out.push({ key, ids: [...set, this.to] });
          if (!fromHas && toHas && this.mode === 'replace') out.push({ key, ids: set.filter((g) => g !== this.to) });
        })
    );
    return out;
  }

  content() {
    const ids = this.attrs.groupIds.filter((id) => id !== ADMIN);
    const select = (value: number, set: (v: number) => void, exclude: number) => (
      <select className="FormControl" value={String(value)} onchange={(e: Event) => set(Number((e.target as HTMLSelectElement).value))}>
        {ids
          .filter((id) => id !== exclude)
          .map((id) => (
            <option value={String(id)}>{groupName(id)}</option>
          ))}
      </select>
    );
    const n = this.plan().length;
    return (
      <div className="Modal-body">
        <div className="PermissionDesk-copyPick">
          <label>
            {t('copy.from')} {select(this.from, (v) => (this.from = v), this.to)}
          </label>
          <label>
            {t('copy.to')} {select(this.to, (v) => (this.to = v), this.from)}
          </label>
        </div>
        {(['replace', 'add'] as const).map((mode) => (
          <label className={'PermissionDesk-option' + (this.mode === mode ? ' is-on' : '')}>
            <input type="radio" name="pd-copy-mode" checked={this.mode === mode} onchange={() => (this.mode = mode)} />
            <span>
              <b>{t('copy.' + mode)}</b>
              <span className="PermissionDesk-muted">{t('copy.' + mode + '_help', { from: groupName(this.from), to: groupName(this.to) })}</span>
            </span>
          </label>
        ))}
        {restrictedTags().length ? (
          <label className="PermissionDesk-check">
            <input type="checkbox" checked={this.tags} onchange={(e: Event) => (this.tags = (e.target as HTMLInputElement).checked)} />{' '}
            {t('copy.tags', { count: restrictedTags().length })}
          </label>
        ) : null}
        <p className="PermissionDesk-note PermissionDesk-note--info">{t('copy.count', { count: n })}</p>
        <div className="PermissionDesk-modalActions">
          <Button className="Button" onclick={() => this.hide()}>
            {t('cancel')}
          </Button>
          <Button className="Button Button--primary" type="submit" disabled={!n}>
            {t('stage', { count: n })}
          </Button>
        </div>
      </div>
    );
  }

  onsubmit(e: SubmitEvent) {
    e.preventDefault();
    const n = this.plan().length;
    this.plan().forEach((p) => desk.stage(p.key, p.ids));
    this.hide();
    app.alerts.clear();
    app.alerts.show({ type: 'success' }, t('staged', { count: n }));
  }
}

export interface Preset {
  id: string;
  name: Mithril.Children;
  desc: Mithril.Children;
  keys: string[];
  own?: number;
}

const BASIC = ['viewForum', 'searchUsers'];
const MEMBER_KEYS = [
  ...BASIC,
  'startDiscussion',
  'discussion.reply',
  'discussion.likePosts',
  'discussion.flagPosts',
  'discussion.votePolls',
  'discussion.polls.vote',
  'user.editAvatar',
];
const TRUSTED_KEYS = [
  ...MEMBER_KEYS,
  'postWithoutThrottle',
  'discussion.startPolls',
  'discussion.polls.start',
  'fof-upload.upload',
  'createAccessToken',
];
const MOD_KEYS = [
  ...MEMBER_KEYS,
  'viewHiddenGroups',
  'user.viewLastSeenAt',
  'discussion.viewFlags',
  'discussion.rename',
  'discussion.tag',
  'discussion.lock',
  'discussion.sticky',
  'discussion.hide',
  'discussion.editPosts',
  'discussion.hidePosts',
  'discussion.viewIpsPosts',
  'discussion.approvePosts',
  'postWithoutThrottle',
  'user.suspend',
  'user.edit',
  'ernestdefoe-member-desk.view',
];

export function builtInPresets(): Preset[] {
  return [
    { id: 'readonly', name: t('preset.readonly'), desc: t('preset.readonly_help'), keys: BASIC },
    { id: 'member', name: t('preset.member'), desc: t('preset.member_help'), keys: MEMBER_KEYS },
    { id: 'trusted', name: t('preset.trusted'), desc: t('preset.trusted_help'), keys: TRUSTED_KEYS },
    { id: 'mod', name: t('preset.mod'), desc: t('preset.mod_help'), keys: MOD_KEYS },
    // Moderation that tags can scope: applied in every restricted tag, nothing global.
    { id: 'tagmod', name: t('preset.tagmod'), desc: t('preset.tagmod_help'), keys: [] },
  ];
}

export interface PresetAttrs extends IFormModalAttrs {
  group: number;
  saved: { id: number; name: string; permissions: string[] }[];
  onChange: () => void;
}

/** Apply a preset to a group (global permissions only; tags untouched except Tag moderator). */
export class PresetModal extends FormModal<PresetAttrs> {
  pick = 'trusted';
  saveName = '';
  saving = false;

  className() {
    return 'PermissionDeskModal Modal--small';
  }

  title() {
    return t('preset.title', { group: groupName(this.attrs.group) });
  }

  presets(): Preset[] {
    return [
      ...builtInPresets(),
      ...this.attrs.saved.map((p) => ({
        id: 'own' + p.id,
        name: p.name,
        desc: t('preset.own_help', { count: p.permissions.length }),
        keys: p.permissions,
        own: p.id,
      })),
    ];
  }

  plan(): { key: string; ids: number[] }[] {
    const preset = this.presets().find((p) => p.id === this.pick);
    if (!preset) return [];
    const g = this.attrs.group;
    const out: { key: string; ids: number[] }[] = [];
    const rows = collect().rows;
    if (preset.id === 'tagmod') {
      restrictedTags().forEach((tag) =>
        rows
          .filter((r) => r.tagScoped && r.area === 'moderate' && !r.danger)
          .forEach((r) => {
            const key = scoped(r.key, tag.id());
            const set = desk.cur(key);
            if (!set.includes(g)) out.push({ key, ids: [...set, g] });
          })
      );
      return out;
    }
    rows.forEach((r) => {
      if (g === GUEST && !r.allowGuest) return;
      const set = desk.cur(r.key);
      const want = preset.keys.includes(r.key);
      if (want && !set.includes(g)) out.push({ key: r.key, ids: [...set, g] });
      if (!want && set.includes(g)) out.push({ key: r.key, ids: set.filter((x) => x !== g) });
    });
    return out;
  }

  content() {
    const plan = this.plan();
    const add = plan.filter((p) => p.ids.includes(this.attrs.group)).length;
    return (
      <div className="Modal-body">
        {this.presets().map((p) => this.option(p))}
        <p className="PermissionDesk-note PermissionDesk-note--info">{t('preset.count', { add, remove: plan.length - add })}</p>
        {this.saveRow()}
        <div className="PermissionDesk-modalActions">
          <Button className="Button" onclick={() => this.hide()}>
            {t('cancel')}
          </Button>
          <Button className="Button Button--primary" type="submit" disabled={!plan.length}>
            {t('stage', { count: plan.length })}
          </Button>
        </div>
      </div>
    );
  }

  option(p: Preset) {
    return (
      <label className={'PermissionDesk-option' + (this.pick === p.id ? ' is-on' : '')}>
        <input type="radio" name="pd-preset" checked={this.pick === p.id} onchange={() => (this.pick = p.id)} />
        <span>
          <b>{p.name}</b>
          <span className="PermissionDesk-muted">{p.desc}</span>
        </span>
        {p.own ? (
          <Button
            className="Button Button--icon Button--link"
            icon="far fa-trash-can"
            aria-label={extractText(t('preset.delete'))}
            onclick={(e: MouseEvent) => {
              e.preventDefault();
              presetsApi.remove(p.own!).then(() => this.attrs.onChange());
              this.attrs.saved = this.attrs.saved.filter((s) => s.id !== p.own);
              this.pick = 'trusted';
            }}
          />
        ) : null}
      </label>
    );
  }

  saveRow() {
    return (
      <div className="PermissionDesk-savePreset">
        <input
          className="FormControl"
          maxlength={100}
          value={this.saveName}
          placeholder={extractText(t('preset.save_placeholder', { group: groupName(this.attrs.group) }))}
          aria-label={extractText(t('preset.save_label'))}
          oninput={(e: InputEvent) => {
            this.saveName = (e.target as HTMLInputElement).value;
          }}
        />
        <Button className="Button" loading={this.saving} disabled={!this.saveName.trim()} onclick={() => this.saveAsPreset()}>
          {t('preset.save', { group: groupName(this.attrs.group) })}
        </Button>
      </div>
    );
  }

  saveAsPreset() {
    const g = this.attrs.group;
    const keys = collect()
      .rows.filter((r) => desk.cur(r.key).includes(g))
      .map((r) => r.key);
    this.saving = true;
    presetsApi
      .create(this.saveName.trim(), keys)
      .then((p) => {
        this.attrs.saved = [...this.attrs.saved, p];
        this.pick = 'own' + p.id;
        this.saveName = '';
        this.attrs.onChange();
      })
      .finally(() => {
        this.saving = false;
        m.redraw();
      });
  }

  onsubmit(e: SubmitEvent) {
    e.preventDefault();
    const plan = this.plan();
    plan.forEach((p) => desk.stage(p.key, p.ids));
    this.hide();
    app.alerts.clear();
    app.alerts.show({ type: 'success' }, t('staged', { count: plan.length }));
  }
}
