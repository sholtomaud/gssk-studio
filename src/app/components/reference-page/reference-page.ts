/**
 * <reference-page>: the Odum reference (src/assistant/odum.ts), the same
 * entries the assistant reads with its odum_reference tool, so people can
 * learn the language, and check what the assistant relies on.
 */
import { BaseComponent, define } from '../../core/base-component.ts';
import { REFERENCE, SOURCES, type ReferenceEntry } from '../../../assistant/odum.ts';
import { renderMarkdown } from '../../markdown.ts';
import { symbolIcon } from '../../symbol-icon.ts';
import { el } from '../../ui.ts';
import style from './reference-page.css?raw';

const SECTIONS: { kind: ReferenceEntry['kind']; title: string }[] = [
  { kind: 'symbol', title: 'Symbols' },
  { kind: 'convention', title: 'Conventions' },
  { kind: 'method', title: 'Building a model' },
];

export class ReferencePage extends BaseComponent {
  constructor() {
    super('', style);
  }

  override init(): void {
    if (this.querySelector('.screen')) return;
    // In-page links scroll to their entry without a navigation, which would re-render the screen.
    this.addEventListener('click', (e) => {
      const a = (e.target as Element).closest<HTMLAnchorElement>('a[href^="#"]');
      if (!a) return;
      e.preventDefault();
      this.querySelector(`[id="${CSS.escape(a.hash.slice(1))}"]`)?.scrollIntoView({
        block: 'start',
      });
    });
    const title = (e: ReferenceEntry) => el('a', { href: `#${e.id}`, text: e.title });
    const contents = el(
      'nav',
      { class: 'contents', 'aria-label': 'Contents' },
      ...SECTIONS.map((s) =>
        el(
          'div',
          {},
          el('h3', { text: s.title }),
          el(
            'ul',
            {},
            ...REFERENCE.filter((e) => e.kind === s.kind).map((e) => el('li', {}, title(e)))
          )
        )
      )
    );
    const byId = new Map(REFERENCE.map((e) => [e.id, e]));
    const entries = REFERENCE.map((e) =>
      el(
        'article',
        { class: 'card entry', id: e.id },
        el(
          'header',
          {},
          ...(e.type ? [symbolIcon(e.type)] : []),
          el('div', {}, el('h2', { text: e.title }), el('p', { class: 'gist', text: e.gist }))
        ),
        el('div', { class: 'text' }, renderMarkdown(e.text)),
        e.see.length
          ? el(
              'p',
              { class: 'see' },
              'See also: ',
              ...e.see.flatMap((id, i) => {
                const target = byId.get(id);
                const link = target ? title(target) : el('span', { text: id });
                return i ? [', ', link] : [link];
              })
            )
          : el('span')
      )
    );
    this.setContent(
      el(
        'section',
        { class: 'screen' },
        el('h1', { text: 'Reference' }),
        el('p', {
          class: 'lede',
          text: 'H.T. Odum’s energy systems language as this app draws it: what each symbol means and the conventions for drawing with it. The assistant reads these same entries before it explains or draws, so they are also the place to check it.',
        }),
        el('div', { class: 'layout' }, contents, el('div', { class: 'entries' }, ...entries)),
        el(
          'article',
          { class: 'card sources', id: 'sources' },
          el('h2', { text: 'Sources' }),
          el('ul', {}, ...SOURCES.map((s) => el('li', { text: s })))
        )
      )
    );
  }
}

define('reference-page', ReferencePage);
