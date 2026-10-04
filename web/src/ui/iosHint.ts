// One-time "Add to Home Screen" hint for iOS Safari.
//
// The banner is only offered on iOS Safari when the app is not already running
// in standalone (installed) mode, and once dismissed it stays dismissed via
// the storage facade. Detection is split into a pure predicate so it can be
// unit-tested without a browser.

import type { AppStorage } from '../storage';

/** The browser facts the iOS hint decision depends on. */
export type IosHintEnvironment = {
  userAgent: string;
  maxTouchPoints: number;
  standalone: boolean;
  displayModeStandalone: boolean;
};

type IosNavigator = Navigator & { standalone?: boolean };

/**
 * True only on iOS Safari outside standalone mode. iPadOS 13+ Safari reports a
 * desktop "Macintosh" user agent, so touch capability is used as a fallback.
 * Chrome/Firefox/Edge/Opera on iOS embed their own tokens and are excluded.
 */
export function shouldShowIosHint(env: IosHintEnvironment): boolean {
  if (env.standalone || env.displayModeStandalone) {
    return false;
  }
  const isIosDevice = /iPad|iPhone|iPod/.test(env.userAgent);
  const isIpadDesktopMode = /Macintosh/.test(env.userAgent) && env.maxTouchPoints > 1;
  if (!isIosDevice && !isIpadDesktopMode) {
    return false;
  }
  return !/CriOS|FxiOS|EdgiOS|OPiOS|OPR\/|mercury/i.test(env.userAgent);
}

/** Reads the current environment, tolerating missing browser globals. */
export function readIosHintEnvironment(): IosHintEnvironment {
  const nav = globalThis.navigator as IosNavigator | undefined;
  return {
    userAgent: nav?.userAgent ?? '',
    maxTouchPoints: nav?.maxTouchPoints ?? 0,
    standalone: nav?.standalone === true,
    displayModeStandalone:
      typeof globalThis.matchMedia === 'function' &&
      globalThis.matchMedia('(display-mode: standalone)').matches,
  };
}

export type IosHintDeps = {
  storage: Pick<AppStorage, 'isIosHintDismissed' | 'dismissIosHint'>;
  document?: Document;
  environment?: IosHintEnvironment;
};

export type IosHintController = {
  /** Appends the banner when it applies and was not dismissed yet. */
  maybeShow(): void;
  /** Removes the banner if it is currently mounted. */
  destroy(): void;
};

const HINT_TEXT =
  'Zum Home-Bildschirm hinzufügen: auf Teilen tippen und „Zum Home-Bildschirm" wählen.';

/** Builds the dismissible iOS hint banner controller. */
export function createIosHint(deps: IosHintDeps): IosHintController {
  const doc = deps.document ?? globalThis.document;
  let banner: HTMLElement | null = null;

  function dismiss(): void {
    deps.storage.dismissIosHint();
    banner?.remove();
    banner = null;
  }

  return {
    maybeShow(): void {
      if (banner !== null || deps.storage.isIosHintDismissed()) {
        return;
      }
      const env = deps.environment ?? readIosHintEnvironment();
      if (!shouldShowIosHint(env)) {
        return;
      }

      const node = doc.createElement('div');
      node.className = 'ios-hint';
      node.setAttribute('role', 'status');
      node.dataset.iosHint = '';

      const text = doc.createElement('p');
      text.className = 'ios-hint__text';
      text.textContent = HINT_TEXT;

      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'button ios-hint__dismiss';
      button.textContent = 'Verstanden';
      button.dataset.action = 'dismiss-ios-hint';
      button.addEventListener('click', dismiss);

      node.append(text, button);
      doc.body.append(node);
      banner = node;
    },

    destroy(): void {
      banner?.remove();
      banner = null;
    },
  };
}
