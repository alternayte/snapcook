// Hermes on Android has no Intl.Locale or Intl.PluralRules, and react-intl needs both for plural
// messages. Each polyfill installs itself only where the engine lacks it.
import "@formatjs/intl-locale/polyfill.js";
import "@formatjs/intl-pluralrules/polyfill.js";
import "@formatjs/intl-pluralrules/locale-data/en.js";
