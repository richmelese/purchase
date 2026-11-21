'use client';

import { Badge } from './ui';

/**
 * <Badge> for an English enum value (payment type, report status, WH status…).
 * Badge itself picks the colour from the English value and shows it in the chosen language,
 * so always pass the untranslated value here.
 */
export default function TBadge({ value, tone }: { value: string | null | undefined; tone?: string }) {
  return <Badge tone={tone}>{String(value ?? '')}</Badge>;
}
