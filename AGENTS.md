# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is **wegnet-browser-power**, a Chrome core-based browser extension built with:
- **WXT** - Web extension toolkit for cross-browser extension development
- **Vue 3** - Frontend framework with Composition API
- **TypeScript** - Type-safe development
- **Naive UI** - Component library for the UI

The extension integrates with GitLab, DingTalk (钉钉文档), and Jira to provide AI-powered assistance via the Wegent AI API.

## Development Commands

```bash
# Install dependencies
pnpm install

# Development - outputs to .output/chrome-mv3-dev/
pnpm dev

# Development for Firefox
pnpm dev:firefox

# Production build - outputs to .output/chrome-mv3/
pnpm build

# Build for Firefox
pnpm build:firefox

# Create distributable zip
pnpm zip

# Type checking only
pnpm compile
```

### Loading the Extension in Chrome

1. Build the extension: `pnpm build` (or `pnpm dev` for development with hot reload)
2. Open Chrome, navigate to `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" and select `.output/chrome-mv3/` (or `.output/chrome-mv3-dev/` for development)

## Architecture

### Entrypoints (`/entrypoints/`)

The extension uses WXT's file-based entrypoint system:

- **`background.ts`** - Service worker handling:
  - Auto-configuration flow: Opens Wegent settings, creates API key automatically by interacting with DOM elements via `data-roleid` attributes
  - DingTalk Markdown download monitoring
  - Opening pages and filling input fields programmatically

- **`popup/`** - Main popup UI (`App.vue`):
  - Routes dynamically based on current tab domain:
    - `git.*` / `gitlab.*` → GitLabPage
    - `issue.*` / `jira.*` → JiraPage
    - `alidocs.dingtalk.com` → DingTalkPage
    - Others → LoginPage

- **`options/`** - Options page for advanced settings
- **`content.ts`** - Content script (minimal)

### Services (`/services/`)

- **`config.ts`** - Centralized browser storage management:
  - API keys are encrypted using AES-GCM before storage
  - `STORAGE_KEY = 'extension_config'` for main config
  - `AI_MIX_CONFIG_KEY = 'ai_mix_config'` for AI action configurations
  - Supports loading defaults from `/config/ai-mix-defaults.json`

- **`crypto.ts`** - Encryption utilities using Web Crypto API:
  - Keys derived from `browser.runtime.id` via PBKDF2
  - AES-GCM encryption with 96-bit IV

- **`gitlabApi.ts`** - GitLab API client:
  - Extracts CSRF token from page meta tags or `window.gon`
  - Fetches MR details and project information
  - Parses MR URLs to extract project path and IID

- **`wegentApi.ts`** - Wegent AI API client:
  - Creates AI responses via `/api/v1/responses`
  - Supports tools: `wegent_chat_bot`, `wegent_code_bot`, `mcp`, `skill`
  - Polling for response completion

### Components (`/components/`)

- **`LoginPage.vue`** - Configuration form with auto-config feature
- **`GitLabPage.vue`** - MR integration with dynamic workspace config
- **`JiraPage.vue`** - Jira issue integration
- **`DingTalkPage.vue`** - DingTalk document integration
- **`OptionsPage.vue`** - Advanced settings for AI Mix configuration

Shared components in `/components/include/`:
- **`AIMix.vue`** - Container for AI action items
- **`AIAction.vue`** - Button-triggered AI tasks with confirmation dialog
- **`AIInput.vue`** - Input-based AI interactions
- **`PermissionRequest.vue`** - Domain permission handling wrapper

### Configuration System

AI Mix configuration is loaded from `public/config/ai-mix-defaults.json` and can be customized per domain. Each action has:
- `type`: `'action'` (button) or `'input'` (text input)
- `aiConfig`: Contains `promptTemplate`, `model`, and `tools`
- Dynamic configs via `getAiConfig()` for runtime data (e.g., GitLab MR workspace)
- Business data via `getBusinessData()` for prompt variable substitution

Prompt templates use `{variableName}` syntax for substitution with business data.

## Key Development Notes

- **Auto-configuration**: The background script automates API key creation by opening the Wegent settings page and interacting with elements via `data-roleid` attributes
- **Security**: API keys are encrypted at rest using the extension's unique ID as the encryption key
- **Permissions**: The extension requires optional host permissions for `https://*/*` to work across different GitLab/Jira instances
- **Type paths**: WXT provides path aliases `@/` and `~/` pointing to the project root

## UI Development Guidelines

**Prefer built-in Naive UI component props over custom CSS.** Custom CSS in `<style scoped>` should only be used when no built-in component or prop can achieve the desired result.
