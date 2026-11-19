import Extend from 'flarum/common/extenders';
import ClassicPage from './ClassicPage';
import DeskPage from './DeskPage';

export default [
  // Permission Desk takes over core's Permissions page; the classic grid stays one click away.
  new Extend.Routes()
    .add('permissions', '/permissions', DeskPage)
    .add('permissionDesk.classic', '/permissions/classic', ClassicPage)
    .add('permissionDesk.member', '/permissions/desk/member/:id', DeskPage)
    .add('permissionDesk.tab', '/permissions/desk/:tab', DeskPage),
];
