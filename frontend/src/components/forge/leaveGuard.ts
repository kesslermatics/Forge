/**
 * Minimal in-app navigation guard. BrowserRouter has no blocker API, so pages with unsaved
 * changes register a handler here and the app shell asks it before navigating away.
 */
type LeaveHandler = (proceed: () => void) => void;

let handler: LeaveHandler | null = null;

export const setLeaveGuard = (next: LeaveHandler | null) => { handler = next; };

export const hasLeaveGuard = () => handler !== null;

/** Runs ``proceed`` right away, or lets the active page confirm first. Returns true when intercepted. */
export const requestLeave = (proceed: () => void) => {
  if (!handler) { proceed(); return false; }
  handler(proceed);
  return true;
};
