import { BaseComponent, define } from '../../core/base-component.ts';
import { navigate } from '../../core/router.ts';
import { EXAMPLES } from '../../../model/examples/index.ts';
import { fileNameFor, parseModel, serialiseModel } from '../../../model/io.ts';
import { cloneModel, emptyModel, type StudioModel } from '../../../model/types.ts';
import { bounds } from '../../../diagram/geometry.ts';
import {
  createModel,
  deleteModel,
  getModel,
  listModels,
  type ModelSummary,
} from '../../../store/models.ts';
import { setImportNotes } from '../../import-notes.ts';
import { downloadText, el, icon, iconButton, svg, toast } from '../../ui.ts';
import template from './library-page.html?raw';
import style from './library-page.css?raw';

/** A small static drawing of a model's layout, for its tile. */
function thumbnail(m: StudioModel): SVGSVGElement {
  const pts = [
    ...m.nodes.map((n) => ({ x: n.visual.x, y: n.visual.y })),
    ...m._diagram.boundaries.flatMap((b) => [
      { x: b.x, y: b.y },
      { x: b.x + b.w, y: b.y + b.h },
    ]),
  ];
  const box = bounds(pts, 60);
  const s = svg('svg', {
    viewBox: `${box.x} ${box.y} ${box.w} ${box.h}`,
    'aria-hidden': 'true',
    preserveAspectRatio: 'xMidYMid meet',
  });
  for (const b of m._diagram.boundaries) {
    s.append(svg('rect', { class: 'b', x: b.x, y: b.y, width: b.w, height: b.h, rx: 8 }));
  }
  const at = new Map(m.nodes.map((n) => [n.id, n.visual]));
  for (const e of m.edges) {
    const a = at.get(e.origin);
    const b = at.get(e.target);
    if (a && b) s.append(svg('line', { class: 'e', x1: a.x, y1: a.y, x2: b.x, y2: b.y }));
  }
  for (const n of m.nodes) {
    s.append(svg('circle', { class: 'n', cx: n.visual.x, cy: n.visual.y, r: 22 }));
  }
  return s;
}

export class LibraryPage extends BaseComponent {
  constructor() {
    super(template, style);
  }

  override init(): void {
    this.$('.i-upload').replaceWith(icon('upload'));
    this.$('.i-plus').replaceWith(icon('plus'));
    const file = this.$<HTMLInputElement>('.file');
    this.$<HTMLButtonElement>('.new').onclick = () => void this.open(emptyModel());
    this.$<HTMLButtonElement>('.import').onclick = () => file.click();
    file.onchange = () => {
      const f = file.files?.[0];
      file.value = '';
      if (f) void this.importFile(f);
    };
    this.renderExamples();
    void this.renderMine();
  }

  private async open(model: StudioModel): Promise<void> {
    const id = await createModel(model);
    navigate(`/model/${id}`);
  }

  private async importFile(f: File): Promise<void> {
    try {
      const { model, notes } = parseModel(await f.text());
      const id = await createModel(model);
      setImportNotes(id, notes);
      toast(
        notes.length
          ? `Imported “${model.metadata.name}” with ${notes.length} change(s), listed in Checks.`
          : `Imported “${model.metadata.name}”.`
      );
      navigate(`/model/${id}`);
    } catch (err) {
      toast(`Couldn't import ${f.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private renderExamples(): void {
    this.$('.examples').replaceChildren(
      ...EXAMPLES.map((ex) => {
        const open = el('button', { type: 'button', text: 'Open a copy' });
        open.onclick = () => void this.open(cloneModel(ex.model));
        return el(
          'li',
          {},
          el(
            'article',
            { class: 'card tile', 'data-example': ex.id },
            el('div', { class: 'thumb' }, thumbnail(ex.model)),
            el('strong', { text: ex.title }),
            el('p', { class: 'desc', text: ex.summary }),
            el(
              'div',
              { class: 'row' },
              el('span', {
                class: 'meta',
                text: `${ex.model.nodes.length} symbols · ${ex.model.edges.length} flows`,
              }),
              el('span', { class: 'spacer' }),
              open
            )
          )
        );
      })
    );
  }

  private async renderMine(): Promise<void> {
    const list = this.$('.mine');
    let models: ModelSummary[];
    try {
      models = await listModels();
    } catch (err) {
      list.replaceChildren(
        el('li', { class: 'empty', text: `The model library couldn't open: ${String(err)}` })
      );
      return;
    }
    this.$('.empty').hidden = models.length > 0;
    list.replaceChildren(...(await Promise.all(models.map((s) => this.tile(s)))));
  }

  private async tile(s: ModelSummary): Promise<HTMLLIElement> {
    const saved = await getModel(s.id);
    const title = el('a', {
      class: 'title',
      href: `model/${s.id}`,
      'data-route': `/model/${s.id}`,
      text: s.name,
    });
    const dup = iconButton('copy', `Duplicate ${s.name}`);
    dup.onclick = async () => {
      if (!saved) return;
      const copy = cloneModel(saved.model);
      copy.metadata.name = `${copy.metadata.name} (copy)`;
      await createModel(copy);
      await this.renderMine();
    };
    const exp = iconButton('download', `Export ${s.name}`);
    exp.onclick = () => {
      if (saved) downloadText(fileNameFor(saved.model), serialiseModel(saved.model));
    };
    const del = iconButton('trash', `Delete ${s.name}`, 'ghost icon danger');
    del.onclick = async () => {
      if (!confirm(`Delete “${s.name}”? This can't be undone. Export it first to keep a copy.`)) {
        return;
      }
      await deleteModel(s.id);
      await this.renderMine();
    };
    const updated = new Date(s.updatedAt).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    return el(
      'li',
      {},
      el(
        'article',
        { class: 'card tile', 'data-model': s.id },
        el('div', { class: 'thumb' }, saved ? thumbnail(saved.model) : null),
        title,
        el('p', { class: 'desc', text: s.description || ' ' }),
        el(
          'div',
          { class: 'row' },
          el('span', { class: 'meta', text: `${s.nodes} symbols · ${s.edges} flows · ${updated}` }),
          el('span', { class: 'spacer' }),
          dup,
          exp,
          del
        )
      )
    );
  }
}

define('library-page', LibraryPage);
