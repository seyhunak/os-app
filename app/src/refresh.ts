import { createContext, useContext } from 'react';

export interface RefreshState {
  /** Goes up when a brief was written outside the screen showing it, such as by a schedule. */
  refreshKey: number;
  /** True while a scheduled brief is being written. */
  writingScheduled: boolean;
}

export const RefreshContext = createContext<RefreshState>({ refreshKey: 0, writingScheduled: false });
export const useRefresh = () => useContext(RefreshContext);
