import seedData from '../data/local-db.seed.json';
import type { AppState } from './types';

export const initialState = seedData as AppState;
