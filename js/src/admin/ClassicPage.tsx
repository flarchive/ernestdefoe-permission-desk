import app from 'flarum/admin/app';
import PermissionsPage from 'flarum/admin/components/PermissionsPage';
import { t } from './state';

/** Core's grid, unchanged, one click away; with a way back. */
export default class ClassicPage extends PermissionsPage {
  content() {
    return (
      <div>
        <p className="PermissionDesk-classicBack">
          <a className="Button" href={'#' + app.route('permissions')}>
            {t('back_to_desk')}
          </a>
        </p>
        {super.content()}
      </div>
    );
  }
}
