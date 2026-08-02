import type { Database } from 'bun:sqlite';

import { getNrListData } from '../../db';

import type { NrListMode, NrListTimeSelection } from '../shared/types';

type HandleListCommandParams = {
  db: Database;
  mode: NrListMode;
  timeSelection: NrListTimeSelection;
};

export function handleListCommand(params: HandleListCommandParams) {
  return getNrListData({
    db: params.db,
    mode: params.mode,
    timeSelection: params.timeSelection,
  });
}
