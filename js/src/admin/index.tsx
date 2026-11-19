import app from 'flarum/admin/app';
import { extend } from 'flarum/common/extend';
import ItemList from 'flarum/common/utils/ItemList';
import { EXT, t } from './state';

export { default as extend } from './extend';

app.initializers.add(EXT, () => {
  // Member Desk's member page gets a "Permissions" button, through its heroActions hook.
  if (!('ernestdefoe-member-desk' in flarum.extensions)) return;

  extend('ext:ernestdefoe/member-desk/common/MemberView' as any, 'heroActions', function (this: any, items: ItemList<any>) {
    const id = this.attrs?.id;
    if (!id) return;
    items.add(
      'permissions',
      <a className="Button" href={'#' + app.route('permissionDesk.member', { id })}>
        <i aria-hidden="true" className="icon fas fa-key Button-icon" />
        <span className="Button-label">{t('member_desk_button')}</span>
      </a>,
      -10
    );
  });
});
