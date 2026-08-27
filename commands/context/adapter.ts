import { buildNrPluginContextText } from '../../context';
import type { NrCommandAdapterParams } from '../../types/adapter-params';

export function adaptContextCommand(params: NrCommandAdapterParams): string {
  void params.command;
  void params.source;
  void params.identity;
  void params.agent;
  void params.storedCtx;

  return buildNrPluginContextText(params.db);
}
