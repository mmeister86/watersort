// Family-code screen controller.
//
// Owns the login form: submits the code, distinguishes a rejected code (401,
// inline "Falscher Code") from an unreachable server (offer offline play), and
// reveals the offline escape hatch when the app boots without a reachable API.

import { ApiError, setSession as defaultSetSession } from '../api';
import type { ScreenManager } from './screens';

/** Identifies the code form and its message slots in the DOM. */
const SELECTORS = {
  form: '[data-form="code"]',
  input: '[data-input="code"]',
  error: '[data-error="code"]',
  notice: '[data-notice="code"]',
  offline: '[data-action="offline"]',
} as const;

export type CodeScreenDeps = {
  screens: ScreenManager;
  /** Exchanges the code for a session; injectable for tests. */
  login?: (code: string) => Promise<void>;
  /** Called after a successful login. */
  onAuthenticated: () => void | Promise<void>;
  /** Called when the player chooses to continue without a session. */
  onOffline: () => void;
};

export type CodeController = {
  /** Fills the message slots and shows the screen. */
  open(): void;
  /** Reveals the network notice and the offline button. */
  showOffline(message?: string): void;
};

function requireElement<T extends Element>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (found === null) {
    throw new Error(`Code screen is missing ${selector}`);
  }
  return found;
}

/** Builds the code-screen controller and wires the form immediately. */
export function createCodeController(deps: CodeScreenDeps): CodeController {
  const { screens, onAuthenticated, onOffline } = deps;
  const login = deps.login ?? defaultSetSession;
  const screen = screens.screens.code;

  const form = requireElement<HTMLFormElement>(screen, SELECTORS.form);
  const input = requireElement<HTMLInputElement>(screen, SELECTORS.input);
  const error = requireElement<HTMLElement>(screen, SELECTORS.error);
  const notice = requireElement<HTMLElement>(screen, SELECTORS.notice);
  const offline = requireElement<HTMLButtonElement>(screen, SELECTORS.offline);

  let submitting = false;

  function setMessage(kind: 'error' | 'notice', message: string): void {
    if (kind === 'error') {
      error.textContent = message;
      error.hidden = false;
      notice.hidden = true;
    } else {
      notice.textContent = message;
      notice.hidden = false;
      error.hidden = true;
    }
  }

  function clearMessages(): void {
    error.hidden = true;
    notice.hidden = true;
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (submitting) return;

    const code = input.value;
    submitting = true;
    clearMessages();
    offline.hidden = true;

    void login(code)
      .then(() => {
        submitting = false;
        input.value = '';
        void onAuthenticated();
      })
      .catch((thrown: unknown) => {
        submitting = false;
        if (thrown instanceof ApiError && thrown.status === 401) {
          setMessage('error', 'Falscher Code');
          return;
        }
        setMessage('notice', 'Server nicht erreichbar.');
        offline.hidden = false;
      });
  });

  offline.addEventListener('click', () => {
    onOffline();
  });

  function open(): void {
    clearMessages();
    offline.hidden = true;
    screens.show('code');
    input.focus();
  }

  function showOffline(message = 'Server nicht erreichbar.'): void {
    setMessage('notice', message);
    offline.hidden = false;
  }

  return { open, showOffline };
}
