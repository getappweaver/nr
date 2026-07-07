import type { Database } from 'bun:sqlite';

import { getNrListData } from '../../db';

import type { NrListMode } from '../shared/types';

type HandleListCommandParams = {
  db: Database;
  mode: NrListMode;
};

export function handleListCommand(params: HandleListCommandParams) {
  return getNrListData({ db: params.db, mode: params.mode });
}
