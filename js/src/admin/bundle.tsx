import { splitKey, t } from './state';
import { tagName } from './rows';

export interface Line {
  key: string;
  group: number;
  op: '+' | '-';
}

/**
 * The same change for the same group in several tags (a bulk change across 80 tags) becomes one
 * line, so a review or a History entry stays readable. Fewer than `min` stay as single lines.
 */
export function bundle<T extends Line>(lines: T[], min = 3): T[][] {
  const out: T[][] = [];
  const by = new Map<string, T[]>();
  lines.forEach((l) => {
    const s = splitKey(l.key);
    if (!s.tag) {
      out.push([l]);
      return;
    }
    const id = `${l.group}|${l.op}|${s.key}`;
    const list = by.get(id);
    if (list) list.push(l);
    else {
      const next = [l];
      by.set(id, next);
      out.push(next);
    }
  });
  return out.flatMap((b) => (b.length >= min ? [b] : b.map((l) => [l])));
}

/** "in 80 tags", opening out to their names. */
export function tagsDetail(items: Line[]) {
  const names = items.map((l) => tagName(splitKey(l.key).tag));
  return (
    <details className="PermissionDesk-inTags">
      <summary className="PermissionDesk-chip">{t('review.in_tags', { count: items.length })}</summary>
      <span className="PermissionDesk-muted">{names.join(', ')}</span>
    </details>
  );
}
