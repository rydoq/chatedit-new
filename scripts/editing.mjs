import { MODULE, CHATEDIT_CONST, SETTINGS, localize } from "./const.mjs";

let PolyglotProvider = null;

Hooks.once("polyglot.init", () => {
  PolyglotProvider = game.polyglot;
});

function ChangeDorakoUIImage(speaker, message) {
  if (message.flags["pf2e-dorako-ui"] != null) {
    const token = game.scenes.viewed.tokens.get(speaker.token);
    const actor = game.actors.get(speaker.actor);
    const userAvatar = null;
    const combatantAvatar = null;
    const tokenAvatar = speaker.token ? {
      "image": token.texture.src,
      "name": speaker.alias,
      "scale": token.texture.scaleX,
      "isSmall": actor.size == "sm",
      "type": "token"
    } : null;
    const actorAvatar = speaker.actor ? {
      "image": actor.img,
      "name": speaker.alias,
      "type": "actor"
    } : null;
    const subjectAvatar = null;

    message.updateSource({
      "flags.pf2e-dorako-ui.userAvatar": userAvatar,
      "flags.pf2e-dorako-ui.combatantAvatar": combatantAvatar,
      "flags.pf2e-dorako-ui.tokenAvatar": tokenAvatar,
      "flags.pf2e-dorako-ui.actorAvatar": actorAvatar,
      "flags.pf2e-dorako-ui.subjectAvatar": subjectAvatar,
    });
  }
}

export class Editing {
    static init() {
    if (game.settings.get(MODULE, SETTINGS.EDIT)) {
      Editing._loadTemplates();
      
      // Add right click options to chat messages in the sidebar and popout chatlogs
      Hooks.on("getChatMessageContextOptions", Editing._contextMenu);
    }
  }

  /**
   * Register handlebars partials.
   */
  static _loadTemplates() {
      foundry.applications.handlebars.loadTemplates([
          `modules/${MODULE}/templates/alias.hbs`,
          `modules/${MODULE}/templates/bottom.hbs`
      ]);
  }

  /* -------------------------------------------- */
  /* Version Agnostic Form Application Handling   */
  /* -------------------------------------------- */

  /**
   * Deal with the type to style deprecation in v12.
   */
  static styleType() {
    return foundry.utils.isNewerVersion(12, game.version) ? "type" : "style";
  }

  /**
   * Version agnostic app data submission (_updateObject/_onSubmit).
   * @param {ChatMessage} message The ChatMessage to be edited.
   * @param {object} data         The relevant formData from the application.
   */
  static async _submitEditorData(message, data) {

    // The user making the edit
    const user = game.user;
    const userid = user.id;

    // Handle linebreaks
    let content = data.content;
    let language = data.language;

    // Handle flagging the message as edited
    let flags;
    if (game.settings.get(MODULE, SETTINGS.SHOW)) {
      flags = foundry.utils.mergeObject(message.flags, { "chatedit": { "edited": true } });
    } else {
      flags = message.flags;
    }

    // Determine message style based on speaker
    const id = data.speaker;
    let speaker, style;
    let STYLETYPE = Editing.styleType();

    // Handle out of character messages
    if (game.users.get(id)) {
      speaker = {
        alias: user.name,
        scene: null,
        actor: null,
        token: null }
      if (message[STYLETYPE] === 0) style = message[STYLETYPE];
      else style = CHATEDIT_CONST.CHAT_MESSAGE_STYLES.OOC;
    } else {

      // Handle in character messages
      const token = game.scenes.viewed.tokens.get(id);
      speaker = ChatMessage.getSpeaker({ token });

      // Handle emotes
      if (content.startsWith(token.name)) {
        style = CHATEDIT_CONST.CHAT_MESSAGE_STYLES.EMOTE;
        if (PolyglotProvider) language = PolyglotProvider.defaultLanguage;
      }
      else style = CHATEDIT_CONST.CHAT_MESSAGE_STYLES.IC
    }

    // Don't destroy the alias
    if (data.alias) foundry.utils.mergeObject(speaker, { alias: data.alias });

    // Handle (don't destroy) markdown
    if (game.settings.get(MODULE, SETTINGS.MARKDOWN)) {

      const parser = new showdown.Converter({ extensions: ["inline"] });

      // Markdown -> HTML (for saving back into the chat message)
      function markdownToHtml(markdown) {
        if (!markdown) return "";

        let s = String(markdown).replace(/\n/g, "<br>");

        return parser.makeHtml(s).trim();
      }

      // Create the parser and parse
      const parsed = markdownToHtml(content);

      // Call the pre process hook, then process
      const callback = Hooks.call("chatedit.preProcessChatMessage", message, parsed, parser, userid);
      if (callback) content = parsed;

      // Call the processed hook
      Hooks.callAll("chatedit.processChatMessage", message, parsed, parser, userid);
    }

    // Call the pre edit hook, then edit
    const callback = Hooks.call("chatedit.preEditChatMessage", message, { content, speaker, style, flags }, data, userid);
    if (!callback) return;
    await message.update({ content, speaker, [STYLETYPE]: style, flags });
    if (PolyglotProvider) {
      if (style === CHATEDIT_CONST.CHAT_MESSAGE_STYLES.OOC && language === PolyglotProvider.defaultLanguage){
        await message.unsetFlag("polyglot", "language");
      }
      else {
        await message.setFlag("polyglot", "language", language)
      }
    }
    ChangeDorakoUIImage(speaker, message);

    // Call the edit hook
    Hooks.callAll("chatedit.editChatMessage", message, { content, speaker, style, flags }, data, userid);
  }

