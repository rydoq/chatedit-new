
import { ModuleSettings } from "./settings.mjs";
import { ProcessChat } from "./processing.mjs";
import { Editing } from "./editing.mjs";

Hooks.once("init", ModuleSettings.init);
Hooks.once("init", Editing.init);
Hooks.once("init", ProcessChat.init);
