import app from 'flarum/admin/app';
import extractText from 'flarum/common/utils/extractText';
import isExtensionEnabled from 'flarum/admin/utils/isExtensionEnabled';
import Group from 'flarum/common/models/Group';
import sortGroups from 'flarum/common/utils/sortGroups';
import type Mithril from 'mithril';
import { ADMIN, EXT, GUEST, MEMBER, splitKey, t } from './state';

export type Area = 'view' | 'start' | 'reply' | 'moderate';
export const AREAS: Area[] = ['view', 'start', 'reply', 'moderate'];

export interface Row {
  key: string;
  label: Mithril.Children;
  text: string;
  desc: string | null;
  icon: string;
  ext: string;
  extTitle: string;
  area: Area;
  allowGuest: boolean;
  tagScoped: boolean;
  danger: 'red' | 'amber' | null;
}

export interface SettingRow {
  id: string;
  label: Mithril.Children;
  icon: string;
  setting: () => Mithril.Children;
}

/**
 * Risky grants, with the reason shown on the row and in the review. Anything not listed is
 * treated as ordinary; keys of extensions that aren't installed simply never appear.
 */
const DANGER: Record<string, 'red' | 'amber'> = {
  'discussion.delete': 'red',
  'discussion.deletePosts': 'red',
  'user.editCredentials': 'red',
  'user.editGroups': 'red',
  moderateAccessTokens: 'red',
  'discussion.viewIpsPosts': 'amber',
  'user.suspend': 'amber',
  'user.edit': 'amber',
  'ernestdefoe-member-desk.viewEmails': 'amber',
  'ernestdefoe-member-desk.viewIps': 'amber',
  'ernestdefoe-member-desk.markSpammer': 'amber',
  'ernestdefoe-member-desk.export': 'amber',
};

const descKey = (key: string) => `${EXT}.admin.desc.${key.replace(/[^A-Za-z0-9]/g, '_')}`;

function description(key: string): string | null {
  const full = descKey(key);
  return (app.translator as any).translations?.[full] ? extractText(app.translator.trans(full)) : null;
}

function extTitle(ext: string): string {
  if (ext === 'core-permissions') return extractText(t('ext_core'));
  return (app.data.extensions as any)[ext]?.extra?.['flarum-extension']?.title || ext;
}

function tagScopedFor(item: any): boolean {
  const key: string = item.permission;
  return key === 'viewForum' || key === 'startDiscussion' || (key.startsWith('discussion.') && item.tagScoped !== false) || !!item.tagScoped;
}

let cache: { rows: Row[]; settings: SettingRow[] } | null = null;

/**
 * Every permission the admin registry knows, read the way core's grid reads it (each enabled
 * extension's registerPermission calls), tagged with the extension that registered it.
 */
export function collect(): { rows: Row[]; settings: SettingRow[] } {
  if (cache) return cache;
  const data = app.registry.getData() as Record<string, any>;
  const rows: Row[] = [];
  const settings: SettingRow[] = [];
  const seen = new Set<string>();

  // Core first, then extensions in the admin's own order.
  const exts = Object.keys(data).sort((a, b) => (a === 'core-permissions' ? -1 : b === 'core-permissions' ? 1 : 0));

  exts.forEach((ext) => {
    AREAS.forEach((area) => {
      app.registry
        .getExtensionPermissions(ext, area)
        .toArray()
        .forEach((item: any) => {
          if ('setting' in item && item.setting) {
            if (!seen.has('setting:' + item.id)) {
              seen.add('setting:' + item.id);
              settings.push({ id: item.id, label: item.label, icon: item.icon, setting: item.setting });
            }
            return;
          }
          if (!item.permission || seen.has(item.permission)) return;
          seen.add(item.permission);
          rows.push({
            key: item.permission,
            label: item.label,
            text: extractText(item.label),
            desc: description(item.permission),
            icon: item.icon,
            ext,
            extTitle: extTitle(ext),
            area,
            allowGuest: !!item.allowGuest,
            tagScoped: tagScopedFor(item),
            danger: DANGER[item.permission] || null,
          });
        });
    });
  });

  cache = { rows, settings };
  return cache;
}

export function rowFor(key: string): Row | undefined {
  return collect().rows.find((r) => r.key === splitKey(key).key);
}

export function labelFor(key: string): string {
  const row = rowFor(key);
  return row ? row.text : splitKey(key).key;
}

