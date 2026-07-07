import { formatNrListData } from '../../../format';

import type { NrListData } from '../../shared/types';

type RenderNrListTextProps = {
  listData: NrListData;
};

export function renderNrListText({ listData }: RenderNrListTextProps): string {
  return formatNrListData(listData);
}
