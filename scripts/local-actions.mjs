import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeAccountingAction } from '../shared/accounting-engine.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const actionContractsPath = resolve(projectRoot, 'data', 'action-contracts.json');

export const actionCatalog = JSON.parse(await readFile(actionContractsPath, 'utf8'));

export function executeLocalAction(state, request) {
  return executeAccountingAction(state, request, actionCatalog);
}
