import type { HTMLAttributes } from 'react';

export const ICON_CODEPOINTS = {
  account_tree: 'e97a',
  api: 'f1b7',
  auto_awesome: 'e65f',
  auto_fix_high: 'e663',
  bolt: 'ea0b',
  bottom_panel_open: 'f729',
  check_circle: 'f0be',
  chevron_right: 'e5cc',
  close: 'e5cd',
  code: 'e86f',
  compare: 'e3b9',
  construction: 'ea3c',
  content_copy: 'e14d',
  content_paste: 'e14f',
  dark_mode: 'e51c',
  data_object: 'ead3',
  delete_sweep: 'e16c',
  error: 'f8b6',
  chevron_left: 'e5cb',
  expand_more: 'e5cf',
  folder_open: 'e2c8',
  format_align_justify: 'e235',
  help: 'e8fd',
  history: 'e8b3',
  info: 'e88e',
  light_mode: 'e518',
  more_horiz: 'e5d3',
  note_add: 'e89c',
  save: 'e161',
  search: 'ef7a',
  sensors: 'e51e',
  settings: 'e8b8',
  settings_backup_restore: 'e8ba',
  swap_horiz: 'e8d4',
  warning: 'f083',
} as const;

export interface IconProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  name: string;
  size?: number;
}

/** Material Symbols codepoint 图标的统一封装，避免图标字面名进入无障碍树。 */
export function Icon({ name, size = 20, className, style, ...props }: IconProps) {
  const codepoint = Object.prototype.hasOwnProperty.call(ICON_CODEPOINTS, name)
    ? ICON_CODEPOINTS[name as keyof typeof ICON_CODEPOINTS]
    : undefined;
  if (!codepoint && import.meta.env.DEV) {
    console.warn(`[Icon] 未映射的图标: ${name}`);
  }

  return (
    <span
      {...props}
      className={`material-symbols-outlined${className ? ` ${className}` : ''}`}
      aria-hidden="true"
      style={{ fontSize: size, ...style }}
    >
      {codepoint ? String.fromCodePoint(Number.parseInt(codepoint, 16)) : null}
    </span>
  );
}
