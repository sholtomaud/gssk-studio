/**
 * BaseComponent, after Boba (https://github.com/sholtomaud/boba, MIT).
 * A component is three files — markup, styles, logic — and renders in the
 * light DOM. `:host` in its CSS is rewritten to the tag name so styles stay
 * scoped to the component.
 */
export class BaseComponent extends HTMLElement {
  private readonly template: HTMLTemplateElement;
  private rendered = false;

  constructor(htmlContent: string, cssContent = '') {
    super();
    const tagName = this.tagName.toLowerCase();
    const scopedCss = cssContent.replace(/:host/g, tagName);
    this.template = document.createElement('template');
    this.template.innerHTML = `${scopedCss ? `<style>${scopedCss}</style>` : ''}${htmlContent}`;
  }

  connectedCallback(): void {
    if (!this.rendered) {
      this.appendChild(this.template.content.cloneNode(true));
      this.rendered = true;
    }
    this.init();
  }

  disconnectedCallback(): void {
    this.destroy();
  }

  /** Called each time the element is connected, after its markup is in place. */
  init(): void {}

  /** Called when the element is removed. Release listeners here. */
  destroy(): void {}

  /** Replace the component's content, keeping its scoped <style>. */
  setContent(...nodes: Node[]): void {
    for (const c of [...this.children]) if (c.tagName !== 'STYLE') c.remove();
    this.append(...nodes);
  }

  /** querySelector that throws, so a missing element is a bug found at once. */
  $<T extends Element = HTMLElement>(selector: string): T {
    const el = this.querySelector<T>(selector);
    if (!el) throw new Error(`<${this.tagName.toLowerCase()}>: no element matches ${selector}`);
    return el;
  }
}

export function define(tagName: string, ctor: CustomElementConstructor): void {
  if (!customElements.get(tagName)) customElements.define(tagName, ctor);
}