  /**
   * Handle updating the alias input on forms
   * @param {HTMLElement} speaker The select element for the speaker.
   * @param {HTMLElement} alias   The input element for the alias.
   */
  static _alias(speaker, alias) {
    speaker.addEventListener('change', () => {
      if (game.users.get(speaker.value)) alias.value = null;
      else {
        const token = game.scenes.viewed.tokens.get(speaker.value);
        alias.setAttribute('value', ChatMessage.getSpeaker({ token }).alias);
      }
    });
  }

  /* -------------------------------------------- */
  /* Editor Initiatilization and Management       */
  /* -------------------------------------------- */

  /**
   * Keep track of open editors.
   */
  static _editors = new Map();

  /**
   * Create or open the editor.
   * @param {string} id The id of the ChatMessage to be edited.
   */
  static async editMessage(id) {

    // If you see this message you're doing something you shouldn't be
    if (!Editing._canEdit(id)) return ui.notifications.warn(localize('CHATEDIT.EDITS.NotAllowed'));

    // If an editor (for the correct version) exists, focus it, and if not, create it
    const message = game.messages.get(id);
    let editor = Editing._editors.get(id);
    if (editor) {
      editor.bringToFront();
    } else {
      editor = new EditorV2(message);

      // Render and track the editor
      await editor.render({ force: true });
      Editing._editors.set(id, editor);
    }
  }

  /* -------------------------------------------- */
  /* Context Menu Handling                        */
  /* -------------------------------------------- */

  /**
   * Check if the message can be edited.
   * @param {string} id The id of the ChatMessage to be tested.
   * @returns {boolean} Returns true if the message can be edited.
   */
  static _canEdit(id) {
    const message = game.messages.get(id);
    if (!message.isAuthor) return false;
    if (message.isRoll) return false;
    return foundry.utils.isEmpty(message.flags?.[game.system.id]);
  }

  /**
   * Check if the message is in character.
   * @param {string} id The id of the ChatMessage to be tested.
   * @returns {boolean} Returns true if the message is in character.
   */
  static _isIC(id) {
    if (!Editing._canEdit(id)) return false;
    const message = game.messages.get(id);
    return (message.speaker.actor != null || message.speaker.token != null) && !message.whisper.length;
  }

  /**
   * Check if the message is out of character.
   * @param {string} id The id of the ChatMessage to be tested.
   * @returns {boolean} Returns true if the message is out of character.
   */
  static _isOOC(id) {
    if (!Editing._canEdit(id)) return false;
    const message = game.messages.get(id);
    return (message.speaker.actor == null && message.speaker.token == null && !message.whisper.length);
  }

  /**
   * Assign a token as speaker and make the message in character.
   * @param {string} id The id of the ChatMessage to be edited.
   */
  static _makeIC(id) {
    let STYLETYPE = Editing.styleType();
    let style;
    const character = canvas.tokens.controlled[0] ?? game.user.character;
    const message = game.messages.get(id);
    const speaker = ChatMessage.getSpeaker({ actor: character });

    //Handle emotes
    message.content.startsWith(character.name) ?
      style = CHATEDIT_CONST.CHAT_MESSAGE_STYLES.EMOTE :
      style = CHATEDIT_CONST.CHAT_MESSAGE_STYLES.IC
    message.update({ [STYLETYPE]: style, speaker });
    if (PolyglotProvider) {
      const defaultLanguage = PolyglotProvider.defaultLanguage;
      const language = (game.polyglot.getUserLanguages([character].actor)[0].has(defaultLanguage) ? defaultLanguage :
          game.polyglot.getUserLanguages([character].actor)[0].values().next().value) ??
        defaultLanguage;
      message.setFlag("polyglot", "language", language);
    }
    ChangeDorakoUIImage(speaker, message);
  }

  /**
   * Assign the user as speaker and make the message out of character.
   * @param {string} id The id of the ChatMessage to be edited.
   */
  static _makeOOC(id) {
    let STYLETYPE = Editing.styleType();
    const message = game.messages.get(id);
    //const speaker = ChatMessage.getSpeaker({ scene: game.user.viewedScene });

    const speaker = {
      alias: game.user.name,
      scene: null,
      actor: null,
      token: null }

    message.update({
      [STYLETYPE]: CHATEDIT_CONST.CHAT_MESSAGE_STYLES.OOC,
      speaker });
    if (PolyglotProvider) {
      message.unsetFlag("polyglot", "language");
    }
    ChangeDorakoUIImage(speaker, message);
  }

  /**
   * Populate the right click items for editing chat messages.
   * @param {HTMLElement} html HTML contents.
   * @param {Array} menuItems    The context menu items.
   */
  static _contextMenu(html, menuItems) {
    menuItems.push(
      {
        label: "CHATEDIT.EDITS.IC",
        icon: '<i class="fa-solid fa-masks-theater"></i>',

        visible: (li) => {
          return Editing._isOOC(li.dataset.messageId) && (canvas.tokens.controlled[0] ?? game.user.character);
        },
        onClick: (li) => {
          Editing._makeIC(li.dataset.messageId);
        },
        group: MODULE
      },
      {
        label: "CHATEDIT.EDITS.OOC",
        icon: '<i class="fa-solid fa-computer"></i>',
        visible: (li) => {
          return Editing._isIC(li.dataset.messageId);
        },
        onClick: (li) => {
          Editing._makeOOC(li.dataset.messageId);
        },
        group: MODULE
      },
      {
        label: "CHATEDIT.EDITS.Edit",
        icon: '<i class="fa-solid fa-eraser"></i>',
        visible: (li) => {
          return Editing._canEdit(li.dataset.messageId);
        },
        onClick: (li) => {
          Editing.editMessage(li.dataset.messageId);
        },
        group: MODULE
      }
    )
    return menuItems;
  }
}
