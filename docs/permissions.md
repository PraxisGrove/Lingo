# Extension Permissions

## `storage`

Lingo stores versioned preferences, service configuration references, site
rules, and local cache metadata in the browser profile. Credentials are
isolated in local storage for background-worker access and excluded from
ordinary exports, diagnostics, and logs.

## `contextMenus`

Lingo adds page-level menu commands to translate the current page, translate
all recognized content, or restore the original page. Selection and editable-field
menus trigger explicit text translation in the corresponding frame. Password
and payment fields remain excluded. Menu activity outside these commands is not read.

## `sidePanel` (Chromium)

Lingo opens a persistent browser side panel when the reader clicks the toolbar
icon. It contains translation controls and follows the active webpage; it does
not inject a floating sidebar into the page. This permission only enables the
Chromium panel UI. Firefox uses its native `sidebar_action` without this permission.

## Video subtitles (`<all_urls>`)

Subtitle translation uses the existing all-sites access. After the reader starts
it on a video, the content script reads the caption file the player loaded, the
video's text tracks, or the captions shown on screen. Caption files on another
origin are fetched by the background worker without cookies; only caption-like
URLs (WebVTT, SRT, YouTube timedtext, Bilibili subtitle files) are accepted, up
to 2 MB. No additional permission is requested. See ADR-0015.

## `offscreen` (Chromium)

When the reader chooses browser on-device translation, the background worker
opens a hidden extension page to run the browser's built-in Translator and
LanguageDetector APIs, which service workers cannot access. Page text is passed
only between extension contexts and is translated on the device; no network
request carries it. Firefox builds omit this permission and the option.

## `<all_urls>`

Lingo needs host access to identify translatable content, present translations,
continue sessions on dynamic webpages, and apply explicit site and source-language
translation policies. Restricting access to the active tab would prevent those
core behaviors.

Host access is not permission to collect browsing history. When no translation
session is active, the content script performs only minimal initialization and
sends no page content. Content is sent only after an applicable user action or
translation policy and only to the service the reader selected.

Readers can explicitly configure an HTTPS rule subscription and a publisher
public key. Checks download only a bounded signed rule package, without cookies,
page text, or page URLs. No official endpoint is preconfigured.

Lingo does not execute remote code. Community site-rule updates are signed,
schema-validated declarative data.

## `webNavigation`

Lingo listens for History API navigation in single-page applications and tells
only the corresponding tab/frame to invalidate its old translation session.
It does not store navigation URLs or history, and an inactive session does not
scan or send page content in response to these notifications.
