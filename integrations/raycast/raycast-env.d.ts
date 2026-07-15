/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** HTTP API Base URL - Local clipboard-ai HTTP API address. */
  "baseUrl": string,
  /** HTTP Auth Token - Value of settings.http_auth_token in ~/.clipboard-ai/config.toml. */
  "token": string
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `setup` command */
  export type Setup = ExtensionPreferences & {}
  /** Preferences accessible in the `summary` command */
  export type Summary = ExtensionPreferences & {}
  /** Preferences accessible in the `explain` command */
  export type Explain = ExtensionPreferences & {}
  /** Preferences accessible in the `translate` command */
  export type Translate = ExtensionPreferences & {}
  /** Preferences accessible in the `history` command */
  export type History = ExtensionPreferences & {}
  /** Preferences accessible in the `classify` command */
  export type Classify = ExtensionPreferences & {}
  /** Preferences accessible in the `extract` command */
  export type Extract = ExtensionPreferences & {}
  /** Preferences accessible in the `summarize-url` command */
  export type SummarizeUrl = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `setup` command */
  export type Setup = {}
  /** Arguments passed to the `summary` command */
  export type Summary = {}
  /** Arguments passed to the `explain` command */
  export type Explain = {}
  /** Arguments passed to the `translate` command */
  export type Translate = {
  /** Target language */
  "language": string
}
  /** Arguments passed to the `history` command */
  export type History = {}
  /** Arguments passed to the `classify` command */
  export type Classify = {}
  /** Arguments passed to the `extract` command */
  export type Extract = {}
  /** Arguments passed to the `summarize-url` command */
  export type SummarizeUrl = {}
}

