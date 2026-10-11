import {MODULE, SETTINGS} from "./const.mjs";
import { Editing } from "./editing.mjs";

const ApplicationV2 = foundry.applications?.api?.ApplicationV2 ?? (class { });
const HandlebarsApplicationMixin = foundry.applications?.api?.HandlebarsApplicationMixin ?? (cls => cls);

let PolyglotProvider = null;

Hooks.once("polyglot.init", () => {
  PolyglotProvider = game.polyglot.provider;
});

export default class EditorV2 extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @override */
  constructor(message) {
    super();
    this.message = message;
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    form: {
      submitOnChange: false,
      closeOnSubmit: true,
      handler: EditorV2._onSubmit,
    },
    tag: "form",
    position: {
      width: 408,
      height: 830
    },
    classes: [MODULE, "edit-form-v2"],
    window: {
      title: "CHATEDIT.EDITS.Title",
      icon: "fa-solid fa-eraser",
      minimizable: true,
      resizable: true,
      contentClasses: ["standard-form"]
    },
    actions: {
      clearAlias: EditorV2._clear
    }
  }

  /** @override */
  static PARTS = {
    form: {
      template: `modules/${MODULE}/templates/edit-form-v2.hbs`
    }
  }

  /** @override */
  async _prepareContext(options) {
    const tokens = [...game.scenes.viewed.tokens.values()];

    // Prepare possible speakers for selectOptions
    const chars = tokens.reduce((acc, t) => {
      if (t.isOwner) acc.push({
        value: t.id,
        label: t.actor?.name,
        group: CONFIG.Actor.typeLabels[t.actor?.type],
        selected: (this.message.speaker.token === t.id)
      })
      return acc;
    }, []);

    const users = [{
      value: game.user.id,
      label: game.user.name,
      group: "USER.RolePlayer",
      selected: !this.message.speaker.token
    }];

    const speakers = users.concat(chars);

    const languagesByToken = {};
    if (PolyglotProvider) {
      for (const token of tokens) {
        const actor = token.actor;
        if (!actor) continue;

        const [known] = PolyglotProvider.getUserLanguages([token.actor]);
        if ([...known].length === 0) {
          languagesByToken[token.id] = Object.keys(PolyglotProvider.languages);
        } else {
          languagesByToken[token.id] = [...known].sort();
        }
      }

      if (game.user.isGM) {
        // Give all languages under the GM's user id
        languagesByToken[game.user.id] = Object.keys(PolyglotProvider.languages);
      }
    }

    function htmlToMarkdown(html) {
      if (!html) return "";

      let s = String(html);

      const parser = new showdown.Converter({ });
      s = parser.makeMd(s).trim();

      s = s.replace(/ *\n *<br\s*\/?>/gi, "")
        .replace(/<br\s*\/?>\n/gi, "");

      return s;
    }

    let html = this.message.content;
    if (game.settings.get(MODULE, SETTINGS.MARKDOWN)) html = htmlToMarkdown(html);

    const context = foundry.utils.mergeObject(options, {
      speakers,
      alias: this.message.speaker.alias ?? null,
      content: html,
      hasPolyglot: !!PolyglotProvider,   // flag for Handlebars
      languagesByToken
    });

    // Store context on the instance so _onRender can access it
    this.context = context;
    return context
  }

  /** @override */
  _onRender() {
    const root = this.element;
    const speakerSel = root.querySelector("[name='speaker']");
    const langSel = root.querySelector("[name='language']");
    const aliasInput = root.querySelector("[name='alias']");
    Editing._alias(speakerSel, aliasInput);

    const byToken = this.context?.languagesByToken ?? {};
    const provider = PolyglotProvider || game.polyglot?.LanguageProvider;

    if (provider) {
      // message language or system default
      const msgLang =
        this.message.getFlag("polyglot", "language") ||
        provider?.defaultLanguage ||
        null;

      // label helper
      const labelFor = (key) =>
        provider?.languages?.[key]?.label ?? key;

      // get languages for the currently selected "speaker" value
      const langsFor = (id) => {
        // GM selecting themselves (user row) => all languages
        if (game.user.isGM && id === game.user.id) {
          return Object.keys(provider?.languages || {});
        }
        // token-based list
        return byToken[id] || [];
      };

      // build options with: default first, then alpha by label; set selection
      const fill = (id) => {
        let langs = [...langsFor(id)];

        // sort: default first, then by label
        const def = provider?.defaultLanguage;
        langs.sort((a, b) => {
          if (a === def && b !== def) return -1;
          if (b === def && a !== def) return 1;
          const la = labelFor(a);
          const lb = labelFor(b);
          return la.localeCompare(lb);
        });

        // rebuild <option>s
        langSel.innerHTML = "";
        for (const key of langs) {
          const opt = document.createElement("option");
          opt.value = key;
          opt.textContent = labelFor(key);
          langSel.appendChild(opt);
        }

        // choose selection: message lang if present, else default, else first
        const preferred =
          (msgLang && langs.includes(msgLang) && msgLang) ||
          (def && langs.includes(def) && def) ||
          (langs[0] || "");

        if (preferred) langSel.value = preferred;
        langSel.disabled = langs.length === 0;
      };

      if (speakerSel && langSel) {
        fill(speakerSel.value); // initial
        speakerSel.addEventListener("change", (e) => fill(e.currentTarget.value));
      }
    }
  }

  /**
   * The form data submission handler.
   * @param {SubmitEvent} event The form submission event.
   * @param {HTMLElement} form  The form HTML element.
   * @param {FormDataExtended} formData  The formData, from which we want the object.
   */
  static async _onSubmit(event, form, formData) {
    let data = formData.object;
    await Editing._submitEditorData(this.message, data);
  }

  /**
   * Action to clear the alias input.
   */
  static _clear() {
    this.element['alias'].value = null;
  }

  /** @override */
  close(options) {
    Editing._editors.delete(this.message.id);
    return super.close(options);
  }
}