/** Stored in group_permission, but no enabled extension registers it (and not a tag's copy). */
export function orphans(): string[] {
  const known = new Set(collect().rows.map((r) => r.key));
  return Object.keys(app.data.permissions)
    .filter((key) => !known.has(splitKey(key).key))
    .sort();
}

export const tagsOn = () => isExtensionEnabled('flarum-tags');

export interface TagItem {
  tag: any;
  id: string;
  name: string;
  /** "Parent › Child" for a child tag, so a search result is never ambiguous. */
  path: string;
  depth: number;
  parentId: string | null;
  restricted: boolean;
}

let tree: { sig: string; items: TagItem[] } | null = null;

/**
 * Every tag in the forum's own order: primary tags by position with their children under them,
 * then secondary tags by name. Recomputed only when tags are added, removed or (un)restricted.
 */
export function tagItems(): TagItem[] {
  if (!tagsOn()) return [];
  const all = app.store.all<any>('tags');
  const sig = all.map((tag) => tag.id() + (tag.attribute('isRestricted') ? 'r' : 'o')).join();
  if (tree && tree.sig === sig) return tree.items;

  const ids = new Set(all.map((tag) => tag.id()));
  const parentOf = (tag: any): string | null => {
    const p = tag.parent?.();
    return p && ids.has(p.id()) ? p.id() : null;
  };
  const byPos = (a: any, b: any) =>
    (a.attribute('position') ?? 1e9) - (b.attribute('position') ?? 1e9) || String(a.attribute('name')).localeCompare(b.attribute('name'));
  const children = new Map<string, any[]>();
  const roots: any[] = [];
  all.forEach((tag) => {
    const p = parentOf(tag);
    if (p) children.set(p, [...(children.get(p) || []), tag]);
    else roots.push(tag);
  });

  const items: TagItem[] = [];
  const add = (tag: any, depth: number, parent: any | null) => {
    const name = String(tag.attribute('name'));
    items.push({
      tag,
      id: tag.id(),
      name,
      path: parent ? `${parent.attribute('name')} › ${name}` : name,
      depth,
      parentId: parent ? parent.id() : null,
      restricted: !!tag.attribute('isRestricted'),
    });
    (children.get(tag.id()) || []).sort(byPos).forEach((child) => add(child, depth + 1, tag));
  };
  roots.sort(byPos).forEach((tag) => add(tag, 0, null));
  tree = { sig, items };
  return items;
}

/** Every word of the search appears in the tag's "Parent › Child" path ("clubs show" finds "Clubs › Showcase"). */
export function tagMatches(path: string, q: string): boolean {
  const p = path.toLowerCase();
  return q
    .toLowerCase()
    .split(/[\s›>]+/)
    .filter(Boolean)
    .every((w) => p.includes(w));
}

export function restrictedTags(): any[] {
  return tagItems()
    .filter((i) => i.restricted)
    .map((i) => i.tag);
}

/** More restricted tags than fit comfortably on one screen: lists show only what differs. */
export const MANY_TAGS = 8;

export function tagName(id: string | null): string {
  if (!id) return extractText(t('scope.global'));
  return tagItems().find((i) => i.id === id)?.path ?? app.store.getById<any>('tags', id)?.attribute('name') ?? `#${id}`;
}

/** Guests and Members first, then Admins, then everything else in core's order. */
export function groups(): Group[] {
  const all = app.store.all<Group>('groups');
  const special = [GUEST, MEMBER, ADMIN].map((id) => all.find((g) => Number(g.id()) === id)).filter(Boolean) as Group[];
  return special.concat(sortGroups(all.filter((g) => ![GUEST, MEMBER, ADMIN].includes(Number(g.id())))));
}

export function groupName(id: number): string {
  if (id === GUEST) return extractText(app.translator.trans('core.admin.permissions_controls.everyone_button'));
  if (id === MEMBER) return extractText(app.translator.trans('core.admin.permissions_controls.members_button'));
  return app.store.getById<Group>('groups', String(id))?.namePlural() ?? `#${id}`;
}

export function groupColor(id: number): string | null {
  if (id === GUEST || id === MEMBER) return null;
  return app.store.getById<Group>('groups', String(id))?.color() || '#7a8794';
}

export function groupBadge(id: number) {
  const color = groupColor(id);
  return (
    <span className={'PermissionDesk-badge' + (color ? '' : ' PermissionDesk-badge--plain')} style={color ? { '--group-color': color } : undefined}>
      {groupName(id)}
    </span>
  );
}
