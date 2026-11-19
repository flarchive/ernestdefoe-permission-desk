import Component from 'flarum/common/Component';
import Icon from 'flarum/common/components/Icon';
import extractText from 'flarum/common/utils/extractText';
import type Mithril from 'mithril';
import { t } from './state';
import { tagItems, tagMatches, tagName, type TagItem } from './rows';

export interface TagPickerAttrs {
  value: string;
  onchange: (id: string) => void;
  label: string;
  /** Offer "Everywhere" (the forum-wide permissions) first. */
  global?: boolean;
  /** Only restricted tags (the only ones with their own permissions). */
  restricted?: boolean;
  exclude?: string[];
  /** Text on the button when nothing is picked (value ''). */
  placeholder?: string;
}

const LIMIT = 200;

/**
 * Pick one tag out of hundreds: a button that opens a search box over the tag tree (children
 * under their parent). Type to filter by name or "Parent › Child", arrows + Enter to pick.
 */
export default class TagPicker extends Component<TagPickerAttrs> {
  open = false;
  q = '';
  active = 0;
  focus = false;

  outside = (e: MouseEvent) => {
    if (this.open && !this.element.contains(e.target as Node)) {
      this.open = false;
      m.redraw();
    }
  };

  oncreate(vnode: Mithril.VnodeDOM<TagPickerAttrs, this>) {
    super.oncreate(vnode);
    document.addEventListener('mousedown', this.outside);
  }

  onremove(vnode: Mithril.VnodeDOM<TagPickerAttrs, this>) {
    super.onremove(vnode);
    document.removeEventListener('mousedown', this.outside);
  }

  onupdate(vnode: Mithril.VnodeDOM<TagPickerAttrs, this>) {
    super.onupdate(vnode);
    if (this.focus) {
      this.focus = false;
      (this.element.querySelector('.PermissionDesk-pickerPop input') as HTMLInputElement | null)?.focus();
    }
    if (this.open) this.element.querySelector('.PermissionDesk-pickerPop .is-active')?.scrollIntoView({ block: 'nearest' });
  }

  options(): { id: string; text: string; depth: number; item: TagItem | null }[] {
    const a = this.attrs;
    const q = this.q.trim().toLowerCase();
    const out: { id: string; text: string; depth: number; item: TagItem | null }[] = [];
    if (a.global && (!q || extractText(t('scope.global')).toLowerCase().includes(q)))
      out.push({ id: 'global', text: extractText(t('scope.global')), depth: 0, item: null });
    const restricted = new Set(
      tagItems()
        .filter((i) => i.restricted)
        .map((i) => i.id)
    );
    tagItems().forEach((i) => {
      if (a.restricted && !i.restricted) return;
      if (a.exclude?.includes(i.id)) return;
      if (q && !tagMatches(i.path, q)) return;
      // In the tree view, a child whose parent isn't listed shows its full path instead.
      const parentListed = !!i.parentId && (!a.restricted || restricted.has(i.parentId));
      out.push({ id: i.id, text: q || !parentListed ? i.path : i.name, depth: q || !parentListed ? 0 : i.depth, item: i });
    });
    return out;
  }

  pick(id: string) {
    this.open = false;
    this.q = '';
    this.attrs.onchange(id);
  }

  view() {
    const a = this.attrs;
    const current = a.value === 'global' ? extractText(t('scope.global')) : a.value ? tagName(a.value) : a.placeholder || '';
    const color =
      a.value && a.value !== 'global'
        ? tagItems()
            .find((i) => i.id === a.value)
            ?.tag.attribute('color')
        : null;

    return (
      <div className={'PermissionDesk-picker' + (this.open ? ' is-open' : '')}>
        <button
          type="button"
          className="FormControl PermissionDesk-pickerBtn"
          aria-haspopup="listbox"
          aria-expanded={this.open ? 'true' : 'false'}
          aria-label={`${a.label}: ${current}`}
          onclick={() => {
            this.open = !this.open;
            this.q = '';
            this.active = 0;
            this.focus = this.open;
          }}
        >
          {color ? <span className="PermissionDesk-tagDot" style={{ background: color }} /> : null}
          <span className={'PermissionDesk-pickerText' + (a.value ? '' : ' PermissionDesk-muted')}>{current}</span>
          <Icon name="fas fa-caret-down" />
        </button>
        {this.open ? this.popover() : null}
      </div>
    );
  }

  popover() {
    const all = this.options();
    const list = all.slice(0, LIMIT);
    if (this.active >= list.length) this.active = Math.max(0, list.length - 1);
    return (
      <div className="PermissionDesk-pickerPop">
        <input
          className="FormControl"
          type="search"
          value={this.q}
          placeholder={extractText(t('picker.search'))}
          aria-label={extractText(t('picker.search'))}
          oninput={(e: InputEvent) => {
            this.q = (e.target as HTMLInputElement).value;
            this.active = 0;
          }}
          onkeydown={(e: KeyboardEvent) => this.keydown(e, list)}
        />
        <ul role="listbox" aria-label={this.attrs.label}>
          {list.map((o, i) => this.option(o, i))}
        </ul>
        {!list.length ? <div className="PermissionDesk-muted PermissionDesk-pickerEmpty">{t('picker.none')}</div> : null}
        {all.length > LIMIT ? (
          <div className="PermissionDesk-muted PermissionDesk-pickerEmpty">{t('picker.more', { count: all.length - LIMIT })}</div>
        ) : null}
      </div>
    );
  }

  keydown(e: KeyboardEvent, list: { id: string }[]) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.active = Math.min(this.active + 1, list.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.active = Math.max(this.active - 1, 0);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (list[this.active]) this.pick(list[this.active].id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.open = false;
      (this.element.querySelector('.PermissionDesk-pickerBtn') as HTMLElement | null)?.focus();
    }
  }

  option(o: { id: string; text: string; depth: number; item: TagItem | null }, i: number) {
    const a = this.attrs;
    return (
      <li
        role="option"
        aria-selected={o.id === a.value ? 'true' : 'false'}
        className={(i === this.active ? 'is-active' : '') + (o.id === a.value ? ' is-current' : '')}
        style={{ paddingLeft: 10 + o.depth * 16 + 'px' }}
        onmousedown={(e: MouseEvent) => e.preventDefault()}
        onclick={() => this.pick(o.id)}
      >
        {o.item ? <span className="PermissionDesk-tagDot" style={{ background: o.item.tag.attribute('color') || 'var(--pd-faint)' }} /> : null}
        <span>{o.text}</span>
      </li>
    );
  }
}
