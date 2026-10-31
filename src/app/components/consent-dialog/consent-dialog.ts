/**
 * <consent-dialog>: asks before anything leaves the app (NFR-PRIV-003, ADR
 * 0016). It shows who is called, what for, and the request body exactly as it
 * will be sent. One for the whole app, appended to the page on first use.
 */
import { BaseComponent, define } from '../../core/base-component.ts';
import type { Consent, PendingCall } from '../../../assistant/egress.ts';
import { el } from '../../ui.ts';
import style from './consent-dialog.css?raw';

export class ConsentDialog extends BaseComponent {
  private dialog!: HTMLDialogElement;

  constructor() {
    super('', style);
  }

  override init(): void {
    if (this.dialog) return;
    this.dialog = el('dialog', { class: 'consent', 'aria-label': 'Send this?' });
    this.append(this.dialog);
  }

  ask(call: PendingCall, withKey: boolean): Promise<Consent> {
    return new Promise((resolve) => {
      const d = this.dialog;
      let done = false;
      const answer = (a: Consent) => {
        if (done) return;
        done = true;
        if (d.open) d.close();
        resolve(a);
      };
      const send = el('button', { type: 'button', class: 'primary', text: 'Send' });
      const always = el('button', { type: 'button', text: 'Send without asking until I reload' });
      const cancel = el('button', { type: 'button', text: 'Don’t send' });
      send.onclick = () => answer('send');
      always.onclick = () => answer('send-always');
      cancel.onclick = () => answer('cancel');
      d.oncancel = () => answer('cancel');
      d.replaceChildren(
        el('h2', { text: 'Send this?' }),
        el('p', { class: 'purpose', text: call.purpose }),
        el('p', {
          class: 'hint',
          text: `To ${call.url}. This is exactly what is sent${withKey ? ', with your key in a header' : ''}.`,
        }),
        el('pre', { class: 'payload', tabindex: '0', text: call.body }),
        el('div', { class: 'actions' }, send, always, cancel)
      );
      d.showModal();
      send.focus();
    });
  }
}

define('consent-dialog', ConsentDialog);

/** The app's consent dialog, added to the page the first time it is needed. */
export function consentDialog(): ConsentDialog {
  let d = document.querySelector<ConsentDialog>('consent-dialog');
  if (!d) {
    d = document.createElement('consent-dialog') as ConsentDialog;
    document.body.append(d);
  }
  return d;
}
